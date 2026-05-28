# Use GKE Connect Gateway to protect your private control plane

A common GKE security choice: provision clusters as **private clusters** — no public IP on the Kubernetes API server. This significantly reduces attack surface; the control plane is unreachable from the public internet.

The architectural question that follows: *how does authorized traffic — engineers, CI, operators — reach the API server?*

Most teams reach for one of these:

- **Bastion host or VPN.** Works, but adds infrastructure to maintain and a separate authentication chain.
- **Authorized networks (public IP with allowlist).** Narrowly exposes the control plane, but defeats the "private by default" stance and requires managing IP allowlists.

**Use Connect Gateway instead.** It's the GKE-native, platform-included answer:

- No bastion to run, no VPN to maintain.
- No public IP on the control plane — the private-cluster invariant stays intact.
- GCP IAM authenticates the user to the gateway; Kubernetes RBAC authorizes them inside the cluster. Clean separation, standard tooling.
- Included in the GKE management fee (~$0.10 / hour / cluster as of 2026). No GKE Enterprise license required for base functionality.

## Minimum config

Cluster registered as a member of a **GKE Fleet** (formerly GKE Hub). The accessing identity has both:

- **GCP IAM:** `roles/gkehub.gatewayReader` (or `gatewayEditor` / `gatewayAdmin`) plus `roles/gkehub.viewer`.
- **Kubernetes RBAC:** a `ClusterRoleBinding` granting the appropriate role. (GKE provides implicit `cluster-admin` mapping for `roles/container.admin` / Project Owner; explicit bindings are better for least-privilege.)

After Fleet registration, getting cluster access is a single command:

```shell
gcloud container fleet memberships get-credentials <MEMBERSHIP_NAME>
```

This rewrites the local `kubeconfig` to route through the Connect Gateway endpoint instead of the cluster's private master IP. `kubectl` works normally afterwards.

## Why this is worth featuring as a recommendation

For most teams running private GKE clusters, Connect Gateway is the right default — and underused, because the "I need a bastion" instinct is older than the gateway is. It's the platform-native, no-extra-infrastructure path. The auth model (IAM outside, RBAC inside) lines up cleanly with how Kubernetes-on-GCP is already authenticated everywhere else. Set the Fleet membership; grant the IAM + RBAC; done.

## References

- [Connect Gateway Overview (Google Cloud docs)](https://cloud.google.com/kubernetes-engine/enterprise/multicluster-management/gateway)
- [Using Connect Gateway (Google Cloud docs)](https://cloud.google.com/kubernetes-engine/enterprise/multicluster-management/gateway/using)
