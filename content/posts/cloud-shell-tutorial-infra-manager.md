+++
title = "A clone-and-go installer: GCP Cloud Shell tutorials + Infrastructure Manager"
date = 2026-03-19
draft = false
summary = "Turning a many-step platform install — APIs, IAM, Terraform, state, secrets — into a browser-only, guided, clone-and-go onboarding with GCP Cloud Shell tutorials and Infrastructure Manager."
tags = ["Infrastructure as Code", "GCP"]
images = ["/og/cloud-shell-tutorial-infra-manager.png"]
reviewed = 2026-06-04
+++


Distributing a complex cloud platform install — dozens of enabled APIs, IAM bootstrapping, Terraform, secrets, a GitOps repo — is where good infrastructure goes to die in support tickets. "Which APIs do I enable?" "It says I don't have permission." "What version of Terraform?" "Where does the state live?" Each of those is a local-environment problem, and each one is avoidable. What if we could turn a multistep platform install into a **browser-only, guided, clone-and-go onboarding**? That is possible using two GCP features that perhaps are not used often enough together: **Cloud Shell tutorials** and **Infrastructure Manager**.

## The Problem with a README Runbook

One runbook shape is a `SETUP.md` with many numbered steps. But this can lead to many potential failures:

- Users skip the API-enablement step and hit a cryptic error twenty minutes later.
- Users run Terraform with their personal `owner` credentials. 
- Users keep state on their laptop which can leak sensitive information or be easily deleted. 
- Users are on the wrong tool version, leading to hard to debug errors. 
- Users paste the wrong project ID into step 14. 

The runbook is *documentation pretending to be a procedure* — nothing verifies that step N actually happened before step N+1 runs.

The fix is to make the runbook **executable and guided**, and to take Terraform off the user's machine entirely.

## Piece 1: Open in Cloud Shell

A single "Open in Cloud Shell" deep link (`cloudshell_open` with the repo URL) clones the installer repository into the user's Cloud Shell and drops them into it. Cloud Shell already has `gcloud`, an editor, and an authenticated identity — so there is **no local toolchain to install and nothing to authenticate**. The user goes from a link to a ready environment in one click. That single move eliminates the entire class of "works on my machine" issues, because everyone is now on the *same* machine: Google's.

## Piece 2: A Cloud Shell Tutorial (the Runbook as a Program)

Cloud Shell renders an interactive **walkthrough** from a Markdown file (`teachme tutorial.md`) — a side panel that guides the user step by step. It's just Markdown with `<walkthrough-*>` directives, versioned in the repo alongside the code. The high-value ones:

- **`<walkthrough-project-setup billing="true">`** — a project picker that confirms a billing-enabled project is selected before anything else runs. No more "I deployed into the wrong project."
- **`<walkthrough-enable-apis apis="...">`** — a one-click button that enables the exact list of required APIs. The list is declared in the tutorial, so the user enables exactly the right APIs in one click — no guessing, no missed API.
- **`<walkthrough-editor-open-file>`** — opens a specific file (e.g. the Terraform variables) in the Cloud Shell editor at the right moment, so the user edits the real file in place rather than being told to "go find and edit X."
- **Inline runnable commands** — fenced shell blocks the user runs with one click, with the selected project ID interpolated in (`<walkthrough-project-id/>`), so there's no copy-paste-the-wrong-value step.

A slice of the `tutorial.md` reads like this:

````markdown
## Select project
<walkthrough-project-setup billing="true" required="true"></walkthrough-project-setup>

```sh
gcloud config set project <walkthrough-project-id/>
```

## Enable APIs
<walkthrough-enable-apis apis="config.googleapis.com,cloudbuild.googleapis.com,compute.googleapis.com,container.googleapis.com,iam.googleapis.com"></walkthrough-enable-apis>

## Configure and apply
<walkthrough-editor-open-file filePath="./setup.sh">Open setup.sh</walkthrough-editor-open-file>

```sh
./setup.sh <walkthrough-project-id/>
```
````

The difference from a README is that the walkthrough is *stateful and active*, not just text. It knows which project is selected and injects that into every command, and the `project-setup` step won't continue until a billing-enabled project is chosen. The procedure can't drift from the documentation because the procedure *is* the documentation, executing.

What the built-in directives don't cover, the scripts those steps run can. `setup.sh` is an ordinary shell script, so it can prompt for input and run its own checks — and that's where real verification lives:

```sh
# the walkthrough sequences steps; a script is what actually verifies state
if [ "$(gcloud billing projects describe "$PROJECT" \
      --format='value(billingEnabled)')" != "True" ]; then
  echo "Enable billing on $PROJECT, then re-run." >&2
  exit 1
fi

read -rp "Region [us-central1]: " REGION
REGION="${REGION:-us-central1}"
```

So the walkthrough sequences the steps and hands off; any gate beyond project-and-billing selection is only as strong as the checks you write into the scripts.

## Piece 3: Infrastructure Manager Runs the Terraform, Not the User

This is the part that most changes the risk profile. Instead of the user running `terraform apply` locally — with their own broad credentials, their own state file, their own tool version — the install hands the Terraform to **Infrastructure Manager** (`config.googleapis.com`), GCP's managed Terraform service. Infrastructure Manager:

- runs the Terraform **server-side, as a dedicated runner service account** (least-privilege, not the user's `owner` credentials);
- **manages state for you** in a Google-owned bucket, so there's no "who has the state, and is it locked?" problem;
- pins the execution environment, so tool-version drift disappears;
- exposes deployments as first-class, observable GCP resources.

The user never installs Terraform, never holds state, and never applies infrastructure with their personal credentials. They trigger a build (here, via Cloud Build, which invokes Infrastructure Manager), and watch it in the console.

### The IAM Bootstrap That Makes It Work

Infrastructure Manager needs a small, specific permission setup, which a bootstrap script does once:

- Enable `config.googleapis.com` (and Cloud Build) and **create the Infrastructure Manager service identity** (`gcloud beta services identity create --service=config.googleapis.com`).
- Grant that service agent the **`config.agent`** role on the project and the ability to **act as the runner service account** (`iam.serviceAccountUser`), so it can execute the Terraform *as* the scoped runner.
- Grant the trigger (the Cloud Build service account) permission to **manage deployments** (`config.admin`) and to **impersonate the runner**.

This means that a managed service runs your Terraform as a service account that you scoped, triggered by a build, with state it owns. 

## Why This Is an Effective Pattern for Distributing Infrastructure

- **Zero local setup.** Browser only. No SDK, no Terraform, no auth dance. The support surface for "my environment" goes to zero.
- **No credentials on the laptop.** The user authenticates to Cloud Shell with their Google identity; the *apply* runs as a least-privilege runner SA inside GCP. No `owner` PAT, no exported service-account key.
- **Project and APIs are handled up front.** The `project-setup` step requires a billing-enabled project, and a one-click step enables the exact APIs the build needs — so the most common silent failures are headed off in-flow rather than assumed.
- **State and tool version are managed.** Infrastructure Manager owns both, so two different operators get identical, reproducible runs.
- **Reproducible, not click-ops.** The tutorial and the Terraform are versioned together; an install is a known revision of a repo, not a person's memory of a Slack thread.

## Portable Lessons

- **Meet users in the browser.** Cloud Shell (or any hosted shell) eliminates an entire category of onboarding failure by removing the local environment as a variable.
- **Encode the runbook as an executable tutorial, not a document.** A walkthrough that picks the project, enables the APIs, and injects the right values can't be skipped or fat-fingered the way a numbered list can.
- **Run Terraform as a managed service, not on the operator's machine.** Infrastructure Manager (or any server-side Terraform runner) removes credential sprawl, state-handling mistakes, and version drift in one move — the apply runs as a scoped identity you control, not as whoever happened to click the button.
