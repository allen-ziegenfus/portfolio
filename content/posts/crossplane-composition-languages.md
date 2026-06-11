+++
title = "Crossplane composition languages: a field guide"
date = 2026-06-05
draft = true
slug = "crossplane-composition-languages"
summary = "Patch-and-transform, Go templates, KCL, a custom Go function — the spectrum of ways to write a Crossplane composition, what each costs, and how to choose. With the trick for keeping Go templates editable on disk."
tags = ["Infrastructure as Code", "Kubernetes"]
+++

> **Draft.** Companion to the KCL experience report. This one is the survey: the
> full spectrum of composition languages with honest pros/cons, plus the
> on-disk-editing mechanics the experience report only gestures at.

A Crossplane composition turns one composite resource (XR) into a set of managed
resources. In v2 the composition runs as a **pipeline of functions**, and the
function you pick decides what language you write that logic in. The choices run
from "no logic at all" to "a full programming language," and most teams pick one
without seeing the whole spectrum first.

## The spectrum

From least to most power (and least to most setup cost):

1. **Function patch-and-transform** — declarative field mapping, no control flow.
   Patches, transforms, simple type conversions. The right answer when the
   composition is "copy these fields onto these resources" and nothing branches.
2. **Go templates** (`function-go-templating`) — string templating with Go's
   `text/template` plus Sprig. Conditionals, ranges, helpers. Untyped; produces
   strings. The default for "I need a little logic."
3. **CEL / filtering functions** (`function-cel-filter`, `function-auto-ready`,
   `function-environment-configs`, `function-extra-resources`) — small, focused
   functions you compose *alongside* the main one rather than instead of it.
4. **KCL** (`function-kcl`) — a typed, testable configuration language. Schemas,
   modules, `kcl test`. The middle of the spectrum: more than templates, less
   than a general-purpose language.
5. **Custom Go function** (`function-sdk-go`) — write the function yourself in Go.
   Full power, real stack traces, real tests — at the cost of building, shipping,
   and maintaining a container image.

<!-- TODO: one sentence on function-cue / function-jinja as honorable mentions. -->

## The comparison

<!-- TODO: flesh out; this is the table the experience report seeds with the
     inline / OCI / custom-Go distribution table. Extend it across all five. -->

| | Patch-and-transform | Go templates | KCL | Custom Go function |
|---|---|---|---|---|
| Control flow | None | Yes | Yes | Yes |
| Static typing | N/A | No | Yes (generated CRD models) | Yes |
| In-language unit tests | No | No | `kcl test` | Go test |
| Editor support | N/A | Highlighting only | Autocomplete + jump-to-def | Full |
| Setup cost | Lowest | Low | Medium (generate CRD bindings) | Highest (build + ship image) |
| Distribution | Inline | Inline / Helm-concat | Inline / OCI module | OCI image |

## Keeping Go templates editable on disk

The thing the experience report only mentions: `function-go-templating` accepts the
template two ways.

- **`source: Inline`** — one string embedded in the Composition CR. This is what
  runs in practice.
- **`source: FileSystem`** — reads from a directory *inside the function pod's
  filesystem*, not your repo. To use it you bake templates into a custom function
  image — at which point you're on the custom-function lane anyway.

So in practice the runtime artifact is one inline string, and the function pod
never sees your repo. To keep fragments editable on disk and still feed them
inline, you reassemble them at package time. Helm is the common bridge:

```yaml
# templates/composition.yaml (Helm)
        source: Inline
        inline:
          template: |
{{- range $path, $_ := .Files.Glob "compositions/*.gotmpl" }}
{{ $.Files.Get $path | nindent 12 }}
{{- end }}
```

The consequence worth stating loudly: **the bytes the function actually runs are
the Helm-rendered concatenation, not your on-disk files.** Test the rendered
output, not the source. <!-- TODO: link the experience report's render-side-coverage point -->

## How to choose

<!-- TODO: decision tree.
  - No branching -> patch-and-transform.
  - A little logic, small surface, team knows nobody else will -> Go templates.
  - Logic + many shared values + you want tests/types -> KCL.
  - You already accept a publish lane and the team lives in Go -> custom function.
  Tie it back to: "if KCL beats Go templates, that argues against Go templates,
  not automatically for KCL." -->

## References

- [Crossplane composition functions](https://docs.crossplane.io/latest/concepts/composition-functions/)
- [function-go-templating](https://github.com/crossplane-contrib/function-go-templating)
- [function-kcl](https://github.com/crossplane-contrib/function-kcl)
- [function-sdk-go](https://github.com/crossplane/function-sdk-go)
