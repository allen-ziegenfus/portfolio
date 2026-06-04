+++
title = "Environment-stable table ownership: surviving cross-environment restore with IAM database auth"
date = 2026-05-16
draft = false
summary = "Cloud SQL IAM database auth breaks cross-environment restores because table ownership encodes a per-environment service account. Make ownership environment-independent by owning every table as cloudsqlsuperuser."
tags = ["Databases", "Security", "GCP"]
images = ["/og/cloudsqlsuperuser-table-ownership.png"]
+++


Cloud SQL for PostgreSQL with **IAM database authentication** is an attractive pattern: each workload connects as a Google service account, there are no database passwords to rotate or leak, and access is governed by IAM. But IAM auth interacts badly with a routine platform operation — **restoring a database from one environment into another** — in a way that's easy to misdiagnose. The root cause is *object ownership*, and the fix is to make ownership environment-independent. This is a worked example from running a large Java platform on GKE, but it applies to any platform that uses per-environment database identities and promotes data between environments.

## The setup

Each environment (dev, stg, prd) runs the application as its own per-environment IAM service account, and that SA is the PostgreSQL role the app connects as:

```
app-stg-infra-sa@<project>.iam   →  the DB user in staging
app-prd-infra-sa@<project>.iam   →  the DB user in production
```

When the application creates a table, that table is **owned by the role that created it** — the per-environment SA. So in staging, every table is owned by `...-stg-infra-sa`; in production, by `...-prd-infra-sa`. Ownership is baked into the data, keyed by a role name that is *different in every environment*.

## The failure

Now restore staging's database into a fresh production instance (or refresh a lower environment from a higher one). PostgreSQL preserves object ownership **by role name**. After the restore, production's tables are owned by `...-stg-infra-sa` — a role that may not even exist on the production instance, and certainly isn't the role production's app connects as.

Two things break:

1. **Ownership-gated DDL fails.** The production app, connected as `...-prd-infra-sa`, can't `ALTER`/`DROP`/re-own tables it doesn't own. Schema upgrades and any owner-only operation fail.
2. **The restore itself needs a privileged actor.** To re-own objects or run the grant fix-ups, you need a role with authority over all of them. On Cloud SQL that pulls you toward the `postgres` superuser-equivalent — which is why teams end up **resetting the `postgres` password after every cross-environment restore** (`gcloud sql users set-password postgres ...`) and maintaining a dedicated DB-admin service account just to perform the re-owning. That's a recurring manual step and a standing credential, both of which exist only to paper over the ownership mismatch.

The symptom looks like a permissions or auth problem. The cause is that **ownership is a per-environment identity persisted in the data**, and restore moves the data without translating the identity.

## The fix: own everything as `cloudsqlsuperuser`

Cloud SQL provides a built-in role, **`cloudsqlsuperuser`**, that exists *identically on every Cloud SQL instance* (it's the closest thing Cloud SQL offers to a real superuser, since it withholds true `SUPERUSER`).[^cloudsql] If every table is owned by `cloudsqlsuperuser` instead of by the per-environment SA, ownership becomes **environment-independent**:

- A staging dump restored into production arrives with all objects owned by `cloudsqlsuperuser` — a role that already exists in production and means the same thing there.
- The per-environment app SA no longer needs to *own* tables; it only needs the **privileges** to use them (`SELECT`/`INSERT`/`UPDATE`/`DELETE`, `USAGE` on sequences, etc.), granted via role membership or default privileges.
- No post-restore re-owning step. No `postgres` password reset. Nothing keyed to the source environment to translate.

The subtlety that makes this real rather than aspirational is **dynamically created tables**. It's not enough to set ownership on the tables that exist at provisioning time — a large application platform creates tables at runtime (per feature, per deployment). Those must *also* land as `cloudsqlsuperuser`-owned, or the next cross-env restore reintroduces exactly the mismatch you just eliminated. The durable fix sets the owning role such that every table, including ones created later, is owned by `cloudsqlsuperuser` at creation time.

## The next step: delete the root password and the DB-admin SA entirely

Once ownership is environment-stable, the two pieces of machinery that existed only to manage it become removable. The proposal: grant the application's IAM service account `cloudsqlsuperuser` **membership at instance-creation time**:

```shell
gcloud sql users insert <app-iam-sa> \
  --instance=<instance> \
  --type=CLOUD_IAM_SERVICE_ACCOUNT \
  --database-roles=cloudsqlsuperuser
```

With the app SA already a member of `cloudsqlsuperuser`:

- **The dedicated DB-admin service account goes away** — there's no longer a separate privileged identity needed to perform owner-level operations.
- **The `postgres` root password goes away** — nothing in the normal lifecycle (provision, deploy, restore, upgrade) needs to authenticate as `postgres`, so there's no password to reset after restores and no standing root credential to secure.

The cross-environment restore flow collapses to "restore the data" — no identity translation, no privileged fix-up step, no credential reset.

## The general principle

This is the same failure family as [stable-vs-rewritten *identity* across environments]({{< ref "webid-cross-env-restore" >}}): **a value persisted in the database that also encodes which environment it belongs to is a cross-environment portability hazard.** There the value was a tenant's `web.id`; here it's *object ownership*. In both cases the moment you move data between environments, the persisted copy disagrees with the target environment, and the system has no way to reconcile it except to fail or to bolt on a translation step.

The robust pattern is to **separate identity-for-access from identity-for-ownership**. Let the per-environment IAM SA carry *access* (it's the right place for least-privilege, per-environment credentials), but anchor *ownership* to a role that is constant across environments. Ownership baked into data should be environment-invariant; anything environment-specific belongs in the grant layer, not the ownership layer. Get that separation right and cross-environment restore stops being a special operation with its own fix-up choreography — it becomes a plain data copy.

[^cloudsql]: `cloudsqlsuperuser` is the default superuser role Cloud SQL grants to the user accounts you create; the managed service withholds the true PostgreSQL `SUPERUSER` attribute. See [Cloud SQL for PostgreSQL users](https://cloud.google.com/sql/docs/postgres/users) and [IAM database authentication](https://cloud.google.com/sql/docs/postgres/iam-authentication).
