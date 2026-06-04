+++
title = "Why deleting an env var from your GitOps values doesn't remove it from the pod"
date = 2026-04-09
draft = false
summary = "You delete an env var from your Helm values, Argo CD reports Synced — and it's still on the pod. Why strategic-merge-patch can't remove list items, and the Server-Side Apply fix."
tags = ["GitOps", "Kubernetes"]
images = ["/og/argocd-env-var-pruning.png"]
+++


You remove an environment variable from a Helm values file, commit, and ArgoCD syncs. Status: **Synced**. But the variable is still set on the running pod. You didn't change it — you *deleted* it — and it's still there. This isn't an ArgoCD bug; it's a consequence of how Kubernetes merges lists, and it has a specific fix.

## The failure

A `StatefulSet`'s container env was rendered from a `customEnv` block in values. We removed two entries (an HTTP-port override used only for local port-forwarding) and pushed to the GitOps repo. ArgoCD synced the new revision cleanly — `Status=Synced`, the latest commit hash, no errors. Yet the pod template still carried the removed entries:

```yaml
spec:
  template:
    spec:
      containers:
      - env:
        - name: APP_SERVER_HOST                          # we deleted this from values
          value: localhost                               # still here
        - name: HTTP_PORT                                # and this
          value: "8081"                                  # still here
```

A manual one-shot sync with `Replace=true` finally dropped them. So the desired state was right; the *apply mechanism* wasn't removing what we'd taken out.

## The cause: strategic-merge-patch can't say "remove from list"

ArgoCD's default apply is a client-side, three-way **strategic merge patch**[^smp] — the same machinery as `kubectl apply`. For lists, Kubernetes uses a **merge key** where one is defined. A container's `env` list has merge key `name`. That means env entries are merged *by name*, not replaced wholesale:

- Add an entry to desired state → the patch adds it.
- Change an entry's value → the patch updates it by name.
- **Remove an entry from desired state → the patch contains *nothing* about it.**

A strategic merge patch describes what *should be present*; it has no vocabulary for "this used to be here, delete it." When you drop an env var from values, the rendered manifest simply stops mentioning it — and "stops mentioning" reads as "no change" to the merge, so the live entry survives. ArgoCD honestly reports Synced, because it successfully applied the patch it computed.

## The fixes, least to most surgical

1. **Server-Side Apply**[^ssa] (recommended). Switch the Application to SSA:
   ```yaml
   syncPolicy:
     syncOptions:
       - ServerSideApply=true
   ```
   SSA tracks **field ownership**. Because the ArgoCD applier previously owned that env entry, dropping it from the desired manifest causes SSA to *relinquish and prune* the field. It removes what you removed, without the heavy hammer below. This is the modern, correct default for this whole class of "removal doesn't propagate" problem.

2. **`Replace=true`.** Forces a full `kubectl replace` instead of a patch — the live object becomes exactly the desired manifest, so removed list items disappear. It works, but it's heavyweight: a full replace on every sync, with recreate semantics for some resources. Reserve it for one-shot remediation, not steady state.

3. **Null it chart-side.** Keep the key but render it absent/empty so the desired state explicitly overrides the old value. Workable for a known field, but it's a manual patch per field and doesn't generalize.

## The general principle

**A declarative system is only as declarative as its apply semantics allow.** Strategic-merge-patch is *additive-by-default* for merge-keyed lists: it reconciles presence and values, but not absence. So "GitOps is the source of truth" quietly fails for *deletions inside merge-keyed lists* — env vars, volumes, volumeMounts, containers, ports, anything keyed by `name` — unless the apply mechanism can express removal.

Server-Side Apply closed this gap by making field ownership explicit, so relinquishing a field means pruning it. If you run ArgoCD (or raw `kubectl apply`) and rely on removing list items by deleting them from values, **turn on Server-Side Apply** — otherwise your desired state and your cluster will silently diverge precisely on the things you took away.

[^smp]: A [strategic merge patch](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/update-api-object-kubectl-patch/#use-a-strategic-merge-patch-to-update-a-deployment) merges list items by a defined merge key (here, `name`) instead of replacing the list — so it expresses additions and changes, but not removals.
[^ssa]: Kubernetes [Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/) makes field ownership explicit, so a field dropped from the desired manifest is pruned. In Argo CD, enable it per-Application with the [`ServerSideApply=true` sync option](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/#server-side-apply).
