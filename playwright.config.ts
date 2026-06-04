import { defineConfig, devices } from '@playwright/test';

const BASE = 'http://127.0.0.1:1314';
// `hugo` on PATH by default (CI / Docker); override locally with HUGO_BIN if needed.
const HUGO = process.env.HUGO_BIN || 'hugo';

// Visual-regression baselines for allenz.net.
//   npm run test:visual          -> compare current render against committed baselines
//   npm run test:visual:update   -> rewrite baselines (the PNG git diff IS the review)
//   npm run test:visual:report   -> open the HTML report (actual / expected / diff slider)
//
// Baselines live under tests/__screenshots__/<breakpoint>/ and are committed; they only
// change in git history when a real visual change is accepted via --update-snapshots.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // 'github' surfaces failures as inline annotations on the CI run/PR (no download);
  // 'html' is the full actual/expected/diff report, uploaded as a CI artifact.
  reporter: [['github'], ['html', { open: 'never' }]],
  // clean, platform-suffix-free names so the committed baselines are stable
  snapshotPathTemplate: 'tests/__screenshots__/{projectName}/{arg}{ext}',
  use: {
    baseURL: BASE,
  },
  expect: {
    toHaveScreenshot: {
      // freeze CSS animations/transitions (the monogram + icon hovers) and hide the caret
      animations: 'disabled',
      caret: 'hide',
      // small tolerance absorbs trivial anti-aliasing noise without hiding real changes
      maxDiffPixelRatio: 0.01,
    },
  },
  projects: [
    { name: 'mobile',  use: { ...devices['Desktop Chrome'], viewport: { width: 390,  height: 844 } } },
    { name: 'tablet',  use: { ...devices['Desktop Chrome'], viewport: { width: 768,  height: 1024 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    // build-quality render without live-reload's injected script / open socket
    command: `${HUGO} server --port 1314 --bind 127.0.0.1 --disableFastRender --disableLiveReload`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
