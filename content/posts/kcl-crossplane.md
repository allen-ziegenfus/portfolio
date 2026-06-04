+++
title = "When Go templates outgrow you: a typed-language alternative for Crossplane compositions"
date = 2026-05-23
draft = false
summary = "When Crossplane's Go-template compositions outgrow you — no types, no tests, global scope — KCL offers a typed, testable alternative. The multi-step pipeline architecture, and the bugs only end-to-end validation catches."
tags = ["Infrastructure as Code", "Kubernetes"]
images = ["/og/kcl-crossplane.png"]
+++

[Crossplane](https://www.crossplane.io/) lets you define cloud infrastructure as Kubernetes composite resources, with the actual resource emission handled by a composition pipeline. The default composition language is **Go templates** rendered by `function-go-templating`. For small compositions this works fine.

As the surface grows — more resource types, more shared logic, more conditional emission — three problems start recurring:

1. **Hard to test.** Go templates produce strings. Verifying behavior means rendering YAML and grepping for fields. There is no native unit-test framework.
2. **No static typing.** A typo in a CRD field name (`spec.forProvider.manifest`, `managementPolicies`, etc.) renders fine and only fails at apply time inside the cluster — where the failure attribution is "your composition failed, here's the rejected manifest" rather than "line 47 referenced a field that doesn't exist."
3. **Hard to know what a change will affect.** Templates are stringly-typed and globally scoped via `_helpers.tpl`. Any refactor requires reading every consumer to be safe.

Once your composition crosses some complexity threshold — call it *"two engineers can no longer hold the full template surface in their heads"* — these become real costs.

## KCL as the alternative

[KCL (Kusion Configuration Language)](https://www.kcl-lang.io/) is an open-source, statically-typed configuration language for generating structured data. CNCF Sandbox project, Python-flavored syntax, schema-based type system. Hermetic and deterministic. Crossplane v2 supports it as a first-class composition function via `crossplane-function-kcl`.

For a Crossplane composition that has outgrown Go templates, KCL gives you:

- **Static typing of CRD references.** Provider models can be generated from your CRDs (`kcl-openapi`); field typos fail at `kcl run`, not at `kubectl apply`. The KCL LSP gives autocomplete and jump-to-definition on CRD fields.
- **Native unit tests.** `kcl test` auto-discovers tests. You write per-layer assertions instead of rendering YAML and grepping.
- **Modules and schemas for composability.** Composition logic can be broken into per-layer files (e.g., `init.k`, `k8s_resources.k`, `sql.k`, `storage.k`) with proper import semantics. Shared utilities live in modules, not in a `_helpers.tpl` swamp.

## The architecture: multi-step pipeline, not bundled

There are two ways to wire KCL into a Crossplane composition:

1. **Single bundled `function-kcl` step.** Concatenate all layers into one input. Requires a bundler (often Python) to assemble inputs, a `schema {layer}_layer:` indirection per layer so the bundled input stays addressable, and an indent step that can leak into string literals.
2. **Multi-step pipeline.** Each composition layer is its own `function-kcl` step. The shared context is concatenated into each step's input at template time (e.g., by a small Helm helper).

The multi-step shape is materially better:

- **No Python bundler.** No `schema {layer}_layer:` wrapper. No indent step that can corrupt string literals.
- **Per-step error attribution in the cluster.** When a step fails, the XR `Synced` condition names it (*"pipeline step 'init-status' returned a fatal result"*). The bundled architecture fails everything identically inside one opaque step.
- **Per-step logs in the function-kcl pod.** Each invocation produces its own log line.
- **Step ordering is declarative.** The pipeline YAML lists the order; reviewers see it directly.
- **Per-step lifecycle hooks** become available — conditional / skip behavior at step granularity.

The cost: more pipeline steps to declare, and a small impedance bridge between how KCL is authored on disk (modular, qualified imports, IDE-friendly docstrings) and what `function-kcl` accepts inline (one flat string with no filesystem). The bridging can be done at install time with a Helm helper (~30 lines), preserving the on-disk dev experience.

## What end-to-end validation surfaces (and unit tests don't)

Validating against a real cluster — not just `kcl test` — surfaced a class of bugs that local builds, type-checks, and unit tests *all missed*:

- **`observed.resources` keying mismatch.** Go templates key by `composition-resource-name` annotation; `function-kcl`'s `params.ocds` keys by `metadata.name`. A direct port of an existing Go-template composition carries over the wrong keys. The dependent guards stay false; the corresponding resources are never emitted. **Hit four separate times during validation.**
- **Forward references in lambda bodies are accepted, not rejected.** KCL evaluates lambda bodies top-down; an identifier referenced before its assignment resolves to an empty value at the use site, which then propagates silently through the safe-navigation chain. A Go or Rust compiler would reject this as use-before-declare.
- **Fail-soft idioms make silent-empty indistinguishable from not-ready.** KCL's `?.` safe-navigation plus `or default` causes the entire chain to collapse to `[]` or `""` with no error. Then `if _is_ready:` evaluates false and the layer emits nothing. The cluster reports `Synced=True Ready=True` because *the composition successfully decided to emit nothing*. From outside, this is identical to "not yet ready, will retry next reconcile" — which it isn't.
- **Items envelope.** Every layer file ended with `items = {"items": get_items(...)}` — a bundler-era convention. When run as its own step under the multi-step architecture, function-kcl received `items: {dict}` and rejected it (*"wrong node kind: expected SequenceNode but got MappingNode"*). The multi-step pipeline named the failing step in the XR `Synced` condition — under the bundled architecture this would have failed inside the single opaque step.

**Defenses that catch this bug class:**

- **Per-state golden-file tests** — assert the exact emitted set for fixtures including "all-ready", "partially-ready", and "nothing-ready" states. Parity tests against captured output won't catch the keying mismatch because parity fixtures don't exercise post-readiness emission paths with a populated `ocds`.
- **Replace `?.` with `[]` on lookups required for correctness.** Use safe-navigation only for genuinely-optional fields; let required-but-missing data fail loudly during testing.
- **Render-side coverage.** Render the chart (`helm template`) in CI and run `kcl run` on each extracted step source. The bytes function-kcl actually runs are the Helm-rendered output, not the on-disk `.k` file — if your Helm helper regex is wrong, local tests pass but the cluster breaks.

## Distribution: where this gets harder

The inline-multi-step approach embeds the KCL source for each step directly in the Composition CR. This is deliberate: no publish lane, no new OCI image, no new function CRD. The composition layer changes; the surrounding stack does not.

If you eventually outgrow inline distribution (composition exceeds Kubernetes' ~1 MiB CR limit, or cross-chart sharing becomes load-bearing), three lanes are worth comparing:

| | Inline KCL | KCL via OCI module | Custom Go composition function |
|---|---|---|---|
| Publish lane required | No | Yes (one repo, versioned) | Yes (one image, versioned) |
| Per-release maintenance | Push code | Push module | Push image + track CVEs + base-image upgrades + SBOM |
| Language familiarity on most teams | Narrow | Narrow | Wide |
| CRD type safety | Yes | Yes | Yes (via `function-sdk-go`) |
| Stack-trace quality | Source line numbers | Source line numbers | Native Go stack traces |
| Ecosystem maturity | `crossplane-function-kcl` is younger | Same | `function-sdk-go` more mature |

The honest tradeoff: **if KCL succeeds as an A/B against Go templates, that argues against Go templates — not automatically for KCL.** Once you accept a publish lane, custom Go composition functions become a real contender. Go is what most teams read and write today; `function-sdk-go` is more mature than `crossplane-function-kcl`; you get real Go stack traces.

The counter-argument: OCI distribution for KCL is operationally lighter than OCI distribution for Go. KCL OCI is config files only; Go OCI is a binary with a base image, CVE tracking, SBOM management, and image-version coordination. Same *publish* cost, very different *maintenance* cost.

The inline-multi-step lane is the one that **defers this question indefinitely**. The bundler issues that pushed people toward "we'll need OCI eventually" are gone, and the multi-step architecture can keep running without one. If the A/B succeeds and the team eventually wants a publish lane, the KCL-vs-Go decision becomes hands-on rather than theoretical — they've already lived with KCL idioms on internal work.

## References

- [KCL Language](https://www.kcl-lang.io/)
- [crossplane-function-kcl](https://github.com/crossplane-contrib/function-kcl)
- [Crossplane Compositions](https://docs.crossplane.io/latest/concepts/compositions/)
