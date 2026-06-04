# Allen Ziegenfus — Engineering Portfolio

Cloud-native / Kubernetes / platform-engineering notes and essays.

**→ [allenz.net](https://allenz.net)**

This repository holds the source for the site (Hugo + the PaperMod theme). The
published site is the canonical place to read the notes and essays.

## Develop

```bash
hugo server        # http://localhost:1313 (rewrites URLs to localhost)
```

Content lives in `content/`; design overrides in `assets/css/extended/custom.css`
and `layouts/`. See `CLAUDE.md` for the conventions (content rules, design
system, OG-card generation, accessibility).

## Deploy

Push to `main` → GitHub Actions builds and publishes to GitHub Pages
(`.github/workflows/hugo.yml`). `static/CNAME` pins the custom domain; HTTPS is
enforced.

## Visual regression

Playwright captures the key pages at mobile / tablet / desktop and diffs them
against committed baselines in `tests/__screenshots__/`.

```bash
npm ci
npm run test:visual              # compare against the committed baselines
npm run test:visual:update       # accept intentional changes (review the PNG diff)
npm run test:visual:docker       # run in the CI image — matches CI rendering exactly
npm run test:visual:docker:update
```

Every pull request runs the suite in CI (`.github/workflows/ci.yml`) inside the
same Playwright container the baselines are generated in, so renders match and
diffs reflect real visual changes rather than cross-OS font noise. The HTML
report (actual / expected / diff images) is uploaded as a build artifact.

## Prose linting

[Vale](https://vale.sh) (style) and [Harper](https://writewithharper.com)
(grammar) lint the writing. Vale's style packages are vendored under `styles/`
(so no `vale sync` is needed); config is `.vale.ini`:

```bash
vale content/posts/
```

In VS Code, install the recommended extensions (`.vscode/extensions.json`) for
live squiggles — Vale on save, Harper as you type. Harper uses the project
dictionary `.harper-dictionary.txt` so technical terms aren't flagged. On
**content** PRs, CI leaves Vale suggestions as inline review comments
(advisory, non-blocking — never gates a merge).

## Dead links

A weekly scheduled workflow (`.github/workflows/links.yml`) builds the site and
runs [lychee](https://lychee.cli.rs) over every page; if it finds a broken link
it opens (or updates) a `dead-links` GitHub issue. Run it on demand from the
Actions tab ("Dead links" → *Run workflow*). `.lycheeignore` skips known
bot-hostile hosts (LinkedIn 999s non-browsers).
