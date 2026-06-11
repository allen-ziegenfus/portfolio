+++
title = "When Go templates outgrow you: a typed-language alternative for Crossplane compositions"
date = 2026-05-23
draft = false
summary = "When Crossplane's Go-template compositions outgrow you — no types, no tests, global scope — KCL offers a typed, testable alternative. The multi-step pipeline architecture, and the bugs only end-to-end validation catches."
tags = ["Infrastructure as Code", "Kubernetes"]
images = ["/og/kcl-crossplane.png"]
+++

[Crossplane](https://www.crossplane.io/) lets you define cloud infrastructure as Kubernetes composite resources, with the actual resource emission handled by a composition pipeline. The default composition language is **Go templates** rendered by `function-go-templating`. For small compositions this works fine.

As the surface grows — more resource types, more shared logic, more conditional emission — four problems start recurring:

1. **Harder to test.** Go templates produce strings, so you verify by rendering and asserting on the output — golden-file diffs, schema validation (`crossplane render | crossplane resource validate`), policy checks. That works, but it's output-level testing bolted on after the fact; there's no **in-language unit testing** the way KCL gives you with `kcl test`.
2. **No static typing.** A typo in a CRD field name (`spec.forProvider.manifest`, `managementPolicies`) renders fine — the template language can't catch it. A `crossplane resource validate` pass against the CRDs *will* catch it, but that's a separate step after rendering, not feedback as you type; skip it and the typo fails at apply, where the attribution is "here's the rejected manifest," not "line 47 referenced a field that doesn't exist."
3. **Hard to know what a change will affect.** Templates are stringly-typed and globally scoped via `_helpers.tpl`. Any refactor requires reading every consumer to be safe.
4. **No editor support while authoring.** The resource YAML lives as strings inside the template — and if you template the template with Helm, inside that too — so the editor can't tell what the file is. No autocomplete on CRD fields, no jump-to-definition, no validation as you type; highlighting extensions handle one layer but nothing sees through the nesting. You edit blind and find out at render.

Once your composition crosses some complexity threshold — call it *"two engineers can no longer hold the full template surface in their heads"* — these become real costs.

Concretely, the composition that pushed me here was a *single* `function-go-templating` step: Helm concatenated a globals file and a series of numbered fragments (`iam`, `sql`, `storage`, …) into one inline template. About 25 values — instance names, connection strings, hashes, the region — were computed once at the top from the composite resource and shared across every fragment, purely by living in one template scope.

One idea would be to *"split it into multiple `function-go-templating` steps."* It doesn't decompose cleanly, and the reason is the heart of the problem: Go-template `$variables` are scoped to a **single template execution**. Each pipeline step is its own template with its own scope, so separate steps lose the shared globals — each would have to recompute the whole block, or you round-trip the genuinely cross-cutting values (service-account name, base name, region, hashes) through the pipeline's JSON `Context` and read `.context.x` instead of `$x`. `EnvironmentConfig` doesn't help: it holds pre-claim static config, not values computed from *this* composite at runtime. Every option is a way to *simulate* shared scope. That irreducible cross-cutting core — values that span resource groups and have to stay consistent — is exactly what a typed language with real module scope holds natively, and it's the honest reason to switch.

## KCL as the Alternative

[KCL (Kusion Configuration Language)](https://www.kcl-lang.io/) is an open-source, statically-typed configuration language for generating structured data. CNCF Sandbox project, Python-flavored syntax, schema-based type system. Hermetic and deterministic. Crossplane v2 supports it as a first-class composition function via `crossplane-function-kcl`. It sits between Go templates and a full custom composition function — more structure and type-safety than templating, far less build-ship-and-CVE-track overhead than shipping your own Go function — which makes it the sweet spot for config-shaped logic, not a default to reach for on small compositions.

For a Crossplane composition that has outgrown Go templates, KCL gives you:

- **Static typing of CRD references.** Field typos fail at `kcl run` instead of `kubectl apply`, and because KCL ships a language server, your editor gives autocomplete and jump-to-definition on CRD fields as you type. This isn't free: the KCL models don't ship for providers like GCP — you generate them from the CRDs (`kcl import -m crd`), import them, and regenerate on provider upgrades.
- **Native unit tests.** `kcl test` auto-discovers tests. You write per-layer assertions instead of checking rendered output after the fact.
- **Modules and schemas for composability.** Composition logic can be broken into per-layer files (e.g., `init.k`, `k8s_resources.k`, `sql.k`, `storage.k`) with proper import semantics. Shared utilities live in modules, not in a `_helpers.tpl` swamp.

## Testing: `crossplane render | crossplane resource validate` vs `kcl test`

Go templates give you exactly one place to check correctness — the **rendered output**:

```bash
# Validate the emitted resources against the provider CRDs (you supply them):
crossplane render xr.yaml composition.yaml functions.yaml \
  | crossplane resource validate extensions/ -

# Behavior is golden-file diffing:
crossplane render xr.yaml composition.yaml functions.yaml > out.yaml
diff out.yaml testdata/all-ready.golden.yaml
```

This catches field typos and shape errors — but only *after* rendering, against the CRDs, as a separate pass. There's no way to assert "this layer emits nothing when the database isn't ready" except by rendering that whole state and diffing the bytes.

KCL adds the layer Go templates can't have: **in-language unit tests on the composition logic itself.**

```python
# sql_test.k — colocated with sql.k, auto-discovered by `kcl test`
import .sql

test_emits_instance_when_ready = lambda {
    out = sql.compose({ready = True, region = "us-central1"})
    assert len(out) == 1
    assert out[0].kind == "DatabaseInstance"
}

test_emits_nothing_when_not_ready = lambda {
    out = sql.compose({ready = False})
    assert len(out) == 0   # the exact assertion the silent-empty bug needed
}
```

```bash
kcl test    # auto-discovers *_test.k, runs the assertions
kcl run     # type-checks: a CRD field typo fails here, not at kubectl apply
```

Three things separate these, and all trace to one fact — KCL is a language, a Go template is a string renderer. **(1)** KCL ships a test runner; with Go templates you assemble render + golden-diff + `validate` yourself. **(2)** Those DIY checks can only inspect the rendered *output*; KCL's tests call the *logic* and assert on the returned objects, before any render. **(3)** A golden file is a static byte-equality oracle; a KCL test is a *program* — it asserts relationships (`len(out) == len(regions)`), iterates over cases, and checks invariants across the output, instead of pinning exact bytes.

`kcl test` covers the *logic* per layer, but it does **not** replace `crossplane render | crossplane resource validate`. The keying mismatch below slipped past unit tests precisely because it only appears against a real cluster's `observed` resources. KCL gives you the in-language unit layer Go templates lack — *on top of*, not instead of, render-side validation.

## The Architecture: Multistep Pipeline, Not Bundled

Crossplane offers two ways to wire up KCL into a composition:

1. **Single bundled `function-kcl` step.** Concatenate all layers into one input. Requires a bundler (often Python) to assemble inputs, a `schema {layer}_layer:` indirection per layer so the bundled input stays addressable, and an indent step that can leak into string literals.
2. **Multistep pipeline.** Each composition layer is its own `function-kcl` step. The shared context is concatenated into each step's input at template time (e.g., by a small Helm helper).

The multistep shape is materially better:

- **No Python bundler.** No `schema {layer}_layer:` wrapper. No indent step that can corrupt string literals.
- **Per-step error attribution in the cluster.** When a step fails, the XR `Synced` condition names it (*"pipeline step 'init-status' returned a fatal result"*). The bundled architecture fails everything identically inside one opaque step.
- **Per-step logs in the function-kcl pod.** Each invocation produces its own log line.
- **Step ordering is declarative.** The pipeline YAML lists the order; reviewers see it directly.
- **Per-step lifecycle hooks** become available — conditional / skip behavior at step granularity.

The cost: more pipeline steps to declare, and a small impedance bridge between how KCL is authored on disk (modular, qualified imports, IDE-friendly docstrings) and what `function-kcl` accepts inline (one flat string with no filesystem). The bridging can be done at install time with a Helm helper (~30 lines), preserving the on-disk dev experience.

## What End-to-End Validation Surfaces (and Unit Tests Don't)

Validating against a real cluster — not just `kcl test` — surfaced a class of bugs that local builds, type-checks, and unit tests *all missed*:

- **`observed.resources` keying mismatch.** Go templates key by `composition-resource-name` annotation; `function-kcl`'s `params.ocds` keys by `metadata.name`. A direct port of an existing Go-template composition carries over the wrong keys. The dependent guards stay false; the corresponding resources are never emitted. **Hit four separate times during validation.**
- **Forward references in lambda bodies are accepted, not rejected.** KCL evaluates lambda bodies top-down; an identifier referenced before its assignment resolves to an empty value at the use site, which then propagates silently through the safe-navigation chain. A Go or Rust compiler would reject this as use-before-declare.
- **Fail-soft idioms make silent-empty indistinguishable from not-ready.** KCL's `?.` safe-navigation plus `or default` causes the entire chain to collapse to `[]` or `""` with no error. Then `if _is_ready:` evaluates false and the layer emits nothing. The cluster reports `Synced=True Ready=True` because *the composition successfully decided to emit nothing*. From outside, this is identical to "not yet ready, will retry next reconcile" — which it isn't.
- **Items envelope.** Every layer file ended with `items = {"items": get_items(...)}` — a bundler-era convention. When run as its own step under the multistep architecture, function-kcl received `items: {dict}` and rejected it (*"wrong node kind: expected SequenceNode but got MappingNode"*). The multistep pipeline named the failing step in the XR `Synced` condition — under the bundled architecture this would have failed inside the single opaque step.

**Defenses that catch this bug class:**

- **Per-state golden-file tests** — assert the exact emitted set for fixtures including "all-ready", "partially-ready", and "nothing-ready" states. Parity tests against captured output won't catch the keying mismatch because parity fixtures don't exercise post-readiness emission paths with a populated `ocds`.
- **Replace `?.` with `[]` on lookups required for correctness.** Use safe-navigation only for genuinely-optional fields; let required-but-missing data fail loudly during testing.
- **Render-side coverage.** Render the chart (`helm template`) in CI and run `kcl run` on each extracted step source. The bytes function-kcl actually runs are the Helm-rendered output, not the on-disk `.k` file — if your Helm helper regex is wrong, local tests pass but the cluster breaks.

## Distribution: Where This Gets Harder

The inline multistep approach embeds the KCL source for each step directly in the Composition CR. This is deliberate: no publish lane, no new OCI image, no new function CRD. The composition layer changes; the surrounding stack does not.

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

The inline multistep lane is the one that **defers this question indefinitely**. The bundler issues that pushed people toward "we'll need OCI eventually" are gone, and the multistep architecture can keep running without one. If the A/B succeeds and the team eventually wants a publish lane, the KCL-vs-Go decision becomes hands-on rather than theoretical — they've already lived with KCL idioms on internal work.

## References

- [KCL Language](https://www.kcl-lang.io/)
- [crossplane-function-kcl](https://github.com/crossplane-contrib/function-kcl)
- [Crossplane Compositions](https://docs.crossplane.io/latest/concepts/compositions/)
