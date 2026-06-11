+++
title = "Hosting a static site on GCP without over-building it"
date = 2026-06-04
draft = true
summary = "The GCP-native way to serve a static site forces a global load balancer you don't need. Here's the right-sized version — a bucket plus an edge — and where the load balancer actually earns its place."
tags = ["GCP", "Infrastructure as Code"]
+++

<!-- DRAFT: architecture is decided, exact config gets filled in as it's built. -->

There's a tension in hosting your own portfolio on GCP to *demonstrate* GCP: the temptation is to use as much of the platform as possible, and the platform is happy to let you. For a few megabytes of static HTML, that's the wrong instinct — and a reviewer who knows the platform will read it as reaching for heavy primitives, not as expertise. The interesting problem is right-sizing.

## The GCP-native path forces a load balancer

If you want GCS-backed static hosting with HTTPS and a CDN *natively* on GCP, the wiring isn't optional:

- **Cloud CDN attaches only to a load balancer** — there's no "CDN on a bucket" switch.
- A GCS bucket's website endpoint is **HTTP-only**; the HTTPS + Google-managed certificate also come *through* the load balancer.

So "native" means a **global external HTTPS load balancer → backend bucket → Cloud CDN → managed cert**, plus Cloud DNS. That's a real, idiomatic GCP pattern — and it carries a baseline cost of roughly **$18/month just for the load balancer's forwarding rule**, before a byte is served. For a production workload that's nothing. For a static blog it's complexity and spend with no matching benefit — and it contradicts the whole "match the mechanism to the purpose" idea.

## Right-sized: a bucket and an edge

The proportionate design is two parts:

- **GCS bucket** holds the built site (`public/`), public-read.
- **Cloudflare** sits in front as the edge — CDN caching, TLS termination, real 301 redirects, and free privacy-friendly analytics.

Cloudflare does the work the load balancer + Cloud CDN + managed cert would have done, for free, and the GCP footprint shrinks to *a bucket and the IAM to deploy into it*. That smaller footprint isn't a weakness to apologize for; it's the correct size.

### How the request flows

A visitor hits `allenz.net` → Cloudflare (edge cache) → on a miss, Cloudflare fetches from the GCS origin → caches and serves. Two ways to reach the origin:

- **Website endpoint** (`c.storage.googleapis.com`): gives index-document and 404 behavior, routes by Host header (so the bucket is named `allenz.net`), but is HTTP-only — pairs with Cloudflare SSL set to *Flexible* (visitor↔Cloudflare encrypted; the origin hop is not — acceptable for fully public content, but not ideal).
- **Object endpoint over HTTPS**, fronted by a small **Cloudflare Worker** that maps `/` → `/index.html` and handles 404s: encrypted end to end (*Full* SSL) at the cost of a few lines of Worker code.

Either way, `Cache-Control` is set on the objects, and the deploy ends by **purging Cloudflare's cache** so a new build goes live immediately.

## The Terraform

```text
infra/
  providers.tf     # google + cloudflare providers
  bucket.tf        # google_storage_bucket (website config) + public-read IAM
  wif.tf           # workload identity pool/provider + deployer SA + bindings
  cloudflare.tf    # DNS record, zone settings, redirect rules, web analytics
  variables.tf
  outputs.tf
```

The bucket and its IAM are a dozen lines. The part worth showing is the **keyless deploy**.

## Keyless deploys with Workload Identity Federation

The default way to let CI push to GCS is a service-account JSON key in a secret. Don't. **Workload Identity Federation** lets GitHub Actions exchange its OIDC token for short-lived GCP credentials — no long-lived key to leak or rotate:

```yaml
# .github/workflows/deploy.yml (sketch)
permissions:
  contents: read
  id-token: write          # required for the OIDC token
steps:
  - uses: actions/checkout@v6
    with: { submodules: recursive }
  - uses: google-github-actions/auth@v2
    with:
      workload_identity_provider: projects/NNN/locations/global/workloadIdentityPools/github/providers/repo
      service_account: site-deployer@PROJECT.iam.gserviceaccount.com
  - run: hugo --gc --minify
  - run: gcloud storage rsync ./public gs://allenz-net-site --recursive --delete-unmatched-destination-objects
  - run: # purge Cloudflare cache via API
```

The federation is scoped to *this repo* (and ideally the default branch), so only this repository's Actions can assume the deployer identity. That scoping — and the absence of a key — is the actual signal of competence, not the number of GCP services in the diagram.

## When the load balancer *is* the right call

None of this means the global LB pattern is bad — it's the right tool for a real workload: a Cloud Run or GKE service that needs path-based routing, backend health checks, Cloud Armor, or a single anycast IP across regions. That's where Cloud CDN + the managed cert + the LB earn their cost. A static site isn't that workload, and pretending it is would be the same mistake as running every change through a heavyweight review gate: ceremony where a lighter mechanism does the job better.
