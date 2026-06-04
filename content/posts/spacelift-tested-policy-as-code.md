+++
title = "Test your guardrails: policy-as-code that you actually verify"
date = 2026-05-11
draft = false
summary = "Policy-as-code that's never tested usually fails open — it waves violations through and no one notices. How to test guardrails so they both deny when they must and pass when they must."
tags = ["Infrastructure as Code", "Security"]
images = ["/og/spacelift-tested-policy-as-code.png"]
+++


Policy-as-code is now standard in IaC pipelines: an OPA/Rego policy inspects each plan and `deny`s the run if it violates a rule — a failed Checkov check, a CRITICAL Trivy CVE, a cost increase over budget, a verified secret. The policy *is* the guardrail. But a guardrail is only as good as your confidence that it fires when it should — and **stays quiet when it shouldn't**. An untested policy that silently passes everything is worse than no policy: it manufactures the *appearance* of enforcement while enforcing nothing.

So the discipline I'd argue for: **every policy ships with a unit-test suite, run in CI like any other code.** This is from a Spacelift setup where each of the plan/push policies — Checkov, Trivy, TFLint, Kubeconform, Infracost, TruffleHog — had a sibling `*_test.rego`.

## A policy and the ways it silently breaks

Here's the Checkov gate. It reads Checkov's findings out of the run metadata, `deny`s if any check failed, and emits a `warn` per finding:

```rego
package spacelift
import rego.v1

count_checkov_failures(payload) := c if {
    c := payload.summary.total_failed
} else := c if {
    c := sum([f | f := payload.results[_].summary.failed])
} else := 0

get_metadata(name) := val if {
    val := input.third_party_metadata.custom[name]
} else := val if {
    val := input.third_party_metadata[name]
}

deny contains msg if {
    payload := get_metadata("checkov")
    failed := count_checkov_failures(payload)
    failed > 0
    msg := sprintf("🛡️ found %d failed checkov security checks.", [failed])
}
```

Look at how many ways this passes silently if you get it slightly wrong:

- **The metadata path.** Findings live at `input.third_party_metadata.custom.checkov` in one tool version and `input.third_party_metadata.checkov` in another. Hard-code the wrong one and `get_metadata` returns undefined, `count_checkov_failures` falls through to `0`, and **every run passes** — no error, just a green check that means nothing.
- **The summary shape.** Some emitters report `summary.total_failed`; others only a per-result `results[_].summary.failed`. Handle one format and the other reads as zero failures.
- **The threshold.** For the Infracost gate, is the budget `> $300` or `>= $300`? Off by one comparison and a run at exactly the limit goes the wrong way.

None of these throw. They all fail *open*. You'd never notice until an actual violation sailed through.

## The tests pin exactly those failure modes

```rego
package spacelift
import rego.v1

test_count_failures_standard_format if {
    count_checkov_failures({"summary": {"total_failed": 5}}) == 5
}
test_count_failures_fallback_format if {
    count_checkov_failures({"results": [{"summary": {"failed": 2}}, {"summary": {"failed": 1}}]}) == 3
}
test_deny_on_failures if {
    mock := {"third_party_metadata": {"custom": {"checkov": {"summary": {"total_failed": 1}, "failed_checks": []}}}}
    count(deny) > 0 with input as mock
}
test_no_deny_when_passing if {
    mock := {"third_party_metadata": {"custom": {"checkov": {"summary": {"total_failed": 0}, "failed_checks": []}}}}
    deny == set() with input as mock
}
```

The shape of a good guardrail test is **both directions and the boundary**:

- It **denies when it must** (`test_deny_on_failures`).
- It **passes when it must** (`test_no_deny_when_passing`) — this is the one people skip, and it's the one that catches a policy that denies everything (also useless: it gets disabled within a week).
- It pins the **boundary** — for Infracost, an explicit case that `$300` exactly does *not* deny because the rule is `>`, not `>=`. For Trivy, that CRITICAL and HIGH deny while MEDIUM and LOW only `warn`.
- It covers **every input format** the upstream tool can emit, with `with input as mock` feeding synthetic metadata.

`opa test` runs them. (One wrinkle worth documenting: because all the policies share `package spacelift` and define the same helper names — `get_metadata`, `count_checkov_failures` — loading every file together collides. Each suite runs against only its own policy file: `opa test policies/checkov.rego policies/checkov_test.rego`.)

## The general principle

A guardrail is **control-plane code that runs on every change and is supposed to say "no."** That makes it exactly the code you most need to test, because its failure mode is invisible: a broken guardrail doesn't crash, it just stops guarding, and the dashboard stays green. The cost of being wrong is paid later, by whatever the policy was supposed to catch — a secret in state, a public bucket, a 10× cost regression.

Treat policies like the security-critical code they are: assert they fire on the bad input, assert they stay quiet on the good input, pin the threshold, and cover every metadata shape the source tool emits. The test suite is what converts "we have a Checkov policy" into "we know our Checkov policy works." Those are very different claims, and only one of them survives an audit.
