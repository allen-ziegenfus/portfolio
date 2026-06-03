+++
title = "StatefulSet vs Deployment for stateless-with-fragile-upgrade workloads"
date = 2026-05-28
draft = false
summary = "A decision record for a workload that's operationally stateless but has a fragile single-instance upgrade: StatefulSet vs Deployment, with live operational evidence and the case for Deployment plus a startup lock."
tags = ["Kubernetes"]
images = ["/og/statefulset-vs-deployment.png"]
+++

## Context

A common Kubernetes workload pattern: an application is **operationally stateless** (caches, work directories, JSP compile output — nothing that needs to survive a pod restart) but its **database upgrade procedure is fragile**. Specifically: the application's schema migration assumes only one instance of the application can be connected to the database while a migration runs. Run two, the upgrade can corrupt the schema.

This pattern is common for older applications that were not originally designed for cloud-native deployment — a large Java portal platform is the example throughout, but the same shape applies to many JVM applications with embedded schema-migration logic.

The question: should this workload run on a `Deployment` or a `StatefulSet`?

At chart inception, an informal decision picked `StatefulSet` on the reasoning that StatefulSet's ordered rolling-update semantics combined with manual scale-to-zero-first can guarantee the single-instance-during-upgrade invariant. The choice was not documented, and live operational evidence has surfaced costs that warrant a structured re-evaluation.

## Forces and constraints

- **Upgrade fragility is real.** Only one instance can be connected to the database while a schema migration runs. This is the strongest argument for any non-default deployment shape.
- **State is externalized.** Database, document library, search, secrets all live in managed services. The pod itself only holds transient cache/work-directory state.
- **Multi-AZ deployment is in scope.** GKE Persistent Disks are zonal by default. PVC zone affinity matters operationally.
- **Horizontal Pod Autoscaler is in scope** for traffic-based scaling.
- **Argo CD delivers the chart** via helm-rendered manifests. Immutable-field constraints and sync-wave annotations matter to operational behavior.
- This is a greenfield stack, so the decision can still be revisited at low cost.

## Options

### A. Keep StatefulSet (status quo)

`StatefulSet` with `volumeClaimTemplates` producing one ReadWriteOnce PVC per ordinal. Pods get stable DNS identities; ordered rolling-update semantics.

### B. Move to Deployment

`Deployment` with default `RollingUpdate` for steady-state (`maxSurge=1, maxUnavailable=0` for zero-downtime config changes at replicas=1). For upgrade: `strategy.type: Recreate` + scale-to-1 + an application-level startup lock. Persistent state goes only to externalized services.

### C. Custom workload-aware controller (CRD + operator)

An application-shaped CRD plus a controller that encapsulates the application's specific upgrade semantics (single-instance-during-upgrade, migration orchestration, rollback), using Deployment underneath.

### D. StatefulSet without `volumeClaimTemplates`

Keep `kind: StatefulSet`, replace per-pod RWO PVCs with `emptyDir`. Strict subset of Option B's work.

## Consequences

### Option A — StatefulSet

**Observed cons in live operations:**

- **Downtime on every spec change at replicas=1.** StatefulSet's rolling update kills the lone pod *before* the replacement starts. With a 2–3 minute boot time, every env-var change, config tweak, or annotation update produces a 2–3 min outage.
- **Per-pod cache divergence.** Each replica gets its own PVC. OSGi caches, work directories, and compiled-JSP state diverge across replicas — pods can serve different bundle versions or configuration states.
- **PVC accumulation on scale-down.** PVCs remain bound to the deleted ordinals' identities. Autoscaling amplifies this. Kubernetes 1.27+ added `persistentVolumeClaimRetentionPolicy.whenScaled: Delete`[^pvc] to address this, but it must be explicitly set.
- **Resize requires downtime.** Resizing `volumeClaimTemplates` requires deleting and recreating the StatefulSet (immutable field).
- **Broader immutable-field surface than Deployment.** `serviceName`, `selector`, `volumeClaimTemplates`, `podManagementPolicy` — all immutable. With Argo CD's apply path, hitting any of these requires either a destructive `Replace=true` sync (loses ordinal identity and data) or manual `kubectl delete --cascade=orphan` outside GitOps.
- **Zone-affinity PVC conflicts on multi-AZ clusters.** PVCs bind to a specific zone the first time they're provisioned. When the autoscaler later places a node in a different zone, the pod sits Pending indefinitely with `volume node affinity conflict`. Regional PDs avoid this but cost more.
- **HPA composition is awkward.** Stable identity is wasted for HTTP serving. `OrderedReady` serialization makes scale-up slow (ordinal N waits for ordinal N-1 to be Ready). KEDA scale-to-zero leaves PVCs stranded — the "zero cost when idle" promise degrades to "zero CPU when idle, still paying for stranded disks."

### Option B — Deployment

**Pros:**

- Zero downtime on steady-state spec changes via `RollingUpdate` with `maxSurge=1, maxUnavailable=0`, even at replicas=1.
- Upgrade safety achievable via `strategy.type: Recreate` + scale-to-1 + application startup lock. *This is a documented pattern the vendor's own managed cloud has used in production for years.*
- No PVC accumulation, no per-pod cache divergence, no zone-affinity trap.
- Smaller immutable-field surface.
- Natural HPA composition. KEDA scale-to-zero works.

**Cons:**

- Migration cost: chart changes, validation of the upgrade-safety path, PVC migration.
- Slightly weaker peer-identity guarantees (no stable DNS names). Application's current clustering uses application-layer discovery, so this is not an active constraint — but worth flagging if a future clustering protocol depends on stable DNS.
- Upgrade orchestration is more *configurable* than *declarative* — requires deliberate use of Recreate + lock + scale-to-1.

### Option C — Custom controller

**Pros:**

- Encapsulates application-specific upgrade knowledge in an application-specific abstraction. The upgrade procedure lives in the controller's reconciliation loop, not in chart annotations.
- Hides the Deployment-vs-StatefulSet question from chart consumers entirely.
- Foundation for future application-specific features (graceful drain during upgrade, traffic shifting between data planes).

**Cons:**

- Multi-week engineering investment. Building a production-grade operator is a project, not a sprint task.
- Yet another in-cluster controller to operate.
- Risks over-fitting to current constraints.
- Doesn't address the immediate operational pain from Option A in any near timeframe.

### Option D — StatefulSet without volumeClaimTemplates

**Pros:**

- Strictly better than Option A. Resolves cache divergence, PVC accumulation, resize downtime, zone-affinity failures, KEDA's stranded-disk problem — without changing the controller kind.
- Implementation cost is exactly the PVC-removal work. No semantic change for chart consumers; no Argo CD reconfiguration; no pod-identity migration.
- Doesn't preclude moving to Option B later — same work plus a future controller-kind swap.

**Cons:**

- **Preserves the downtime symptom** that drove this re-evaluation. StatefulSet's `RollingUpdate` still kills the lone pod before the replacement starts, regardless of attached storage.
- Doesn't address the conceptual mismatch (using a stable-identity primitive for stateless HTTP serving).
- Doesn't align with the vendor's published engineering position.
- Risks becoming a "stopping point" — once visible PVC symptoms are gone under Option D, political pressure to keep going to Option B diminishes.

## Recommendation

**Adopt Option B (Deployment) as the target end state. Treat Option C (custom controller) as a separate future initiative. Treat Option D as a defensible intermediate step if Option B faces near-term resistance — but only with a written commitment to follow through to B.**

Reasoning:

- Option B reverses the full set of operational pain points (downtime, PVC accumulation, cache divergence, immutable-field traps, zone-affinity failures, HPA incompatibility) without multi-week engineering investment.
- It aligns with the application vendor's own published engineering position.
- It does not preclude a future Option C: a custom controller can wrap Deployment underneath.
- The upgrade-safety argument is preserved via Recreate + startup lock + scale-to-1.
- The cost of being wrong is low: the stack is greenfield, the migration is straightforward, and a future custom controller can supersede this decision.

The cost of *not* deciding is higher than the cost of any of the four options. Leaving the choice undocumented means every future operator who sees a StatefulSet outage will rediscover the same arguments from scratch.

## Receipts

What the recommendation rests on, including negative evidence:

- **Vendor engineering position (published, written, attributed).** The vendor's managed-cloud documentation: *"The application and Backup services use the Deployment type, so that they can share access to the document library."* StatefulSet is reserved for CI services. This is the only public, written, vendor-authored defense of a K8s controller choice for the workload I could find — and it chooses Deployment.
- **Vendor-employee-authored tutorial (2020).** A published tutorial deploying the platform on Kubernetes demonstrates the workload-on-K8s with Deployment, multi-replica, application-layer clustering, shared persistence.
- **Production-deployed config from the vendor's own production cloud.** `strategy.type: Recreate` + application-level startup lock (`CONTAINER_STARTUP_LOCK_ENABLED=true`) + scale-to-1 — the documented upgrade-safety pattern in the vendor's own production cloud.
- **Live operational observations.** 2–3 minute downtime observed on env-var change applied to the StatefulSet at replicas=1; multiple immutable-field traps hit during Argo CD synchronization on routine chart updates.
- **Community ecosystem signal.** All publicly available community Helm charts for this workload (multiple independent implementations) use Deployment. These are mostly hobby projects, so the signal is weak individually — but it indicates that practitioners reaching for the workload-on-K8s default to Deployment without feeling the need to justify it.
- **Negative evidence (acknowledged).** No public, vendor-engineering-authored artifact defends StatefulSet for this workload. The vendor's K8s deployment videos either use StatefulSet without justifying it or don't address the choice at all. The strongest argument *for* StatefulSet — the senior IC's upgrade-safety reasoning — was not written down anywhere and was not validated against the vendor-cloud Deployment counter-example.

## Open questions

- If we adopt Option B: what is the migration path for any existing StatefulSet PVCs? Likely "discard, since they only hold ephemeral cache state" — but worth confirming.
- If we adopt Option B: do we revisit HPA and KEDA configuration to take advantage of the cleaner scaling model?
- If we adopt Option D as an intermediate: do we set a target date for the follow-on Option B migration so the intermediate doesn't become permanent?
- If we adopt Option C: who owns the operator? What's the timeline? Does it block Option B in the interim?
- Is there a stronger upgrade-safety argument for StatefulSet that hasn't been written down anywhere — i.e., is the original argument complete, or is there additional context that wasn't captured?

---

*This documents an architectural reconsideration I led for the GKE deployment of a Java application with fragile database-upgrade semantics. The recommendation has not been formally accepted at time of writing — the document exists to put the alternatives, the evidence, and the consequences on the record so that whichever direction is chosen is chosen* with *the analysis, not* around *it.*

[^pvc]: Kubernetes [`persistentVolumeClaimRetentionPolicy`](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#persistentvolumeclaim-retention) (stable as of v1.27) lets a StatefulSet delete its PVCs on scale-down or deletion instead of retaining them.
