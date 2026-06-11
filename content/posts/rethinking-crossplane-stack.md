+++
title = "Rethinking a Crossplane stack: the provider was the problem, not the engine"
date = 2026-06-05
draft = true
slug = "rethinking-crossplane-stack"
summary = "After fighting a Crossplane infrastructure stack — API-server instability, gnarly readiness logic — the step-back conclusion: keep the abstraction, drop the heavy provider, and stop gating readiness through secret emission. The database is ready when the grant lands."
tags = ["Infrastructure as Code", "Kubernetes"]
+++

> **Draft.** The "step back" companion to the KCL-composition piece. That one asked
> *which language* should write the composition. This one asks whether the composition
> should be doing what it's doing at all.

I spent a while building a Crossplane stack to provision a stateful application's
infrastructure on GCP — a managed database, object storage, a search cluster — and then
a while longer fighting it. Two things hurt: the API server got unstable under the
provider's weight, and the logic that decided *"is everything ready so the app can
start?"* was the source of the worst, hardest-to-see bugs.

The instinct after that is "Crossplane was the wrong call." The more useful conclusion is
narrower and more interesting: **the provider was the problem, not the engine — and the
readiness logic shouldn't have been in the composition at all.**

## "provider-gcp is just Terraform too"

The thing that unlocked the rethink was realizing the binary I'd set up — *Crossplane vs
Terraform* — was false. The upjet-based GCP provider **is generated from the Terraform
provider** and calls it underneath. It's Terraform either way. So the real questions
aren't "Crossplane or Terraform"; they're:

- **Granularity** — one Kubernetes resource per cloud resource (hundreds of CRDs), or one
  resource wrapping a whole module?
- **State** — does Kubernetes hold it (upjet), or do you keep a Terraform state file?
- **Observability** — every field auto-reflected per resource, or the outputs you choose
  to export?

That reframes "the API server fell over" from "Crossplane is bad" to "I installed the
**monolithic** provider — hundreds of CRDs plus conversion webhooks — when I could have
installed only the provider *family* I needed, or wrapped a Terraform module in a single
lightweight resource."

<!-- TODO: the three-axes table (API surface / substrate / loop) from the notes -->

## What I'd keep: the claim

The one thing not up for debate is the **claim**. Users need to say *"I need this kind of
database"* — an engine, a size, a version — and not care how it's built. That's a typed,
self-service API, and building it without hand-writing an operator is exactly what
Crossplane's composite resources are *for*. The abstraction was never the problem.

So the rethink keeps the XRD and claim, and changes what's underneath them.

## The unit of "done": let Terraform's graph mean something

Here's the part I got wrong the first time. The composition was emitting a dozen
fine-grained managed resources and then trying to answer "are they all ready, in the
right order?" by observing each one and combining their readiness — and gating the app's
connection secret on the result. That gating logic is where the silent-failure bugs
lived: a composition can decide to emit *nothing* and still report success.

The connection secret was doing two unrelated jobs: **carry credentials** and **signal
readiness**. Splitting them dissolves the problem.

Move the database's resources into a **Terraform module** — instance, database, user, and
the **grant** — wrapped in a single `provider-terraform` `Workspace`. Terraform's
dependency graph orders them, and `terraform apply` only succeeds when the *last* resource
succeeds. Put the grant in the module and:

```
Workspace Ready == "instance + database + user + grant all applied, in order"
```

One atomic, observable signal for the whole unit — computed by Terraform's graph, not by
composition logic I had to get right. The database is ready when the grant lands.

The one condition: **the grant has to be a Terraform resource in the module, not a
separate Kubernetes Job.** A Job lives outside the graph, so `Ready` would say nothing
about it. In the graph, `Ready` covers it. (The cost: the provider pod needs to reach the
DB to run the grant — private IP or the Auth Proxy. Worth it for the unified signal.)

<!-- TODO: note the IAM-auth wrinkle — app uses Workload Identity, no password, but the
     IAM principal still needs GRANTs; grant runs as an admin SA via the gcppostgres
     connector scheme; still in the DAG, so Ready still covers it. SQL Server has no IAM
     DB auth, so this is Postgres/MySQL only. -->

## Ordering belongs to the GitOps engine, not the secret

With one `Ready` per piece, ordering stops being the composition's job. ArgoCD reconciles
*any* Kubernetes manifest — plain YAML, Helm, Kustomize, plugins — including CRs, and it
reads their status as health. So:

- The claim is **sync-wave 0**; its `Ready` propagates up from the `Workspace`.
- The app is **sync-wave 1**; Argo won't sync it until wave 0 is Healthy.
- The secret is published as soon as credentials exist. No "emit only when ready" logic.

Ordering is explicit, visible in the Argo UI, and lives in the GitOps engine where it
belongs. (Optionally, an init container that probes *capability* — can connect and run
the app's query — makes "not ready" explicit in the pod's own status too.)

## The heterogeneous reality

Not every dependency is a cloud resource. A managed database and object storage are —
Terraform modules, wrapped in Workspaces. But a search cluster run by an operator (ECK)
is provisioned by applying a CR that the operator reconciles; forcing that into Terraform
means Terraform-managing-Kubernetes, an anti-pattern when ArgoCD already does that. So:

- Cloud resources → Terraform module → `Workspace` (`Ready` = provisioned)
- Operator-managed → ArgoCD applies the CR → readiness from the CR's own status

The unifying layer is ArgoCD sync waves keying on each piece's readiness signal —
whatever shape that signal takes.

## The shape it lands on

> A typed **claim** per logical piece ("I need this kind of DB")
> → composition emits **one `Workspace`** per cloud piece (inline HCL while iterating, a
>   versioned module for reuse)
> → **Terraform's graph** orders the resources and makes `Ready` mean "the whole unit,
>   grant included, is done"
> → **ArgoCD sync waves** order the app behind its dependencies
> → credentials published when they exist; **readiness is never gated through the secret**

More Crossplane where it earns its place — the claim — and less where it hurt — the
monolithic provider and the readiness gating. Not "ditch Crossplane." Rethink what each
layer is for.

## References

- [Crossplane composition functions](https://docs.crossplane.io/latest/concepts/composition-functions/)
- [provider-terraform](https://github.com/upbound/provider-terraform)
- [Argo CD sync phases and waves](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/)
- [Cloud SQL IAM database authentication](https://cloud.google.com/sql/docs/postgres/iam-authentication)
