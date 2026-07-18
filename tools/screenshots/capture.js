// Minimal headless-Chromium screenshot capture tool.
//
// Usage:
//   node capture.js <url> <output-file.png> [--width=1280] [--height=800] [--full-page]
//
// Runs in its own isolated browser profile -- never touches the operator's
// real desktop/browser windows. See tools/screenshots/README.md.

const { chromium } = require('playwright');
const path = require('path');

async function main() {
  const [, , url, outputFile, ...flags] = process.argv;
  if (!url || !outputFile) {
    console.error('Usage: node capture.js <url> <output-file.png> [--width=1280] [--height=800] [--full-page]');
    process.exit(1);
  }

  const getFlag = (name, fallback) => {
    const match = flags.find(f => f.startsWith(`--${name}=`));
    return match ? Number(match.split('=')[1]) : fallback;
  };
  const fullPage = flags.includes('--full-page');
  const width = getFlag('width', 1280);
  const height = getFlag('height', 800);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      ignoreHTTPSErrors: true, // local.prosaurus.com uses a self-signed cert
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    const outPath = path.resolve(outputFile);
    await page.screenshot({ path: outPath, fullPage });
    console.log(`Saved screenshot to ${outPath}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
