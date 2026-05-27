# Allen Ziegenfus — Engineering Portfolio

Cloud-native / Kubernetes / SRE / platform engineering work samples and writing.

## Cloud-native infrastructure

- **KCL Multi-Step Pipeline for Crossplane Compositions** — working prototype demonstrating an alternative to the bundled `function-kcl` approach. Each composition layer is its own pipeline step; Helm concatenates shared context at template time. Avoids the Python bundler, wrapper schema, and indent-leak issues of the single-step approach. [Branch + README](https://github.com/allen-ziegenfus/liferay-portal/tree/LCD-51066) · Source material for the upcoming post *"When Go templates outgrow you: a typed-language replacement for Crossplane compositions."*

## Architecture decisions

- **StatefulSet vs Deployment for stateless-with-fragile-upgrade workloads** — *forthcoming.* ADR with live operational evidence from a production GKE workload upgrade, including the negative-evidence acknowledgment. Source material for blog post.

## Operational tooling

- **CI/CD UX for GitOps testing: ArgoCD patch-comment automation** — *forthcoming.* Pattern for posting ready-to-run `kubectl patch` commands as PR comments after Helm publish, so reviewers can test PR-versioned charts on a live cluster without manual chart-version lookups.

## Writing

*Blog posts will be linked here as they land.*

## About

Cloud / infrastructure engineer. Specialty: Kubernetes, Crossplane, KCL, Terraform, GitHub Actions, GCP, AWS. Interested in roles at K8s/SRE-focused platform-engineering shops.

Contact: see profile · CV: link forthcoming.
