+++
title = "The Crossplane Object that synced green and changed nothing"
date = 2026-06-02
draft = false
summary = "Everything's green — Argo CD Synced, Crossplane Ready — but the change never took effect. The trap where Crossplane management policies without Update meet Kubernetes immutability."
tags = ["Infrastructure as Code", "Kubernetes", "GitOps"]
images = ["/og/crossplane-object-immutable-update.png"]
+++


Here's a quietly dangerous failure mode in a Crossplane + GitOps stack: a chart change is committed, ArgoCD reports **Synced**, the Crossplane resource reports **Ready**, every dashboard is green — and the change never actually took effect. The new behavior you shipped silently isn't running. The cause is a two-part interaction between **Crossplane management policies** and **Kubernetes immutability**.

## The setup

Crossplane's `provider-kubernetes` lets a composition manage an arbitrary Kubernetes resource by wrapping it in an `Object`. Ours wrapped a database-grant `Job`:

```yaml
# compositions/30-k8s.yaml
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
spec:
  managementPolicies: ["Create", "Observe", "Delete"]   # note: no "Update"
  forProvider:
    manifest:
      apiVersion: batch/v1
      kind: Job
      # ...db-grant job spec...
```

`managementPolicies` controls which verbs Crossplane is *allowed* to perform on the external resource. This one can **Create** the Job, **Observe** it, and **Delete** it — but it is not permitted to **Update** it.

## The failure

A later chart change added a step to the Job — an auth-readiness wait before the grant runs. The change merged, ArgoCD synced the new composition, Crossplane reported the `Object` Ready. But on any environment where the Job already existed (a re-used "green" instance), the new readiness wait **never ran**.

Two facts combine to produce this:

1. **`managementPolicies` has no `Update`.** Crossplane created the Job once. With `Update` absent, it will never reconcile the live Job toward a changed spec — drift is simply not its job. So a new manifest in the composition is observed but never applied.
2. **A `Job` is immutable anyway.** Even *with* `Update`, you can't `kubectl apply` a changed `spec.template` onto an existing Job — `Job.spec.template` is immutable. Propagating the change requires **delete-and-recreate**, which Crossplane will do on an immutability conflict *only if* `Delete` and `Update` are both in the policy set.

So the Job froze at its first-created spec. Everything upstream reported success because, from Crossplane's and ArgoCD's point of view, nothing was *wrong* — the `Object` matched its allowed policy exactly. The desired-state change just had no path to the cluster.

## The fix

For an immutable Kubernetes resource managed through a Crossplane `Object`, you need Crossplane to be *allowed* to replace it, and you need to understand it will do so by delete-and-recreate:

```yaml
managementPolicies: ["Create", "Observe", "Update", "Delete"]
```

With `Update` (and `Delete`) present, Crossplane detects the spec drift, hits the immutability conflict on apply, and falls back to delete-and-recreate — so the new Job spec actually lands. (If recreating the Job mid-flight is unacceptable, the alternative is to make the Job name a function of its content — a spec hash in the name — so a changed spec produces a *new* Job under Create semantics rather than mutating an existing one.)

## The general principle

Two transferable lessons:

- **An allow-list of actions silently caps reconciliation.** Anything that lets you restrict which verbs a controller may perform — Crossplane `managementPolicies`, RBAC, provider scopes — will, when under-scoped, produce a system that looks reconciled but isn't. The resource matches policy; policy just doesn't include "make it current." Default to the full action set and remove verbs deliberately, not by omission.
- **"Synced" and "Ready" mean *conformant to intent*, not *currently correct*.** A green GitOps dashboard tells you the controller did everything it was permitted to do. It does not tell you the live resource reflects your latest change — especially across an immutability boundary, where the path from desired to actual requires a replace the controller may not be allowed (or able) to perform. When a change "deploys" but the behavior doesn't move, suspect the gap between *what the controller is permitted to do* and *what the resource requires to change.*
