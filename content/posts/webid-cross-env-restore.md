+++
title = "Stable vs. rewritten identity: cross-environment database restore in a stateful platform"
date = 2026-06-02
draft = false
tags = ["Kubernetes", "Databases"]
+++


When a stateful application bakes an environment-derived *identity* into its database on first boot, cross-environment database restore breaks in a way that's easy to misdiagnose and instructive to fix. This is a worked example from running a large Java portal platform on Kubernetes, but the shape of the problem and the decision behind the fix generalize to any platform that promotes data between environments.

## The failure

The platform seeds a default company (its top-level tenant) on first boot, keyed by a configured `web.id` property. The value is written into the company row in the database. At runtime, the portal *also* uses that same configured value to look up the default company — an internal lookup resolves the default tenant by matching the configured `web.id` against the persisted row.

On Kubernetes, the platform was rendering `web.id` **per environment**, derived from the environment's hostname (`{project}-{env}.example.com`). That's fine until you restore across environments — clone a dev database into UAT, or refresh a lower environment from a higher one:

1. Dev boots first, writes `company` with `webId = <dev value>`.
2. A volume-level restore of dev's database into UAT brings that row over verbatim.
3. UAT boots configured with `<uat value>`, looks up `company WHERE webId = <uat value>`, and finds nothing.
4. `getDefaultCompanyId()` throws `IllegalStateException: Unable to get default company ID`; initialization aborts; the container exits; the orchestrator restarts it; CrashLoopBackOff.

The symptom (a crash loop) points at the runtime. The cause is a **configuration value that is required to match a value persisted in the database** — and the platform was deriving that value differently in every environment.

## The root cause is older than it looks

Per-environment derivation wasn't a considered design choice; it was a workaround for an unrelated symptom ("the company ID kept changing") that traced back to a first-boot race when the workload ran with multiple replicas and no startup lock. Once the workload settled to a single replica behind a startup lock, the race could no longer happen — but the per-environment `web.id` lived on, no longer solving any real problem and now actively breaking restore. A classic case of a workaround outliving the bug it patched, and only surfacing when a *different* capability (cross-env restore) exercised it.

## The decision space

Three mechanisms, with materially different cost and reach:

1. **Stabilize the identity at seed time.** Default `web.id` to a *project-stable* value (independent of environment). Cheap, ships immediately, and removes the failure outright for the default tenant — the environments are already isolated by namespace, project, database instance, and credentials, so nothing of value is lost. This is also what the mature, longer-lived version of the same product platform had effectively converged on (a single stable value frozen across environments).

2. **Rewrite the identity after restore.** Run a post-restore step that updates the persisted identity (and its dependent rows — virtual hosts, and anything else keyed to the tenant) to match the target environment. More machinery to build and maintain, *but* it composes with two things you likely need anyway: **data sanitization** (you cannot land production PII in a lower environment unscrubbed) and **multi-tenant iteration** (if the platform hosts more than one tenant, the rewrite has to loop over all of them). If you're building a post-restore SQL hook for sanitization regardless, identity rewriting rides the same mechanism for free.

3. **Discover the identity from the database.** Have the runtime read the persisted value and align to it, rather than requiring config to match. The most robust in principle, the most invasive to retrofit.

## The decision is downstream of a tenancy question

The right *durable* mechanism is selected by a product question, not an engineering one: **is this single-tenant per deployment, or do we support multiple tenants / database partitioning?**

- **Single-tenant, forever:** stabilizing at seed time (option 1) is sufficient permanently. There's nothing to iterate over.
- **Multi-tenant or partitioned, or production→lower-environment restores that require PII sanitization:** the post-restore hook (option 2) becomes the durable home, because it's the only one of the three that scales to N tenants *and* subsumes sanitization in a single mechanism.

So the engineering recommendation is to **ship option 1 now** — it removes the crash, deletes the dead workaround, and is correct under *every* tenancy outcome — and **gate option 2 on the tenancy/sanitization answer**, rather than build the heavier, harder-to-reverse machinery before the product direction is settled. Fix the outage cheaply today; put the expensive, irreversible decision where it belongs.

## The deeper lesson

The real fragility isn't the per-environment value — it's the pattern of **identity that is both persisted in the database and required to match external configuration**. Any value with that dual role is a cross-environment portability hazard: the moment you move data between environments, the persisted copy and the configured copy disagree, and the system has no way to reconcile them except to fail.

The robust alternative is **database-as-source-of-truth for identity**: resolve the default tenant from the data itself (e.g. a flag on the row) and cache it, rather than requiring a configuration value to match what's already persisted. Configuration should *seed* identity on a greenfield install and then get out of the way — not remain a permanent second source of truth that every restore has to keep in sync. It's a twenty-year-old assumption (configured identity that the runtime trusts over the database) that predates cloud deployment patterns where promoting data between environments is routine.

That principle — *don't make a persisted identity depend on matching external config* — is the portable takeaway, and it applies well beyond this one platform.
