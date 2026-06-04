+++
title = "What is code review actually for?"
slug = "what-code-review-is-actually-for"
date = 2026-06-03
draft = false
summary = "The mandatory, blocking PR gate is barely fifteen years old — and the research says review's value diverges from its justification. What code review is actually for, and why most of its jobs are better served elsewhere."
tags = ["SDLC"]
images = ["/og/code-review-form-vs-function.png"]
+++

> *I am so afraid of the reviewer's word.*
> — the opening of a Rilke pastiche I wrote; the whole poem is at the end.

Pull on that feeling and it's worth asking what the practice is actually *for*. Code review is one of the few engineering rituals we treat as non-negotiable — every change, through a gate, before it ships. That near-universality is recent, and the gap between why we say we do it and what it actually delivers is wider than the ritual's status suggests.

## The form is younger than it looks

Code review as a *concept* is old: Michael Fagan formalized software inspection at IBM in 1976.[^fagan] But Fagan inspections were heavyweight and selective — scheduled meetings, defined roles, reserved for code that warranted the cost. They measurably found defects, precisely because they were expensive enough to be done seriously and rare enough to be done only where it paid.

Early in my career, at a government contractor, "code review" meant something else again: once a year the engineers gathered in a room with code projected on the wall and worked through samples together, calibrating a shared sense of what *good* looked like. No per-change gate — a periodic, collective quality calibration that built shared judgment rather than policing individual diffs.

The thing we now treat as mandatory — a lightweight, asynchronous, *blocking* pull-request gate on **every** change — is a product of the GitHub-PR era, barely fifteen years old. It's one form among several, and we adopted it near-universally in a fraction of the time it took to understand it.

## What the Research Actually Says

The most-cited empirical study of modern code review — Bacchelli and Bird's *Expectations, Outcomes, and Challenges of Modern Code Review* (Microsoft Research, 2013)[^bacchelli] — found a telling gap: the thing developers most *expect* from review (finding defects) is **not** its main *outcome*. The dominant realized value is knowledge transfer, shared awareness of the codebase, and incremental improvement. Review still finds defects — just fewer, and on lower-severity issues, than the bug-hunting framing assumes — and under time pressure much of it stays shallow.

That's a sharper claim than "review doesn't work." It's that **review's value diverges from its justification.** We sell it as a quality gate; it pays out mostly as a communication mechanism. Knowledge transfer is genuinely valuable — but it means we're often optimizing the ritual for the wrong thing.

## Form Without Function

When review is run as a *gate*, the rational incentive for everyone involved is to clear the gate — and the cheapest, most legible way to demonstrate that review *happened* is to comment on what's easiest to see: formatting, naming, brace placement, sort order. Style.

This is form without function: the ceremony of review without the substantive engagement that creates its actual value. And it's one of the worst-shaped feedback loops in the pipeline — a human, on their own schedule, applying rules that sometimes didn't exist until they were applied to you. Slow, unpredictable, and frequently about the wrong things. Tests give you feedback in seconds; a deterministic pipeline converges in a minute; a style-gate review can sit for two days and then block on a comma.

There's a quieter loss in the same vein. Review often *surfaces* genuinely useful context — why a choice was made, what was tried, what to watch out for — but that context lives in PR comment threads, which are notoriously hard to find again. The understanding the conversation generated ends up buried in a UI nobody greps six months later, detached from the code it explains. The discussion happens; the knowledge evaporates.

## Review isn't risk-free either

We discuss review as pure upside, but it has its own failure mode: the correction that *introduces* the bug. A reviewer suggests a "cleaner" rename or a small refactor; it looks harmless, the tests stay green, and it ships a regression the original author would never have written — because the author's domain context is strongest at the moment of writing and weakest by the time they're triaging comments days later. A small style change is not automatically a safe change.

Meanwhile the defects that actually matter tend to surface from **production observability** — real signals from the field — far more reliably than from a reviewer speculating about code paths they didn't write. Review trades on intuition; the field trades on facts.

## Be honest about what the PR even is

A surprising amount of review friction comes from an unstated question: what is this PR *claiming* to be? Finished, tested, production-ready code — or a design sketch floated for early comment? Those want completely different responses, and GitHub's signals for the distinction (draft PRs, labels, conventions) are inconsistent and frequently unknown to the people reviewing.

Discovery compounds it: how does a teammate even *know* which PRs need their eyes, and when? And every answer carries a cost we rarely price — pulling someone out of flow to review a change is an interrupt, and interrupts are expensive. "Who reviews what, and at what stage" deserves to be a deliberate decision, not an ambient expectation that everyone reviews everything, always.

## AI moves the goalposts

Two of review's load-bearing benefits are shifting under it. The first is *"you learn the codebase by reading other people's changes"* — a real benefit that erodes when comprehension is cheap on demand and a model can explain any file in seconds. The second is bigger: as more code is machine-generated, review's job quietly changes from *onboarding a human author* to *verifying machine output* — a different activity, with different failure modes, that the human-to-human PR gate was never designed for.

This second shift is a projection, not a finding. It's early, the evidence isn't in, and I could be wrong about the pace — treat it as a hypothesis to watch, not a settled claim.

## Match the mechanism to the purpose

None of this argues for shipping unreviewed code. It argues for being honest about what you want from review and routing each goal to the mechanism that actually delivers it:

- **Want to catch the mechanical defects?** Invest where those are actually caught: tests, types, static analysis, property-based checks, design review *before* code is written, and production observability once it's running — which reports what's *actually* broken instead of what a reviewer imagines might be.
- **Want knowledge transfer?** Optimize for understanding, not gatekeeping: pairing, walkthroughs, review-for-comprehension. Don't dress communication up as a quality control it isn't.
- **Want human judgment?** Reserve human review for what only a human catches: does this solve the right problem, does it fit the system, is the design sound — plus the security holes, broken assumptions, and logic errors no test was written to check. That's the highest-value thing review can do — and it's exactly what gets crowded out when the same review is also expected to police whitespace.

And notice how little is left for the gate. The jobs review is most often *used* for — consistency and alignment — are exactly the ones other mechanisms do better. Style belongs to **linters**, run on save or in CI: instant, deterministic, never political. Team conventions belong in **shared, distributed tooling** — a common formatter config, and increasingly a shared set of AI rules and skills every engineer runs locally — so alignment is baked into everyone's environment *before* code is written, not policed after the fact by whoever happens to review. Knowledge transfer is **pairing's** native job: the same understanding plus a real review, in real time, with none of the gate's async lag. Subtract all of that, and what's left for a human reviewer is small and genuinely valuable — the design judgment only a person brings — which is precisely what the all-purpose gate crowds out.

It's no coincidence that heavy review gates tend to travel with heavy, infrequent, painful releases — both are the same ceremony-first instinct. DORA — the *DevOps Research and Assessment* program[^dora] — found the high performers go the other way: lightweight process and *frequent*, small, reversible deploys correlate with better stability, not worse. The gate *feels* like safety; the data says fast and reversible is safer.

Low-ceremony, substantive review beats high-ceremony style-gating on most of the axes that matter. Be intentional about what review is *for* and *who* is involved. The dread in the poem below isn't of feedback — good feedback is a gift. It's of the *gate*: slow, unpredictable, aimed at the wrong target. Fix the loop, and the reviewer's word stops being something to fear.

---

## Coda — a Rilke pastiche

A short pastiche of Rainer Maria Rilke's *Ich fürchte mich so vor der Menschen Wort* (from *Mir zur Feier*, 1899), reimagined for the modern code review. The original is about how categorical naming flattens the world — *"die Dinge singen hör ich so gern. Ihr rührt sie an: sie sind starr und stumm"* (*I love so much to hear the things sing. You touch them: they become rigid and mute*). The pastiche keeps the three-quatrain structure and the closing-line punch, swapping source-formatting concerns for Rilke's *Hund / Haus / Berg / Garten*.

### Original — Rainer Maria Rilke, *Mir zur Feier* (1899)

Ich fürchte mich so vor der Menschen Wort.  
Sie sprechen alles so deutlich aus:  
Und dieses heißt Hund und jenes heißt Haus,  
und hier ist Beginn und das Ende ist dort.

Mich bangt auch ihr Sinn, ihr Spiel mit dem Spott,  
sie wissen alles, was wird und war;  
kein Berg ist ihnen mehr wunderbar;  
ihr Garten und Gut grenzt grade an Gott.

Ich will immer warnen und wehren: Bleibt fern.  
Die Dinge singen hör ich so gern.  
Ihr rührt sie an: sie sind starr und stumm.  
Ihr bringt mir alle die Dinge um.

— [Rainer Maria Rilke](https://en.wikipedia.org/wiki/Rainer_Maria_Rilke), *Mir zur Feier* (1899). Public domain.

### Pastiche — German

Ich fürchte mich so vor des Reviewers Wort.  
Er ordnet die Token so deutlich aus:  
ein jedes Komma gehört in sein Haus,  
und hier ist der Tab und das Leerzeichen dort.

Mich bangt auch ihr Werk, ihr Spiel mit dem Spott,  
sie wissen alles, wie's gewesen war;  
kein Code ist ihnen mehr wunderbar;  
ihr Format und Stil grenzt grade an Gott.

Ich will immer warnen und wehren: bleibt fern.  
Den Code, der läuft, seh ich so gern.  
Ihr rührt ihn an: er wird starr und stumm.  
Ihr bringt mir alle Funktionen um.

### Pastiche — English

I am so afraid of the reviewer's word.  
He formats the tokens so clearly and with haste.  
Every comma belongs only in its place.  
And this is the tab and this is the space.

Their work alarms me too, their play with scorn;  
they know each line and where each clause must go;  
no running system for them is wonderful to know;  
their format and style so pious and concerned.

I want to warn them: stay your hand.  
The code in production — I love to see it run.  
You touch it: rigid, mute, a frozen thing.  
You kill each optimization that I'd planned.

[^fagan]: Michael E. Fagan, "Design and Code Inspections to Reduce Errors in Program Development," *IBM Systems Journal* 15, no. 3 (1976) — the origin of formal software inspection.
[^bacchelli]: Alberto Bacchelli and Christian Bird, "Expectations, Outcomes, and Challenges of Modern Code Review," *Proceedings of ICSE 2013* (Microsoft Research). [Publication page](https://www.microsoft.com/en-us/research/publication/expectations-outcomes-and-challenges-of-modern-code-review/) · [PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ICSE202013-codereview.pdf)
[^dora]: **DORA** (DevOps Research and Assessment) is a multi-year research program into software-delivery performance; its findings are synthesized in *Accelerate* (Nicole Forsgren, Jez Humble, Gene Kim, 2018) and the annual *State of DevOps* reports. [dora.dev](https://dora.dev/)
