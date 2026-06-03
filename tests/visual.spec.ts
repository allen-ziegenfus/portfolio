import { test, expect } from '@playwright/test';

// Key pages of the site. Each is captured full-page at every breakpoint project.
// Add a page here when a new template/layout appears; content-only changes don't
// need new entries (they just update the existing baseline).
const pages = [
  { name: 'home',             path: '/' },
  { name: 'about',            path: '/about/' },
  { name: 'post-code-review', path: '/writing/what-code-review-is-actually-for/' },
  { name: 'tag-sdlc',         path: '/tags/sdlc/' },
  { name: 'search',           path: '/search/' },
];

for (const p of pages) {
  test(p.name, async ({ page }) => {
    await page.goto(p.path, { waitUntil: 'networkidle' });
    await expect(page).toHaveScreenshot(`${p.name}.png`, { fullPage: true });
  });
}
