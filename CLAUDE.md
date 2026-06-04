# Portfolio site — working notes

Source for **allenz.net** — an engineering portfolio built with **Hugo + PaperMod**: technical notes and essays, plus an About/CV page.

## Build & deploy

- Hugo (extended). Preview locally with `hugo server` (rewrites URLs to `localhost`). Production build is `hugo` → `public/` (gitignored; CI builds it).
- **Deploy = push to `main`.** GitHub Actions (`.github/workflows/hugo.yml`) builds and publishes to GitHub Pages. `static/CNAME` pins the custom domain (`allenz.net`); HTTPS is enforced.
- Before pushing, sanity-check there's no employer-internal content outside `content/about.md` (see content rules).

## Content conventions

- Posts: `content/posts/*.md`, permalink `/writing/:slug/`.
- Front matter per post: `title`, `date`, `tags`, a hand-written `summary` (used for the card teaser **and** the meta/OG description — not an auto-truncated excerpt), and `images = ["/og/<basename>.png"]` for the social card.
- **Keep articles vendor-neutral.** Write about patterns and engineering, not a specific employer: no internal project/ticket IDs, no private-repo links, no named individuals, no confidential business specifics. `content/about.md` (the CV) is the one place employers are named.
- Calibrate claims: prefer "one effective pattern" / "a strong default" over "the right/only/best." Back non-obvious factual claims with footnotes (Goldmark `[^id]` syntax).
- A post's **first tag** selects its category icon. The topics bar (main tags) is in `layouts/_partials/header.html`.

## Writing voice

Match how Allen edits. (Drafts generated here tend to run wordy and abstract — bias the other way.)

- **Plainer is better.** Prefer the simplest accurate word; cut hedging tails and elaborate qualifiers. "so the failures are prevented" beats "so the most common silent failures are headed off in-flow rather than assumed."
- **Concrete over abstract.** Name the actual mechanism and show the real artifact (a `tutorial.md` snippet, a short script) rather than describing it in the abstract. Avoid vague figurative verbs like "hands off" — say what literally happens.
- **Every claim needs a referent.** Don't overstate what a tool does. If the walkthrough doesn't verify state, don't write "verifies" — attribute the behaviour to the thing that actually does it (the scripts), and bound the scope ("only as strong as the checks you write").
- **Active when it's tighter, passive when it's natural.** Don't chase passive-voice lint flags; passive is fine when the actor is obvious or unimportant. Flip to active only when it genuinely shortens or sharpens.
- **No filler intensifiers.** Avoid "simply / just / easily / obviously," and absolute "cannot / never / always" unless literally true.

## Design system

- Brand palette = CSS variables in `assets/css/extended/custom.css` (`--brand-sky/violet/indigo/fuchsia`), theme-aware (deeper tones in light mode, pastels in dark). The dark icon tile + light-mode text colors are vars too.
- Category icons: `assets/icons/<tag>.svg`, **inlined** (via `resources.Get ... .Content`) so they inherit the brand vars and can animate on hover with CSS. Each is a colorful line glyph; arrow-based icons (IaC, Databases, GitOps) carry a hover "action" animation.
- Cards are two-column: icon left, title/summary/meta stacked right (`layouts/list.html` + `.post-entry`/`.entry-body`).
- The **purple gradient is reserved for the name** (nav title), and animates left-to-right on hover. Content titles are plain.
- OG cards: 1200×630, dark gradient + title + category icon, regenerated with ImageMagick + `rsvg-convert` (strip the hover-only label `<text>` nodes; substitute the `var(--brand-*)` colors for concrete hex when rasterizing). Homepage card is `static/og/home.png`, wired via `content/_index.md`.
- Accessibility: skip-to-content link, `:focus-visible` ring, ARIA labels on social icons, decorative icons `aria-hidden`, and `prefers-reduced-motion` disables the looping animations.
