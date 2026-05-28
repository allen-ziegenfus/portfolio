# Allen Ziegenfus — Engineering Portfolio

Cloud-native / Kubernetes / SRE / platform engineering work samples and writing.

## Cloud-native infrastructure

- **KCL Multi-Step Pipeline for Crossplane Compositions** — working prototype demonstrating an alternative to the bundled `function-kcl` approach. Each composition layer is its own pipeline step; Helm concatenates shared context at template time. Avoids the Python bundler, wrapper schema, and indent-leak issues of the single-step approach. [Branch + README](https://github.com/allen-ziegenfus/liferay-portal/tree/LCD-51066) · Source material for the upcoming post *"When Go templates outgrow you: a typed-language replacement for Crossplane compositions."*

## Architecture decisions

- **PostgreSQL ownership-via-`cloudsqlsuperuser` for cross-environment Cloud SQL restore.** Pattern for handling table ownership drift during cross-environment database restores. When a backup is restored from environment A into environment B, IAM-based DB authentication breaks because table ownership still references environment A's per-environment service account. The fix: have all tables (including dynamically created ones) owned by the `cloudsqlsuperuser` role at creation time, so ownership stays valid across environments and the postgres root password no longer has to be reset after every cross-env restore.
  Commits & PR (public, on `cloudnative-team/liferay-portal`):
    - Earlier groundwork: [LCD-36761 — Make sure all PostgreSQL tables are owned by cloudsqlsuperuser](https://github.com/cloudnative-team/liferay-portal/commit/ebad9e755)
    - Refinement for dynamically-created tables: [LCD-51702 — Own tables as cloudsqlsuperuser to make cross-env restores easier](https://github.com/cloudnative-team/liferay-portal/commit/b55f47358279f)
    - Containing PR: [cloudnative-team/liferay-portal#110](https://github.com/cloudnative-team/liferay-portal/pull/110)
  Companion architectural proposal: internal page on eliminating the postgres root password entirely by granting the Liferay IAM service account `cloudsqlsuperuser` membership at instance creation time. Planned sanitization for external writeup.

- **StatefulSet vs Deployment for stateless-with-fragile-upgrade workloads** — *forthcoming.* ADR with live operational evidence from a production GKE workload upgrade, including the negative-evidence acknowledgment. Source material for blog post.

## Operational tooling

- **CI/CD UX for GitOps testing: ArgoCD patch-comment automation** — *forthcoming.* Pattern for posting ready-to-run `kubectl patch` commands as PR comments after Helm publish, so reviewers can test PR-versioned charts on a live cluster without manual chart-version lookups.

## Writing

- **[Ich fürchte mich so vor des Reviewers Wort](./writing/rilke-pastiche.md)** — a short pastiche after Rainer Maria Rilke, on the modern code review.

*Blog posts on cloud-native infrastructure topics will land here as drafts complete.*

## About

Cloud / infrastructure engineer. Specialty: Kubernetes, Crossplane, KCL, Terraform, GitHub Actions, GCP, AWS. 

