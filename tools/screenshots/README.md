# Screenshot capture (Playwright)

A small, isolated headless-Chromium tool for capturing real screenshots of the
app — e.g. to replace the emoji icons on the public `/explore` marketing pages
with actual feature screenshots once there's a real-looking account to
screenshot from.

**Isolated by design**: this launches its own headless Chromium process with
its own blank browser profile. It never touches the operator's real desktop,
open windows, or browser tabs — unlike OS-level mouse/coordinate automation
(which is deliberately not used in this repo after a prior incident; see the
project's `feedback_no_blind_screen_automation` memory).

## Setup (already done once, kept here for reference)

```bash
cd tools/screenshots
npm install
npx playwright install chromium
```

## Usage

```bash
node capture.js <url> <output-file.png> [--width=1280] [--height=800] [--full-page]
```

Examples:
```bash
# Public page, no login needed
node capture.js https://www.prosaurus.com/explore explore-hub.png --full-page

# Local dev, self-signed cert is ignored automatically
node capture.js https://local.prosaurus.com/explore/sessions sessions.png --full-page
```

## Capturing authenticated pages (Sessions, Artist Showcase, Kanban, etc.)

`capture.js` as written only handles public pages. To screenshot anything
behind login, `page.goto` needs to happen inside an authenticated
`browserContext` first (fill the login form, or inject the `jwtToken` cookie
directly). That login step isn't built yet — it needs a real account with
real-looking content in it first (avoid screenshotting an empty new-signup
state). Once that account exists, extend `capture.js` with a `--login`
flow rather than hand-rolling a one-off script per page.
