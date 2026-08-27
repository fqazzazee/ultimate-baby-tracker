#!/usr/bin/env node
/*
 * Renders docs/slide/index.html to docs/slide/slide.png - the image the README
 * shows. Run it after editing the slide:
 *
 *     node scripts/render-slide.mjs
 *     node scripts/render-slide.mjs --width 2560       # bigger render
 *     CHROME=/path/to/chrome node scripts/render-slide.mjs
 *
 * It drives a headless Chrome over the DevTools protocol, so the only thing it
 * needs is a Chrome, Chromium or Edge already on the machine - no npm install.
 * The app itself still has no dependencies; this is a tool for the repository,
 * not for running the tracker.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const PAGE = join(ROOT, 'docs/slide/index.html');
const OUT = join(ROOT, 'docs/slide/slide.png');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
// The slide is drawn on a 1600x900 stage; --width is the size of the PNG that
// comes out of it, and the stage is scaled to match.
const STAGE = { width: 1600, height: 900 };
const width = Number(flag('width', 1920));
const scale = width / STAGE.width;
const height = Math.round(STAGE.height * scale);
const port = Number(flag('port', 9422));

const CANDIDATES = [
  process.env.CHROME,
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

const chromePath = CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('No Chrome found. Install one, or point CHROME at it:');
  console.error('  CHROME=/path/to/chrome node scripts/render-slide.mjs');
  process.exit(1);
}
if (!existsSync(PAGE)) {
  console.error(`Missing ${PAGE}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'ubt-slide-'));

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  `--remote-debugging-port=${port}`,
  `--window-size=${STAGE.width},${STAGE.height}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const cleanup = () => {
  chrome.kill();
  // Chrome may still be flushing its profile as we go, so retry rather than
  // fail the render over a temporary directory.
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  } catch { /* it is in the OS temp directory; leaving it is harmless */ }
};
process.on('exit', cleanup);

async function debuggerUrl() {
  for (let i = 0; i < 75; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* chrome is still starting */ }
    await sleep(200);
  }
  throw new Error(`Chrome never opened a debugging port on ${port}`);
}

const ws = new WebSocket(await debuggerUrl());
await new Promise((ok, no) => {
  ws.addEventListener('open', ok, { once: true });
  ws.addEventListener('error', () => no(new Error('Could not talk to Chrome')), { once: true });
});

let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) => new Promise((ok, no) => {
  const n = ++id;
  pending.set(n, (m) => (m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: STAGE.width, height: STAGE.height, deviceScaleFactor: scale, mobile: false,
});
await send('Page.navigate', { url: pathToFileURL(PAGE).href });

// Web fonts arrive over the network and the entrance animation runs for about a
// second; wait for both, or the render catches fallback type mid-fade.
await sleep(1200);
try {
  await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true });
} catch { /* offline: the fallback stack is what gets rendered */ }
await sleep(1600);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
ws.close();

console.log(`${OUT}  ${width}x${height}`);
process.exit(0);
