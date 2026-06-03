+++
title = "A clone-and-go installer: GCP Cloud Shell tutorials + Infrastructure Manager"
date = 2026-06-02
draft = false
tags = ["Infrastructure as Code", "GCP"]
+++


Distributing a complex cloud platform install — dozens of enabled APIs, IAM bootstrapping, Terraform, secrets, a GitOps repo — is where good infrastructure goes to die in support tickets. "Which APIs do I enable?" "It says I don't have permission." "What version of Terraform?" "Where does the state live?" Every one of those is a local-environment problem, and every one is avoidable. This is how I turned a many-step platform install into a **browser-only, guided, clone-and-go onboarding** using two GCP features that are underused together: **Cloud Shell tutorials** and **Infrastructure Manager**.

## The problem with a README runbook

The traditional shape is a `SETUP.md` with thirty numbered steps. It fails in predictable ways: users skip the API-enablement step and hit a cryptic error twenty minutes later; they run Terraform with their personal `owner` credentials; they keep state on their laptop; they're on the wrong tool version; they paste the wrong project ID into step 14. The runbook is *documentation pretending to be a procedure* — nothing verifies that step N actually happened before step N+1 runs.

The fix is to make the runbook **executable and guided**, and to take Terraform off the user's machine entirely.

## Piece 1: Open in Cloud Shell

A single "Open in Cloud Shell" deep link (`cloudshell_open` with the repo URL) clones the installer repository into the user's Cloud Shell and drops them into it. Cloud Shell already has `gcloud`, an editor, and an authenticated identity — so there is **no local toolchain to install and nothing to authenticate**. The user goes from a link to a ready environment in one click. That single move eliminates the entire class of "works on my machine" issues, because everyone is now on the *same* machine: Google's.

## Piece 2: A Cloud Shell tutorial (the runbook as a program)

Cloud Shell renders an interactive **walkthrough** from a markdown file (`teachme tutorial.md`) — a side panel that drives the user step by step and *verifies state as it goes*. It's just markdown with `<walkthrough-*>` directives, versioned in the repo alongside the code. The high-value ones:

- **`<walkthrough-project-setup billing="true">`** — a project picker that confirms a billing-enabled project is selected before anything else runs. No more "I deployed into the wrong project."
- **`<walkthrough-enable-apis apis="...">`** — a one-click button that enables the exact list of required APIs. The user *cannot* skip it or get the list wrong; it's declared in the tutorial.
- **`<walkthrough-editor-open-file>`** — opens a specific file (e.g. the Terraform variables) in the Cloud Shell editor at the right moment.
- **Inline runnable commands** — fenced shell blocks the user runs with one click, with the selected project ID interpolated in (`<walkthrough-project-id/>`), so there's no copy-paste-the-wrong-value step.

The difference from a README is that the walkthrough is *stateful and verifying*. It knows which project is selected, it injects that into every command, it gates progress on prerequisites. The procedure can't drift from the documentation because the procedure *is* the documentation, executing.

## Piece 3: Infrastructure Manager runs the Terraform, not the user

This is the part that most changes the risk profile. Instead of the user running `terraform apply` locally — with their own broad credentials, their own state file, their own tool version — the install hands the Terraform to **Infrastructure Manager** (`config.googleapis.com`), GCP's managed Terraform service. Infrastructure Manager:

- runs the Terraform **server-side, as a dedicated runner service account** (least-privilege, not the user's `owner` credentials);
- **manages state for you** in a Google-owned bucket, so there's no "who has the state, and is it locked?" problem;
- pins the execution environment, so tool-version drift disappears;
- exposes deployments as first-class, inspectable GCP resources.

The user never installs Terraform, never holds state, and never applies infrastructure with their personal credentials. They trigger a build (here, via Cloud Build, which invokes Infrastructure Manager), and watch it in the console.

### The IAM bootstrap that makes it work

Infrastructure Manager needs a small, specific permission setup, which a bootstrap script does once:

- Enable `config.googleapis.com` (and Cloud Build) and **create the Infrastructure Manager service identity** (`gcloud beta services identity create --service=config.googleapis.com`).
- Grant that service agent the **`config.agent`** role on the project and the ability to **act as the runner service account** (`iam.serviceAccountUser`), so it can execute the Terraform *as* the scoped runner.
- Grant the trigger (the Cloud Build service account) permission to **manage deployments** (`config.admin`) and to **impersonate the runner**.

The shape is "a managed service runs your Terraform as a service account you scoped, triggered by a build, with state it owns" — which is exactly what you want when handing an install to someone who shouldn't (and shouldn't have to) hold production credentials.

## Why this is the right pattern for distributing infrastructure

- **Zero local setup.** Browser only. No SDK, no Terraform, no auth dance. The support surface for "my environment" goes to zero.
- **No credentials on the laptop.** The user authenticates to Cloud Shell with their Google identity; the *apply* runs as a least-privilege runner SA inside GCP. No `owner` PAT, no exported service-account key.
- **APIs and project are guaranteed correct.** The walkthrough verifies billing, project, and API enablement before the build — the most common silent failures, prevented structurally.
- **State and tool version are managed.** Infrastructure Manager owns both, so two different operators get identical, reproducible runs.
- **Reproducible, not click-ops.** The tutorial and the Terraform are versioned together; an install is a known revision of a repo, not a person's memory of a Slack thread.

## Portable lessons

- **Meet users in the browser.** Cloud Shell (or any hosted shell) eliminates an entire category of onboarding failure by removing the local environment as a variable.
- **Encode the runbook as an executable tutorial, not a document.** A walkthrough that picks the project, enables the APIs, and injects the right values can't be skipped or fat-fingered the way a numbered list can.
- **Run Terraform as a managed service, not on the operator's machine.** Infrastructure Manager (or any server-side Terraform runner) removes credential sprawl, state-handling mistakes, and version drift in one move — the apply runs as a scoped identity you control, not as whoever happened to click the button.
