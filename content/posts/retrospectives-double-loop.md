+++
title = "Retrospectives are double-loop learning"
date = 2026-06-03
draft = false
summary = "Most of a team's week is single-loop — execute the process, close the ticket. The retrospective is the one ritual that questions the process itself, and what quietly breaks when a team skips it."
tags = ["SDLC"]
images = ["/og/retrospectives-double-loop.png"]
+++

There are two kinds of learning a team can do. The first fixes the error: the build broke, so you fix the build. The second fixes the thing that *produced* the error: the build broke because of how we work, so we change how we work. Chris Argyris named these **single-loop** and **double-loop** learning[^argyris] — adjusting your actions within the existing rules, versus questioning the rules themselves.

Most of a team's week is single-loop by design. Tickets, PRs, deploys — execute the process, close the loop, repeat. That's correct; you can't double-loop everything or you'd never ship. But a team that *only* single-loops has no mechanism to improve the system it runs on. It gets very good at moving tickets through a pipeline it never steps back to question.

The retrospective is that mechanism. It's the one ritual whose entire job is double-loop: not "did we finish the work" but "is the way we work the way we should work?" Strip away the cadence and the sticky notes and that's what a retro *is* — a team's standing forum for examining its own rules.

## What happens when there isn't one

Skip it, and three things happen.

First, the team can only single-loop. Problems with the *process* — the painful release, the meeting that's secretly status, the handoff that keeps dropping things — have nowhere to go. They get rediscovered, individually, over and over, and might never be properly addressed — because doing so requires a forum that questions the frame, and there isn't one.

Second — and teams underrate this — **the double-loop observations don't disappear.** Engineers vary a lot in how much they naturally run this kind of analysis; some are constantly noticing "the system that produced this is off." For those people, a team with no forum to surface and *act on* process concerns is quietly corrosive. The observations accumulate with nowhere to put them. That unsettled feeling isn't a personality quirk to be managed — it's information the team is failing to capture. And often the people most attuned to process problems are the ones who disengage or leave first, which means the org loses exactly the signal it most needed.

Third, the negativity has to land *somewhere*. Acknowledging that a process is broken is unpleasant work, and with no designated forum to do it in, the observations leak out — blurted at standup, dropped into a PR thread, raised in the wrong meeting at the wrong moment. Everyone in the room may privately agree, but the timing and framing land badly, and there's no shared container to process the discomfort together. So the cost falls on the messenger: **the people most sensitive to the problems become *associated* with the problems.** A team without a retro doesn't just fail to fix its process — it quietly converts its most perceptive members into "the negative ones," and learns to discount exactly the signal it should be amplifying.

## It's not only about fixing things

Frame a retro purely as problem-intake and you miss half its value. A good retrospective is also where a team builds **energy and cohesion** — and those aren't soft extras, they're what makes the work sustainable.

A team that only moves tickets experiences work as an endless, undifferentiated churn: finish one, the next appears, forever. Nothing is ever *marked*. A retro punctuates that churn. We name the problems **and commit to solutions** — so friction feels like something the team acts on, not weather it endures. We name the wins **and actually celebrate them** — so progress is visible and shared, not silently absorbed into the backlog. That rhythm of *see clearly, decide together, mark the moment* is most of what turns a group of people executing tickets into a team.

## Why most retros fail anyway

The failure mode isn't *not having* retros — it's having ones that produce nothing. A retrospective that surfaces concerns and then changes nothing can be worse than none: it actively *trains* the team that naming problems is pointless, which is how you get the silent, going-through-the-motions version. What separates the real thing from the theater:

- **Actioned outcomes.** The output is a small number of concrete changes with owners — not a list of grievances that evaporate by Monday.
- **Psychological safety.** People only surface real problems where it's safe to. Blame kills the signal.
- **Celebrate, don't just fix.** The wins half is load-bearing. Skip it and the ritual becomes a complaint session no one wants to attend.
- **Cadence and follow-through.** Regular, and visibly connected to actual change — or it decays into ceremony.

A retrospective is, in the end, a feedback loop pointed at the process itself — the meta-loop above all the others. A team that ships constantly but never retrospects is optimizing hard inside a frame it has decided never to examine. Sometimes the most valuable thing a team can do is stop moving tickets long enough to ask whether the tickets are the right shape.

[^argyris]: Chris Argyris originated the distinction between single- and double-loop learning. See "Teaching Smart People How to Learn," *Harvard Business Review* (1991), and Argyris & Schön, *Organizational Learning* (1978).
