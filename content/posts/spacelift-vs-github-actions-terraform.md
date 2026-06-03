+++
title = "Applying Terraform from CI is a stateful problem wearing a stateless tool"
date = 2026-06-02
draft = false
summary = "GitHub Actions is a near-perfect stateless task runner — and a poor fit for applying Terraform, which is stateful, collaborative, and approval-gated. The practical case, from running it both ways."
tags = ["Infrastructure as Code"]
images = ["/og/spacelift-vs-github-actions-terraform.png"]
+++


GitHub Actions is excellent at what it is: a stateless task runner that spins up a clean box, runs your steps, and tears down. That model is a near-perfect fit for build-test-lint. It is a *poor* fit for **applying Terraform** — and the gap doesn't show up in a demo. It shows up the third week, when two PRs merge close together, a state lock collides, and someone is manually reconciling a half-applied change at 11pm. Applying Terraform is a **stateful, collaborative, approval-gated** workflow, and forcing it onto a stateless executor means rebuilding state, locking, approvals, audit, and drift detection by hand — usually badly. A purpose-built IaC platform (Spacelift here; the category is "TACOS" — Terraform Automation and Collaboration Software) gives you those as first-class features. This is the practical case, from having run Terraform both ways.

## What raw CI makes you rebuild

Applying Terraform safely requires a set of properties that a CI runner doesn't have and can't easily fake:

- **State and locking.** Terraform state is shared, mutable, and must be serialized — exactly one apply at a time per state. CI runners are concurrent and stateless by design. So you bolt on a remote backend *and* hand-roll lock handling, and you still hit `Error acquiring the state lock` races whenever two workflows overlap. The platform owns the state and serializes runs as a built-in invariant.
- **A plan that equals the apply.** The whole value of review is approving a *specific plan*, then applying *that plan* — not re-planning at apply time against possibly-changed state. In CI you pass the plan as an artifact between jobs and pray nothing drifted in between; the plan→approve→apply handoff is bespoke and fragile. In a TACOS it's the native run lifecycle: plan, a human approves the exact plan, that plan applies.
- **Audit and run history.** "Who applied what, when, against which commit, and what changed?" is a first-class, durable, linkable record. In CI it's log scrollback in an ephemeral job that ages out.
- **Cloud auth, once.** OIDC/Workload-Identity federation, per-stack least-privilege identities, secret injection — configured once on the platform, not re-plumbed into every workflow YAML.
- **Drift detection and policy gates.** Scheduled drift detection and [tested policy-as-code]({{< ref "spacelift-tested-policy-as-code" >}}) gates are features you turn on, not pipelines you maintain.

None of this is impossible in GitHub Actions. The point is that you end up **reimplementing an IaC control plane inside a CI tool**, and the reimplementation is the part that breaks.

## Collaboration is the underrated half

Beyond safety, the platform changes how a *team* works on infrastructure. Runs are PR-driven; the plan is rendered and reviewable in the platform, not buried in CI logs; approvals and role bindings make "who can apply to production" an explicit, auditable control rather than a branch-protection rule plus tribal knowledge. Infrastructure changes start to feel like code review — a shared, visible artifact people actually discuss — instead of a privileged operator running `apply` from a laptop and announcing it in Slack.

## The signal I didn't know I was missing: "0 to change"

Here's the benefit that surprised me most, and it's specific. Refactoring Terraform is nerve-wracking precisely because the scariest refactors are supposed to change *nothing real*: restructure modules, rename resources, introduce `for_each`, add `moved` blocks. The whole intent is that the **configuration** changes while the **infrastructure** stays byte-for-byte identical. But how do you *know* you didn't accidentally force a replacement of a database or a VPC?

Against a **stable, persistent test environment**, the platform answers this immediately. You open the refactor PR, the stack plans against the real deployed state, and the plan reads:

```
No changes. Your infrastructure matches the configuration.
Plan: 0 to add, 0 to change, 0 to destroy.
```

That `0/0/0` is a precise, visible, reviewable proof that the refactor is purely structural — it touched the code and nothing else. A non-zero plan is an instant, loud signal that you moved a resource you didn't mean to. Getting that feedback loop from raw CI means standing up a durable env, wiring state, and reading plan output out of job logs — all the things the platform already does. With a stable test env behind the stack, "did my refactor change anything?" goes from a leap of faith to a line in the plan.

## The general principle

Match the tool to the *shape* of the work, not just the verb. "It runs commands in CI" is true of `terraform apply`, but apply is a **stateful, serialized, approval-gated, audited** operation, and CI runners are **stateless, concurrent, ephemeral** executors. Every safety property you need for Terraform is something you'd have to add back on top of CI — and the homegrown version is exactly where the incidents come from.

GitHub Actions remains a great fit for building and testing. For *applying* Terraform across a team, a platform that treats state, locking, plan-approval, audit, drift, and policy as first-class isn't a luxury — it's the difference between infrastructure changes that are reviewable and reversible and ones that are a held breath. And as a bonus, against a stable environment it hands you the single most reassuring sentence in infrastructure work: *no changes.*
