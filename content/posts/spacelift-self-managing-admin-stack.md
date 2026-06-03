+++
title = "The admin stack that manages itself: bootstrapping a self-hosted IaC control plane"
date = 2026-06-02
draft = false
tags = ["Infrastructure as Code"]
+++


If you manage your infrastructure as code, you eventually face a recursive question: **what manages the thing that manages your infrastructure?** When the IaC orchestrator (Spacelift, in this case) is itself configured through Terraform — stacks, contexts, policies, integrations all declared as resources — the cleanest answer is an *admin stack*: a stack that provisions every other stack, including itself. It's elegant, and it has two irreducible bootstrap problems that no amount of declarative code can paper over. This is how that pattern actually goes.

## The shape

One repo declares the whole organization via the Spacelift Terraform provider. A root module composes child modules (`./aws`, `./gcp`, `./plugins`, …), and a single resource declares the stack that runs the repo:

```hcl
resource "spacelift_stack" "admin" {
  name                    = "platform-automation-spacelift"
  repository              = "spacelift"
  branch                  = "master"
  project_root            = "."
  space_id                = var.cloudnative_space_id   # the "root" space
  terraform_workflow_tool = "OPEN_TOFU"
}

# The admin stack gates the delivery pipeline:
resource "spacelift_stack_dependency" "admin_to_gcp_gke" {
  depends_on_stack_id = spacelift_stack.admin.id
  stack_id            = module.gcp.gke_stack_id
}
```

After this exists, the admin stack is self-hosting: edit a policy or add a stack, open a PR, and the admin stack plans and applies the change to the org — including changes to *itself*. That's the goal. Getting there is where it's interesting.

## Bootstrap problem 1: the stack can't create itself

The first `apply` cannot run *in* the admin stack, because the admin stack doesn't exist yet. Something has to create it from outside. So the bootstrap is a **local apply, then a state handoff**:

1. Authenticate locally (`spacectl profile login`, bridged to Terraform via `SPACELIFT_API_TOKEN`).
2. `tofu apply` **from your laptop** — this creates the admin stack and all child stacks/contexts/policies, recording everything in a *local* `terraform.tfstate`.
3. Now the admin stack exists in Spacelift, but *its* managed state is empty — the real state is on your laptop. Hand it off: lock the stack, **import the local `tfstate`** through the UI, unlock, and trigger a fresh run.
4. That run must plan **`0 to add, 0 to change, 0 to destroy`**. That clean plan is the proof the handoff worked — the self-managed state now matches reality, and the stack has taken over from your laptop.

One related trap: **do not add a `backend "..."` block to the repo.** Spacelift injects state configuration into every run; a static backend block fights that injection. The state lives where the platform puts it, and the bootstrap import is how you seed it.

## Bootstrap problem 2: you can't grant yourself permissions you don't have

The admin stack manages resources across multiple spaces, so it needs an org-wide admin role. But it **cannot grant itself that role** — to create a role binding that powerful, you'd already need to be that powerful. This is a genuine chicken-and-egg, not a tooling gap, and the only correct answer is a **manual seed in the UI**:

- Confirm the admin stack lives in the `root` space (Spacelift only allows a stack a role scoped to a space it sits in or above).
- Manually bind the **Space admin** role on `root` to the admin stack as principal. A single binding on `root` cascades to child spaces.

If the provider later grows a `role_attachment` resource, you add it to the code as a **record of state already set by hand** — never as the source of truth, because the source of truth had to exist before the code could run.

## The general principle

Every self-managing or self-hosting system has an **irreducible manual seed**, and it's always in the same two places: the **trust/permission root** and the **initial state**. A system cannot authorize itself (that's circular), and it cannot create the state that records its own existence before it exists. No quantity of "everything as code" removes this; it only relocates it.

So the mature move isn't to pretend the bootstrap is fully declarative — it's to **make the seed explicit, documented, and tiny**: one local apply, one state import, one manual role binding, each written down with the exact UI steps and the "you'll know it worked when the plan is 0/0/0" checkpoint. After that single human-in-the-loop moment, the system is genuinely self-managing. The art is shrinking the manual seed to the smallest thing that *logically cannot* be automated — and being honest that it exists, rather than discovering it the hard way during a disaster-recovery rebuild.
