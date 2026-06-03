+++
title = "Tearing down a managed-Kubernetes deployment without leaving a tail"
date = 2026-06-02
draft = false
tags = ["Infrastructure as Code", "Kubernetes", "GCP"]
+++


Standing up a GKE or EKS deployment is the easy direction. Tearing it down cleanly is where the sharp edges live — because a "deployment" is rarely a single layer that one `terraform destroy` fully owns. The cluster is provisioned one way; the things that *run inside* the cluster provision more cloud resources a second way; and the two layers disagree about who is responsible for cleanup.

This is a field guide to deleting one without leaving orphans, drawn from tearing down both a GKE deployment (Argo CD + Crossplane GitOps) and a pair of Terraform-provisioned EKS clusters.

## Strategy 0: if you can, delete the whole project / account

The cleanest teardown is the one you don't have to enumerate. If the deployment lives in its own **GCP project** or its own **AWS account**, deleting that container is the single most reliable move — it takes every resource, IAM binding, and orphan with it, and you never have to reason about deletion order.

This only works if the project/account is *dedicated* to the deployment. The moment a project is shared across many deployments (a common `*-development` sandbox pattern), you can't nuke it, and you're back to surgical deletion — which is the rest of this guide.

> **Shared-project fragility to watch for:** some Terraform modules grant *project-level* IAM bindings (e.g. to the Storage Transfer Service agent) as if they were per-cluster. When *any* sister deployment's module runs `terraform destroy`, those shared bindings vanish from the whole project and silently break every other deployment that still expects them. Factor project-scoped bindings into a separate one-shot bootstrap module so per-deployment destroys can't take them down.

## Strategy 1: enumerate by naming convention, not by module's resource list

The instinct is to walk the Terraform module's resource types and delete those. This misses everything the module didn't create. A GKE deployment built on a GitOps/Crossplane stack also has, beyond the module's VPC/subnet/router/NAT/firewall/node-SA:

- High-privilege control-plane service accounts (`serviceAccountAdmin`, `projectIamAdmin`).
- Per-provider service accounts (KMS, SQL, Secret Manager, Storage admins).
- Crossplane-provisioned **downstream** resources — Cloud SQL instances, GCS buckets, KMS keyrings, secrets — that survive after the cluster is gone.
- Dozens of project IAM bindings, which are *policy entries*, not resources, and won't show up in any resource listing.

**Enumerate with Cloud Asset Inventory (GCP) or the Resource Groups Tagging API (AWS), keyed on the deployment's name prefix:**

```shell
gcloud asset search-all-resources \
  --scope=projects/<project> \
  --query="name:<deployment-prefix>" \
  --format="value(assetType,name)"
```

This catches the secrets, buckets, and controller-created SAs that a module-walk misses. Then **separately** sweep project IAM, because bindings aren't assets:

```shell
gcloud projects get-iam-policy <project> \
  --flatten="bindings[].members" \
  --filter="bindings.members~<prefix>-" \
  --format="value(bindings.role,bindings.members)"
```

### Labels help less than you'd hope

The tempting axis is `--filter labels.deployment_name=...`. But most networking and IAM primitives — VPC, subnet, router, NAT, route, firewall, peering, service account, IAM binding — **have no label field at the API level**. A provider can only set arguments that exist. In practice only a couple of resource types (e.g. `google_compute_global_address`, the cluster itself) carry the label. So the real discovery axis is the **`<deployment_name>-` naming convention**, not labels. Tag what you can, but build your enumeration on names.

## Strategy 2: know what Terraform never tracked

`terraform destroy` only deletes what's in its state. Two large classes of resource routinely aren't:

1. **Resources provisioned by in-cluster controllers.** Crossplane managed-resources, the EBS/PD CSI driver's dynamically-provisioned volumes, cloud load balancers created by a `Service: LoadBalancer`. These are created by software *running inside* the cluster, not by Terraform — so Terraform has no idea they exist.
2. **State drift / empty state.** If the local state was reset, migrated, or never captured the import, `terraform destroy` is a no-op and quietly leaves everything running. **Always verify `terraform state list` is non-empty before trusting destroy.**

Concrete leftovers seen after the clusters were deleted:
- **GKE:** Crossplane-created Cloud SQL instances and GCS buckets, plus `cp-iam`/provider SAs and ~17 project IAM bindings.
- **EKS:** two `available` (detached) 10 GiB EBS volumes named `<cluster>-dynamic-pvc-<uuid>` — orphaned PersistentVolumes the CSI driver created and Terraform never owned.

Sweep for these explicitly after the cluster is gone:

```shell
# Orphaned EBS PVs from a deleted EKS cluster
aws ec2 describe-volumes --region <r> \
  --filters "Name=tag:Name,Values=*<cluster>*" \
  --query "Volumes[?State=='available'].VolumeId" --output text
```

## Strategy 3: deletion protection and the right order

**Check deletion protection first.** Cloud SQL (`settings.deletionProtectionEnabled`), GKE clusters, RDS instances, and load balancers can all carry a protection flag that makes delete calls fail outright. Confirm it's off before you script a batch delete, or your loop fails halfway and leaves a partial teardown.

**Dependencies dictate order.** Networking especially is a dependency graph, not a flat list. A workable GCP order:

1. Service-networking (PSA) peering — *usually the stuck one* (see below).
2. NAT → router (NAT lives inside the router).
3. Firewalls.
4. Non-default routes.
5. Subnet.
6. PSA global address (only deletable once its peering is gone).
7. VPC.
8. Project IAM bindings — **one `remove-iam-policy-binding` per (role, member)**.
9. Service accounts. (Deleting an SA does *not* remove its project bindings — they become `deleted:...?uid=` orphan members. Remove the bindings too, or they linger forever.)
10. Controller-created resources (SQL, buckets, keyrings).

A useful shortcut when the controllers are GitOps-managed: **delete the cluster first.** That removes Argo CD, Crossplane, and every finalizer in one shot, so nothing fights you — then clean the now-orphaned cloud resources directly. (This is only safe because the controllers couldn't deprovision anyway; see below.)

## Strategy 4: retries, stuck finalizers, and things that hang

Cloud deletes are eventually-consistent and frequently need retries or a workaround:

- **Service-networking peering** often fails with `FLOW_SN_DC_RESOURCE_PREVENTING_DELETE_CONNECTION` even after Cloud SQL / Memorystore / Filestore are gone — the tenant-project side holds stuck state. When the VPC is going away regardless, delete the peering from the **consumer side** instead:
  ```shell
  gcloud compute networks peerings delete servicenetworking-googleapis-com \
    --network=<deployment>-vpc --project=<project>
  ```
- **Crossplane / Argo finalizers.** If the controller's cloud credentials have lapsed (e.g. the control-plane SA lost authorization — a `403 notAuthorized` on observe), Crossplane *cannot* deprovision its managed resources, and deleting the claim/XR will **hang on finalizers forever**. Don't wait on it: delete the cloud resources by hand via the provider CLI, then either strip the finalizers or — cleaner — delete the whole cluster so the entire control plane (and its finalizers) disappears at once.
- **Auto-sync will fight you.** A GitOps controller set to `automated: { prune: true, selfHeal: true }` recreates anything you delete out from under it. Remove/disable the Applications first, or delete the cluster they run in, before deleting their managed resources.
- **Asset Inventory lags ~1 hour.** After deletion, stale entries for Networks, service-networking Connections, and SecretVersions linger in Asset Inventory. Don't trust it for "is this really gone" — **verify against the direct API** (`gcloud compute networks describe`, `aws eks list-clusters`, etc.).

## A teardown checklist

1. Is this its own project/account? If yes — delete it and stop.
2. `terraform state list` non-empty? If empty, destroy is a lie; enumerate manually.
3. Enumerate via Asset Inventory / Tagging API on the **name prefix**; sweep IAM separately.
4. Identify controller-created resources Terraform never tracked (CSI volumes, Crossplane MRs, LB-from-Service).
5. Check and clear deletion protection.
6. Delete in dependency order (or delete the cluster first to kill controllers/finalizers, then clean orphans).
7. Remove IAM bindings explicitly — deleting an SA leaves orphan bindings.
8. Handle the known-stuck cases (PSA peering consumer-side, hung finalizers).
9. **Verify against the live API**, not Asset Inventory.
