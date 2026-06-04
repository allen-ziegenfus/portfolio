+++
title = "When Terraform owns a shared resource as if it were dedicated"
date = 2026-05-04
draft = false
summary = "When a per-cluster Terraform module owns a project-global, shared resource, tearing down one cluster quietly breaks the others. Why resources with different lifecycles can't share state — and the bootstrap-module fix."
tags = ["Infrastructure as Code", "GCP"]
images = ["/og/terraform-shared-resource-fragility.png"]
+++


Terraform's mental model is that a state file *owns* the resources it declares: `apply` makes them exist, `destroy` makes them go away. That model quietly breaks when a resource is actually **shared across many deployments** but gets declared inside a **per-deployment** module. The symptom shows up far from the cause — a *different* deployment's teardown silently breaks the one you're looking at.

## The setup

A per-cluster Terraform module (`cloud/terraform/gcp/gke`) needs Cloud Storage Transfer Service to run database backups. So it grants the project's Storage Transfer **service agent** the roles it needs:

```hcl
# apis.tf — inside the PER-CLUSTER module
resource "google_project_iam_member" "sts_storage_admin" {
  project = var.project_id
  role    = "roles/storage.admin"
  member  = "serviceAccount:project-${var.project_number}@storage-transfer-service.iam.gserviceaccount.com"
}
resource "google_project_iam_member" "sts_agent" {
  project = var.project_id
  role    = "roles/storagetransfer.serviceAgent"
  member  = "serviceAccount:project-${var.project_number}@storage-transfer-service.iam.gserviceaccount.com"
}
```

This works when you stand up the first cluster. It keeps working when you stand up the second and third — `google_project_iam_member` is additive and idempotent, so each cluster's `apply` just re-asserts the same binding.

## The failure

The Storage Transfer service agent is **one identity per GCP project**. There is exactly one `project-<N>@storage-transfer-service.iam.gserviceaccount.com`, and exactly one project-level binding granting it `storage.admin`. But now *N* per-cluster Terraform states each declare that single binding as if they owned it.

Apply is forgiving of that. **Destroy is not.** Tear down *any one* cluster:

```
terraform destroy   # cluster A
```

…and `google_project_iam_member` dutifully *removes* the project-level binding — the one every *other* cluster is still relying on. The next backup run on clusters B, C, D fails with:

```
storage: does not have storage.buckets.get access to the Google Cloud Storage object
```

Nothing changed in B, C, or D. Their Terraform still shows the binding in state. But the binding is gone from the project, because a sibling's destroy took it. The blast radius of a teardown reached sideways into unrelated, still-running deployments.

## Why this class of bug hides

Three properties make it hard to catch:

1. **Apply masks it.** As long as *any* cluster has applied recently, the binding exists. The fleet looks healthy.
2. **The damage is delayed and remote.** The break surfaces on a *different* deployment, on its *next* backup, not at destroy time. The causal link is easy to miss.
3. **State lies.** Every surviving cluster's state still lists the binding as present and owned. `terraform plan` shows no drift until it tries to use it.

## The fix: separate ownership layers by lifecycle, not by convenience

The binding is **project-scoped and singleton**; the cluster is **per-deployment and disposable**. Resources with different lifecycles must not live in the same state.

Factor project-global, shared resources into a **one-shot bootstrap module** that runs once per project and is never part of a per-cluster destroy:

```
terraform/
  bootstrap/      # one state per PROJECT — service-agent bindings, shared APIs, org policy
  gke-cluster/    # one state per CLUSTER — VPC, cluster, node pools (safe to destroy)
```

The per-cluster module then *depends on* the bootstrap layer's outputs but never declares the shared bindings itself. A cluster teardown can't touch anything another cluster needs, because it no longer owns it.

## The general principle

Before Terraform manages a resource, ask: **is this resource per-instance, or is it shared across instances?** Anything project-, account-, or org-scoped — service-agent IAM bindings, enabled APIs, org policies, shared DNS zones, a default network — is a singleton. A singleton declared inside a per-instance module is owned N times and destroyed by the first teardown that runs.

The diagnostic test is simple and worth applying in review: *"If I `terraform destroy` this one module, does anything outside it break?"* If yes, the resource is in the wrong layer. Shared resources belong in a bootstrap state whose lifecycle matches the thing they're actually scoped to — the project — not the thing that happened to need them first.
