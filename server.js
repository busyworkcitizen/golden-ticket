import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env if present (built into Node 20.12+).
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') console.warn('[config] Could not read .env:', err.message);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const ODDS = Math.max(1, Number.parseInt(process.env.WIN_ODDS, 10) || 10_000); // 1 in ODDS
const COOLDOWN_MS = 10_000; // one roll every 10 seconds
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY ?? '1');

function parseTrustProxy(value) {
  if (value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value; // e.g. "loopback" or a subnet list
}

// ---------------------------------------------------------------------------
// Persistent state (total rolls + winners)
// ---------------------------------------------------------------------------
let state = { totalRolls: 0, winners: [] };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
} catch (err) {
  if (err.code !== 'ENOENT') console.warn('[data] Could not read data file, starting fresh:', err.message);
}

let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function saveSoon() {
  saveTimer ??= setTimeout(saveNow, 2_000);
}

// ---------------------------------------------------------------------------
// Cooldowns: one roll per 10s per browser AND per IP address
// ---------------------------------------------------------------------------
const lastRollAt = new Map();

function msUntilNextRoll(keys, now = Date.now()) {
  let wait = 0;
  for (const key of keys) {
    const t = lastRollAt.get(key);
    if (t !== undefined) wait = Math.max(wait, t + COOLDOWN_MS - now);
  }
  return wait;
}

const PLAYER_COOKIE = 'gt_pid';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function playerId(req, res) {
  const match = /(?:^|;\s*)gt_pid=([^;]+)/.exec(req.headers.cookie || '');
  if (match && UUID_RE.test(match[1])) return match[1];
  const id = crypto.randomUUID();
  res.cookie(PLAYER_COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 365 * 24 * 3600 * 1000 });
  return id;
}

const cooldownKeys = (req, res) => [`p:${playerId(req, res)}`, `ip:${req.ip}`];

// ---------------------------------------------------------------------------
// Owner login: lock an IP out for 15 minutes after 5 wrong passwords
// ---------------------------------------------------------------------------
const LOCKOUT_MS = 15 * 60_000;
const MAX_FAILS = 5;
const adminFails = new Map(); // ip -> { count, since }

function passwordMatches(given) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, t] of lastRollAt) if (t < now - COOLDOWN_MS) lastRollAt.delete(key);
  for (const [ip, f] of adminFails) if (f.since < now - LOCKOUT_MS) adminFails.delete(ip);
}, 60_000).unref();

// ---------------------------------------------------------------------------
// Ticket codes, e.g. GT-7KQ2-M9XA-P4TR (no look-alike characters)
// ---------------------------------------------------------------------------
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function ticketCode() {
  const groups = Array.from({ length: 3 }, () =>
    Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''),
  );
  return `GT-${groups.join('-')}`;
}

function cleanName(raw) {
  const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  return name || 'Anonymous';
}

function publicState() {
  return {
    odds: ODDS,
    cooldownMs: COOLDOWN_MS,
    totalRolls: state.totalRolls,
    winnerCount: state.winners.length,
    recentWinners: state.winners.slice(-5).reverse().map((w) => ({ name: w.name, at: w.at })),
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.set('trust proxy', TRUST_PROXY);
app.disable('x-powered-by');
app.use(express.json({ limit: '1kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/state', (req, res) => {
  const waitMs = msUntilNextRoll(cooldownKeys(req, res));
  res.json({ ...publicState(), waitMs: Math.max(0, waitMs) });
});

app.post('/api/roll', (req, res) => {
  const now = Date.now();
  const keys = cooldownKeys(req, res);
  const waitMs = msUntilNextRoll(keys, now);
  if (waitMs > 0) {
    res.set('Retry-After', String(Math.ceil(waitMs / 1000)));
    return res.status(429).json({ error: 'cooldown', waitMs });
  }
  for (const key of keys) lastRollAt.set(key, now);

  // The roll happens on the server, so the browser can't fake a win.
  const roll = crypto.randomInt(1, ODDS + 1); // 1..ODDS
  const win = roll === ODDS;
  state.totalRolls += 1;

  let ticket = null;
  if (win) {
    const winner = {
      code: ticketCode(),
      name: cleanName(req.body?.name),
      at: new Date(now).toISOString(),
      rollNumber: state.totalRolls,
      ip: req.ip,
    };
    state.winners.push(winner);
    saveNow();
    console.log(`[win] ${winner.name} won the golden ticket ${winner.code} on roll #${winner.rollNumber}`);
    ticket = { code: winner.code, name: winner.name, at: winner.at, rollNumber: winner.rollNumber };
  } else {
    saveSoon();
  }

  res.json({ ...publicState(), roll, win, ticket, waitMs: COOLDOWN_MS });
});

// Owner-only: every winner with their ticket code. Used by /owner.html.
app.post('/api/owner/winners', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'The owner page is off. Set ADMIN_PASSWORD on the server to turn it on.' });
  }
  const fails = adminFails.get(req.ip);
  if (fails && fails.count >= MAX_FAILS && Date.now() - fails.since < LOCKOUT_MS) {
    return res.status(429).json({ error: 'Too many wrong passwords. Try again in 15 minutes.' });
  }
  if (!passwordMatches(req.body?.password ?? '')) {
    const f = fails && Date.now() - fails.since < LOCKOUT_MS ? fails : { count: 0, since: Date.now() };
    f.count += 1;
    adminFails.set(req.ip, f);
    return res.status(401).json({ error: 'Wrong password.' });
  }
  adminFails.delete(req.ip);
  res.json({
    odds: ODDS,
    totalRolls: state.totalRolls,
    winners: state.winners.slice().reverse(),
  });
});

app.listen(PORT, () => {
  console.log(`Golden Ticket running at http://localhost:${PORT}`);
  console.log(`  Odds: 1 in ${ODDS.toLocaleString('en-US')} · one roll every ${COOLDOWN_MS / 1000}s`);
  if (ADMIN_PASSWORD) console.log(`  Owner page: http://localhost:${PORT}/owner.html`);
  else console.warn('  Owner page is off: set ADMIN_PASSWORD to see winners and their ticket codes.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    saveNow();
    process.exit(0);
  });
}
