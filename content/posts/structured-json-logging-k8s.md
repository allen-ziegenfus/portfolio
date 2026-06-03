+++
title = "Structured JSON logging for a legacy Java app on Kubernetes — without forking the image"
date = 2026-06-02
draft = false
summary = "How to retrofit machine-parseable JSON logging onto a legacy Java app on Kubernetes — both log4j2 and Tomcat's JUL — without forking the vendor image, as an opt-in, fail-open, cleanly revertible layer."
tags = ["Observability", "Kubernetes"]
images = ["/og/structured-json-logging-k8s.png"]
+++


Cloud log aggregators (Cloud Logging, Elasticsearch, Loki) want one thing from a workload: **structured JSON, one object per line, with consistent fields**. A legacy Java application typically gives you the opposite — two *different* streams of unstructured text. This is how I retrofitted machine-parseable JSON logging onto a large Java portal platform running on Kubernetes, as an opt-in, cleanly revertible layer that never patches the shipped image and never blocks pod startup.

## The problem: two logging subsystems, both unstructured

The container emits logs from two independent subsystems:

- **log4j2** — the application's own logs (the interesting ones: business logic, stack traces).
- **`java.util.logging` (JUL)** — Tomcat's container logs (startup, lifecycle, access).

Out of the box both write human-readable text in *different* formats. A log aggregator can't reliably parse either, and it certainly can't correlate them. To get clean ingestion you have to make **both** emit JSON, with a shared field schema, and you have to do it from outside the application — forking and rebuilding the vendor image to change logging config is exactly the kind of maintenance burden a platform team should refuse to take on.

## Constraints that shaped the design

1. **No patching the shipped artifacts.** The application JARs are vendor-built; modifying a core application JAR to change logging would have to be redone on every upgrade.
2. **Don't mutate persistent config.** Tomcat's `logging.properties` lives on a persistent volume. Rewriting a PV-backed file in place makes the change stateful and hard to revert.
3. **Opt-in and reversible.** Teams that don't want JSON logs should see no behavior change, and turning it off must revert cleanly.
4. **Fail open.** A logging-configuration problem must never prevent the pod from starting. Degraded logs are acceptable; a crash loop is not.

## The approach: inject at init time, through seams the platform already provides

A small init script runs at container startup (sourced by the existing entrypoint), before the JVM launches. It configures each subsystem through an extension point that already exists, rather than by modifying anything shipped.

**log4j2 (application logs) — via the classpath, not a patch.** The platform's logging bootstrap discovers log4j2 configuration by walking the classloader resource chain (`getResources()`), the same mechanism it uses to find extension configs. So instead of editing the application JAR, the script *drops* a log4j2 extension config and a JSON layout template into `WEB-INF/classes/META-INF` on the classpath, where the resource walk finds it through the webapp classloader's parent. The JSON layout itself comes from the `log4j-layout-template-json` plugin, fetched at init from a public artifact repository (with checksum verification and bounded timeouts/retries) and dropped alongside `log4j-core` in the shielded-container lib directory. No rebuild, no fork — just using the discovery seam the framework already exposes.

**JUL (Tomcat logs) — ephemeral override, never touch the PV.** The script reads the PV-backed `logging.properties`, strips the existing console-handler formatter line, appends one that selects a JSON formatter, and writes the result to an **ephemeral** path in the container's writable layer (wiped on every restart). It never writes back to the PV. It then points the JVM at the ephemeral file with `-Djava.util.logging.config.file=...`, relying on Java's last-definition-wins rule to override the default the launcher would otherwise apply. Disable the feature and the override simply isn't set; JUL falls back to the untouched PV config. The revert is automatic because nothing persistent ever changed.

**Opt-in + change detection.** The whole layer is gated behind a single flag (default off). A checksum annotation over the injected config is stamped onto the pod template, so any change to the layout, the extension config, or the script triggers a rolling restart automatically rather than silently drifting.

**Fail open.** The remote fetch of the layout plugin is the only step that can fail for external reasons, so it soft-fails: if the artifact repository is unreachable, JUL still emits JSON (its formatter ships with the runtime), log4j2 falls back to its default text layout, and the pod starts normally. You lose JSON on one stream, not availability.

## Schema normalization at the source

The two streams are normalized to a shared field set — timestamp, level, logger class, method, thread, message, throwable — so the aggregator sees one schema regardless of origin. Level names are mapped into the aggregator's severity vocabulary (e.g. `WARN → WARNING`, `FATAL → EMERGENCY`) at emission time, and a cloud-specific layout variant adds the aggregator's native correlation fields (insert ID, source location) so the platform's log UI lights up without a downstream transform. Normalizing at the source is cheaper and more reliable than teaching every consumer to reconcile two formats.

## A concrete payoff: Tomcat logs stop being errors

There's a specific operational misery this fixes. JUL's default `ConsoleHandler` writes **every** record — `INFO`, lifecycle chatter, routine startup messages, all of it — to **stderr**. GKE's logging agent, given no structured severity to go on, infers a line's severity from the stream it arrived on: stdout becomes `INFO`, and **stderr becomes `ERROR`**.[^gke] The result is that in Cloud Logging's Log Explorer, *every Tomcat log line shows up red as an `ERROR`* — including the entirely routine ones. Real errors are buried in a sea of false ones, and any alerting policy keyed on `ERROR` severity is worthless.

Emitting structured JSON with an explicit `severity` field fixes this directly: the agent parses the JSON and honors the per-line `severity` instead of falling back to the stream. An `INFO` Tomcat record is now classified `INFO`, even though it still rides stderr. The Log Explorer goes from uniformly red to correctly leveled — the difference between logs you can alert on and logs you scroll past.

## Validating it

Because the failure modes are subtle (a misplaced classpath resource silently does nothing; a JVM property in the wrong place is silently ignored), the change ships with a containerized integration test: it boots the real application image with the layer enabled and asserts that the emitted log lines parse as JSON with the expected fields, above a threshold ratio. That turns "the logs look right" into a check that fails loudly in CI.

## Portable lessons

- **Extend through the seam the framework already gives you.** A classloader resource-discovery path, an entrypoint hook, a JVM property override — these let you change behavior from outside the artifact. Forking the vendor image should be the last resort, not the first.
- **Never mutate config that lives on a persistent volume.** Write an ephemeral copy and override the pointer to it. The change stays stateless and the revert is free.
- **Logging must fail open.** Anything in the observability path that can fail for external reasons should degrade, never block startup.
- **Normalize the schema at the source.** One consistent shape out of the workload beats N reconciliations downstream.
- **Make severity explicit; never let the platform infer it from the stream.** A subsystem that logs everything to stderr gets silently classified as all-errors by stream-based heuristics. An explicit `severity` field in the payload is the only reliable signal.

[^gke]: When a log line carries no explicit severity, Google Cloud's logging agent infers it from the output stream — `stdout` → `INFO`, `stderr` → `ERROR`. Emitting a `severity` field in [structured JSON logs](https://cloud.google.com/logging/docs/structured-logging) overrides that inference.
