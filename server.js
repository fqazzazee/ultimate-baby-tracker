#!/usr/bin/env node
/**
 * Ultimate Baby Tracker - zero-dependency HTTP server.
 *
 *   node server.js                 # http://localhost:8477
 *   BT_PORT=3000 node server.js
 *   BT_DATA_DIR=/srv/baby node server.js
 *
 * Binds 0.0.0.0 by default so phones on the same Wi-Fi can reach it.
 * There is no authentication by design - run it on a trusted network.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './lib/store.js';
import { computeAlarmInstances, instanceKey } from './lib/alarms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

/** Identity shown in the header and on the About card, straight from package.json. */
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const APP = {
  name: pkg.displayName || pkg.name,
  version: pkg.version,
  author: pkg.author,
  license: pkg.license,
  repository: (pkg.repository?.url || '').replace(/^git\+/, '').replace(/\.git$/, ''),
  homepage: pkg.homepage,
};
const PORT = Number(process.env.BT_PORT || 8477);
const HOST = process.env.BT_HOST || '0.0.0.0';
const MAX_BODY = 1_000_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/* ---------------------------------------------------------------- utilities */

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function sendJSON(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/* --------------------------------------------------------- server-sent events */

const sseClients = new Set();

function broadcast(rev) {
  const frame = `event: change\ndata: ${JSON.stringify({ rev })}\n\n`;
  for (const res of sseClients) {
    try { res.write(frame); } catch { sseClients.delete(res); }
  }
}
store.bus.on('change', broadcast);

function handleStream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(`retry: 3000\nevent: change\ndata: ${JSON.stringify({ rev: store.getRevision() })}\n\n`);
  sseClients.add(res);
  const beat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* dropped below */ }
  }, 25_000);
  req.on('close', () => {
    clearInterval(beat);
    sseClients.delete(res);
  });
}

/* ---------------------------------------------------------------- state view */

function buildState(url) {
  const config = store.publicConfig();
  const babyId = url.searchParams.get('babyId') || 'all';
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return {
    rev: store.getRevision(),
    app: APP,
    serverTime: new Date().toISOString(),
    config,
    events: store.listEvents({ babyId, since, limit: 1000 }),
    timers: store.listTimers(),
    alarms: computeAlarmInstances(config),
    totalEvents: store.eventCount(),
  };
}

/* ----------------------------------------------------------------- CSV export */

function toCSV(rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}

function exportCSV(url) {
  const config = store.getConfig();
  const babyName = (id) => config.babies.find((b) => b.id === id)?.name || id || '';
  const userName = (id) => config.users.find((u) => u.id === id)?.name || id || '';
  const typeLabel = (id) => config.eventTypes.find((t) => t.id === id)?.label || id || '';
  const babyId = url.searchParams.get('babyId') || 'all';
  const events = store.listEvents({ babyId, limit: 0 }).reverse();
  const rows = [['when', 'baby', 'who', 'what', 'preset', 'amount_cc', 'duration_min', 'details', 'note']];
  for (const e of events) {
    const d = e.data || {};
    const details = Object.entries(d)
      .filter(([k]) => k !== 'amount' && k !== 'duration')
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    rows.push([e.at, babyName(e.babyId), userName(e.userId), typeLabel(e.typeId), e.presetId || '', d.amount ?? '', d.duration ?? '', details, e.note || '']);
  }
  return toCSV(rows);
}

/* ------------------------------------------------------------------- routing */

async function handleAPI(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const [, resource, id, action] = seg;
  const method = req.method;

  if (resource === 'stream' && method === 'GET') return handleStream(req, res);

  if (resource === 'state' && method === 'GET') return sendJSON(res, 200, buildState(url));

  if (resource === 'export.csv' && method === 'GET') {
    return send(res, 200, exportCSV(url), {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="baby-tracker-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
  }

  if (resource === 'config' && method === 'PUT') {
    const body = await readBody(req);
    if (!body || typeof body !== 'object') return sendJSON(res, 400, { error: 'config object required' });
    store.saveConfig(body);
    return sendJSON(res, 200, { ok: true, config: store.publicConfig(), rev: store.getRevision() });
  }

  if (resource === 'events') {
    if (method === 'GET') {
      return sendJSON(res, 200, {
        events: store.listEvents({
          babyId: url.searchParams.get('babyId') || 'all',
          typeId: url.searchParams.get('typeId') || undefined,
          since: url.searchParams.get('since') || undefined,
          limit: Number(url.searchParams.get('limit')) || 500,
        }),
      });
    }
    if (method === 'POST') {
      const body = await readBody(req);
      if (!body.typeId) return sendJSON(res, 400, { error: 'typeId is required' });
      if (!body.babyId) return sendJSON(res, 400, { error: 'babyId is required' });
      return sendJSON(res, 201, { event: store.addEvent(body), rev: store.getRevision() });
    }
    if (id && method === 'PATCH') {
      const body = await readBody(req);
      const updated = store.editEvent(id, body);
      return updated
        ? sendJSON(res, 200, { event: updated, rev: store.getRevision() })
        : sendJSON(res, 404, { error: 'no such event' });
    }
    if (id && method === 'DELETE') {
      return store.deleteEvent(id)
        ? sendJSON(res, 200, { ok: true, rev: store.getRevision() })
        : sendJSON(res, 404, { error: 'no such event' });
    }
  }

  if (resource === 'timers') {
    if (method === 'GET') return sendJSON(res, 200, { timers: store.listTimers() });
    if (method === 'POST' && !id) {
      const body = await readBody(req);
      if (!body.typeId || !body.babyId) return sendJSON(res, 400, { error: 'babyId and typeId are required' });
      return sendJSON(res, 201, { timer: store.startTimer(body), rev: store.getRevision() });
    }
    if (method === 'POST' && id && action === 'stop') {
      const body = await readBody(req);
      const event = store.stopTimer(id, body);
      return event
        ? sendJSON(res, 200, { event, rev: store.getRevision() })
        : sendJSON(res, 404, { error: 'no such timer' });
    }
    if (method === 'DELETE' && id) {
      return store.cancelTimer(id)
        ? sendJSON(res, 200, { ok: true, rev: store.getRevision() })
        : sendJSON(res, 404, { error: 'no such timer' });
    }
  }

  if (resource === 'users' && method === 'POST' && id) {
    const body = await readBody(req);
    const userId = decodeURIComponent(id);

    if (action === 'verify') {
      return sendJSON(res, 200, store.verifyPin(userId, body.pin));
    }

    if (action === 'pin') {
      // Changing or clearing an existing PIN requires the current one.
      if (store.hasPin(userId)) {
        const check = store.verifyPin(userId, body.currentPin);
        if (!check.ok) return sendJSON(res, 403, { error: 'Wrong current PIN', ...check });
      }
      const pin = body.pin === null || body.pin === '' ? null : String(body.pin);
      if (pin !== null && !/^\d{4}$/.test(pin)) {
        return sendJSON(res, 400, { error: 'PIN must be exactly 4 digits' });
      }
      if (!store.setPin(userId, pin)) return sendJSON(res, 404, { error: 'no such person' });
      return sendJSON(res, 200, { ok: true, hasPin: pin !== null, rev: store.getRevision() });
    }
  }

  if (resource === 'alarms') {
    if (method === 'GET') return sendJSON(res, 200, { alarms: computeAlarmInstances(store.getConfig()) });
    if (method === 'POST' && id) {
      const body = await readBody(req);
      const key = decodeURIComponent(id);
      if (action === 'snooze') {
        const mins = Math.max(1, Number(body.minutes) || 10);
        store.setAlarmState(key, { snoozedUntil: new Date(Date.now() + mins * 60_000).toISOString() });
        return sendJSON(res, 200, { ok: true, rev: store.getRevision() });
      }
      if (action === 'dismiss') {
        store.setAlarmState(key, {
          dismissedForDueAt: body.dueAt || null,
          snoozedUntil: null,
          lastCycleAt: new Date().toISOString(),
        });
        return sendJSON(res, 200, { ok: true, rev: store.getRevision() });
      }
      if (action === 'arm') {
        store.setAlarmState(key, {
          armedAt: new Date().toISOString(),
          snoozedUntil: null,
          dismissedForDueAt: null,
          lastCycleAt: new Date().toISOString(),
        });
        return sendJSON(res, 200, { ok: true, rev: store.getRevision() });
      }
    }
  }

  return sendJSON(res, 404, { error: `no route for ${method} ${url.pathname}` });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, rel);
  // Refuse anything that escapes public/.
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) {
      // Unknown paths fall back to the app shell (single-page navigation).
      if (path.extname(file)) return send(res, 404, 'Not found');
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, shell) =>
        e2 ? send(res, 404, 'Not found') : send(res, 200, shell, { 'content-type': MIME['.html'] }));
    }
    send(res, 200, data, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    handleAPI(req, res, url).catch((err) => {
      console.error('[api]', err);
      if (!res.headersSent) sendJSON(res, 400, { error: err.message || 'bad request' });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  serveStatic(req, res, url);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Pick another one:\n`);
    console.error(`      BT_PORT=8478 node server.js\n`);
    process.exit(1);
  }
  throw err;
});

store.init();
server.listen(PORT, HOST, () => {
  console.log(`\n  🍼 ${APP.name} v${APP.version}`);
  console.log(`     http://localhost:${PORT}   (data: ${store.dataDir()})\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n[server] shutting down');
    for (const res of sseClients) { try { res.end(); } catch { /* ignore */ } }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
