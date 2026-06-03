+++
title = "One GitHub App, two auth models: repo credentials, webhooks, and SSO for Argo CD"
date = 2026-06-02
draft = false
tags = ["GitOps", "Security"]
+++


Argo CD needs three things from GitHub, and they're easy to conflate: it has to **read your Git repositories** (a machine reading code), **know when you push** (event delivery), and **let humans log in** (interactive identity). The default instinct is a personal access token for the first, polling for the second, and local accounts for the third. A single **GitHub App** does all three — better — but only if you keep straight that it's serving *two fundamentally different kinds of token*.

## The three needs

1. **Repository access** — Argo CD clones and polls your GitOps repos to render manifests.
2. **Webhooks** — without them, Argo CD polls on a timer (every ~3 minutes by default); with them, a push triggers a near-instant sync.
3. **SSO** — operators log into the Argo CD UI/CLI, and their access should be governed by something you already manage (your GitHub org), not a pile of local accounts.

## Machine identity: repo access via a GitHub App installation

Create a GitHub App, install it on your org (scoped to the repos Argo CD should see), and give Argo CD three values as a `githubApp` repository credential: the **App ID**, the **Installation ID**, and the App's **private key**. Argo CD uses these to mint **short-lived installation access tokens** on demand.

Why this beats a PAT or a deploy key:

- **Short-lived, not long-lived.** Installation tokens expire in an hour and are minted as needed. There's no durable secret sitting in a cluster waiting to leak. The only stored material is the App private key, which never travels over the wire to GitHub as a credential — it signs a JWT locally to request the token.
- **Org-owned, not person-owned.** A PAT is tied to a human; when they leave, it dies and your sync breaks. A GitHub App is owned by the org and survives staff churn.
- **Fine-grained.** The App grants exactly the repo permissions it needs (contents: read, and webhook admin if you want it to manage hooks), nothing more.
- **Higher rate limits.** Installation tokens get per-installation rate limits, well above a single user's PAT ceiling — which matters once Argo CD is polling many repos.

## Event delivery: webhooks the App can manage

Polling is a fine default and a bad steady state — three minutes of "is it merged yet?" on every change. The same GitHub App can hold **webhook** permissions, so pushes are delivered to Argo CD's `/api/webhook` endpoint and trigger an immediate refresh of the affected applications. You secure the delivery with a **shared webhook secret** (stored in your secret manager, referenced by Argo CD), so the server can verify the payload's HMAC signature and reject forgeries. The result is event-driven GitOps: merge, and the cluster starts reconciling in seconds, not minutes.

## Human identity: SSO via the App's OAuth client, through Dex

Here's the part that surprises people: the *same* GitHub App also carries an **OAuth client** (a client ID and client secret). That client drives the **browser login flow**, which is a completely different mechanism from the installation token above. Wire the client into Argo CD's bundled Dex with the `github` connector, and:

- Operators click "Log in via GitHub," do the standard OAuth consent, and land in the Argo CD UI.
- Dex reads their **org and team membership** and surfaces it as groups.
- Argo CD's RBAC maps those groups to roles — e.g. members of the `platform-admins` team get `role:admin`, everyone else gets read-only.

Access is now governed entirely by your GitHub org. Add someone to a team, they can log in; remove them, they can't. No local Argo CD accounts to provision or deprovision.

## The conceptual point: two token types, one App

The thing to hold onto is that one GitHub App is serving **two different grant types for two different audiences**:

| | Repo access + webhooks | SSO |
|---|---|---|
| **Token type** | Installation access token | User OAuth token |
| **Audience** | A machine (Argo CD's repo server) | A human (browser) |
| **Identity proven** | "this app, installed here" | "this person, in this org" |
| **Credential used** | App ID + Installation ID + private key | OAuth client ID + secret |
| **Flow** | JWT → installation token (server-to-server) | Browser redirect → OAuth consent |

Almost every "I set up the GitHub App, why doesn't *X* work" problem traces to mixing these up: feeding the OAuth client ID where the App ID belongs, or expecting the installation to grant UI login, or expecting the OAuth client to clone a repo. They're orthogonal. The App is a container for both; the two halves are configured independently and fail independently.

## Practical shape

Everything sensitive lives in a secret manager, not in Git or a values file:

- App **private key** → referenced by the repo-credential config.
- **Webhook secret** → referenced by the webhook receiver.
- OAuth **client ID / client secret** → referenced by the Dex connector.

The Argo CD config then references those secrets by name. In a Terraform/GitOps setup, the App registration can even be automated with a GitHub App **manifest flow** (you POST a manifest describing the permissions and events, GitHub walks the user through creation and hands back the credentials), so the whole thing is reproducible rather than a click-ops checklist.

## Portable lessons

- **Prefer GitHub App installation tokens over PATs for machine access.** Short-lived, fine-grained, org-owned, churn-proof, higher limits. There is almost no case where a long-lived PAT in a cluster is the right answer.
- **Separate machine identity from human identity in your head**, even when one App hosts both. Installation tokens are for servers; OAuth tokens are for people. Most integration bugs are a category error between the two.
- **Turn polling into events.** Webhooks are a small amount of config that converts GitOps from "eventually" to "immediately," and the App you already created for repo access can carry them.
- **Govern human access through an identity you already manage.** Org/team → RBAC means access control is a side effect of org membership, not a second system to keep in sync.
