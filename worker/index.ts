// Golden Ticket table server: a Cloudflare Worker plus one SQLite-backed Durable Object.
//
// Optional. Without it the public site still works, but every roll happens in the
// visitor's browser. With it, the server does every roll (so wins can't be faked),
// enforces the 10-second limit per player and per IP address, keeps the roll count
// across all players, and saves every winner so the owner can check ticket codes
// on owner.html.
import { DurableObject } from "cloudflare:workers";

interface Env {
  TABLE: DurableObjectNamespace<Table>;
  ALLOWED_ORIGINS?: string;
  ADMIN_PASSWORD?: string;
  WIN_ODDS?: string; // testing only; defaults to 10,000
}

const DEFAULT_ODDS = 10_000;
const COOLDOWN_MS = 10_000;
const LOCKOUT_MS = 15 * 60_000;
const MAX_FAILS = 5;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alike characters

/* ---------------- Helpers ---------------- */

function oddsOf(env: Env): number {
  const n = Number.parseInt(env.WIN_ODDS ?? "", 10);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_ODDS;
}

// Uniform integer in [0, n), with no modulo bias.
function randomInt(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

// e.g. GT-7KQ2-M9XA-P4TR
function ticketCode(): string {
  const group = () => Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
  return `GT-${group()}-${group()}-${group()}`;
}

const cleanName = (raw: unknown) =>
  String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) || "Anonymous";

const validPlayer = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
}

async function samePassword(given: string, expected: string): Promise<boolean> {
  return crypto.subtle.timingSafeEqual(await sha256(given), await sha256(expected));
}

type Row = Record<string, SqlStorageValue>;

/* ---------------- The table (one Durable Object holds every roll count and winner) ---------------- */

export class Table extends DurableObject<Env> {
  private sql: SqlStorage;
  // Last roll time per player and per IP. Memory is enough: the object only shuts down
  // after sitting idle for longer than the 10-second cooldown.
  private lastRoll = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    for (const stmt of [
      `CREATE TABLE IF NOT EXISTS stats (id INTEGER PRIMARY KEY CHECK (id = 1), total_rolls INTEGER NOT NULL DEFAULT 0)`,
      `INSERT OR IGNORE INTO stats (id, total_rolls) VALUES (1, 0)`,
      `CREATE TABLE IF NOT EXISTS winners (code TEXT PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL,
         roll_number INTEGER NOT NULL, ip TEXT NOT NULL, player TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS owner_fails (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, since INTEGER NOT NULL)`,
    ]) this.sql.exec(stmt);
  }

  private one(query: string, ...args: SqlStorageValue[]): Row | null {
    return (this.sql.exec(query, ...args).toArray() as Row[])[0] ?? null;
  }

  private totalRolls(): number {
    return Number(this.one("SELECT total_rolls FROM stats WHERE id = 1")?.total_rolls ?? 0);
  }

  private waitMs(keys: string[], now: number): number {
    let wait = 0;
    for (const key of keys) {
      const t = this.lastRoll.get(key);
      if (t !== undefined) wait = Math.max(wait, t + COOLDOWN_MS - now);
    }
    return Math.max(0, wait);
  }

  private publicState() {
    const recent = this.sql.exec("SELECT name, at FROM winners ORDER BY at DESC LIMIT 5").toArray() as Row[];
    return {
      odds: oddsOf(this.env),
      cooldownMs: COOLDOWN_MS,
      totalRolls: this.totalRolls(),
      winnerCount: Number(this.one("SELECT COUNT(*) AS n FROM winners")?.n ?? 0),
      recentWinners: recent.map((w) => ({ name: String(w.name), at: new Date(Number(w.at)).toISOString() })),
    };
  }

  async state(player: string, ip: string) {
    return { ...this.publicState(), waitMs: this.waitMs([`p:${player}`, `ip:${ip}`], Date.now()) };
  }

  async roll(player: string, ip: string, rawName: unknown) {
    const now = Date.now();
    const keys = [`p:${player}`, `ip:${ip}`];
    const wait = this.waitMs(keys, now);
    if (wait > 0) return { error: "cooldown", waitMs: wait };
    for (const key of keys) this.lastRoll.set(key, now);
    for (const [key, t] of this.lastRoll) if (now - t >= COOLDOWN_MS) this.lastRoll.delete(key);

    const odds = oddsOf(this.env);
    const roll = randomInt(odds) + 1; // 1..odds
    const win = roll === odds;
    this.sql.exec("UPDATE stats SET total_rolls = total_rolls + 1 WHERE id = 1");

    let ticket = null;
    if (win) {
      let code = ticketCode();
      while (this.one("SELECT 1 FROM winners WHERE code = ?", code)) code = ticketCode();
      const name = cleanName(rawName);
      const rollNumber = this.totalRolls();
      this.sql.exec(
        "INSERT INTO winners (code, name, at, roll_number, ip, player) VALUES (?, ?, ?, ?, ?, ?)",
        code, name, now, rollNumber, ip, player,
      );
      ticket = { code, name, at: new Date(now).toISOString(), rollNumber };
    }
    return { ...this.publicState(), roll, win, ticket, waitMs: COOLDOWN_MS };
  }

  async owner(password: unknown, ip: string) {
    const expected = this.env.ADMIN_PASSWORD ?? "";
    if (!expected) return { error: "owner_off" };
    const now = Date.now();
    const fail = this.one("SELECT count, since FROM owner_fails WHERE ip = ?", ip);
    const recent = fail && now - Number(fail.since) < LOCKOUT_MS;
    if (recent && Number(fail.count) >= MAX_FAILS) return { error: "locked" };

    if (!(await samePassword(String(password ?? ""), expected))) {
      if (recent) this.sql.exec("UPDATE owner_fails SET count = count + 1 WHERE ip = ?", ip);
      else this.sql.exec("INSERT OR REPLACE INTO owner_fails (ip, count, since) VALUES (?, 1, ?)", ip, now);
      this.sql.exec("DELETE FROM owner_fails WHERE since < ?", now - LOCKOUT_MS);
      return { error: "wrong_password" };
    }
    this.sql.exec("DELETE FROM owner_fails WHERE ip = ?", ip);

    const rows = this.sql.exec("SELECT code, name, at, roll_number, ip FROM winners ORDER BY at DESC").toArray() as Row[];
    return {
      odds: oddsOf(this.env),
      totalRolls: this.totalRolls(),
      winners: rows.map((w) => ({
        code: String(w.code),
        name: String(w.name),
        at: new Date(Number(w.at)).toISOString(),
        rollNumber: Number(w.roll_number),
        ip: String(w.ip),
      })),
    };
  }
}

/* ---------------- HTTP front door ---------------- */

const hits = new Map<string, number[]>();
function rateLimited(bucket: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(bucket) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(bucket, recent);
  if (hits.size > 10000) hits.clear();
  return recent.length > limit;
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const OWNER_STATUS: Record<string, number> = { owner_off: 503, locked: 429, wrong_password: 401 };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "";
    const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const originOk = allowed.length === 0 || allowed.includes(origin);
    const cors: Record<string, string> = {
      "Access-Control-Allow-Origin": originOk && origin ? origin : allowed[0] ?? "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: originOk ? 204 : 403, headers: cors });

    const url = new URL(request.url);
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "Golden Ticket table", table: true, ownerPage: !!env.ADMIN_PASSWORD, odds: oddsOf(env) }, 200, cors);
    }
    if (!url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404, cors);
    if (!originOk) return json({ error: "origin_not_allowed" }, 403, cors);

    const table = env.TABLE.get(env.TABLE.idFromName("main"));

    if (request.method === "GET" && url.pathname === "/api/state") {
      if (rateLimited("state:" + ip, 60, 60_000)) return json({ error: "rate_limited" }, 429, cors);
      const player = url.searchParams.get("player");
      if (!validPlayer(player)) return json({ error: "bad_player" }, 400, cors);
      return json(await table.state(player, ip), 200, cors);
    }
    if (request.method !== "POST") return json({ error: "not_found" }, 404, cors);

    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400, cors); }

    switch (url.pathname) {
      case "/api/roll": {
        if (!validPlayer(body.player)) return json({ error: "bad_player" }, 400, cors);
        const out = await table.roll(body.player, ip, body.name);
        if ("error" in out) {
          return json(out, 429, { ...cors, "Retry-After": String(Math.ceil(out.waitMs / 1000)) });
        }
        return json(out, 200, cors);
      }
      case "/api/owner": {
        if (rateLimited("owner:" + ip, 20, 60_000)) return json({ error: "rate_limited" }, 429, cors);
        const out = await table.owner(body.password, ip);
        const status = "error" in out && out.error ? OWNER_STATUS[out.error] ?? 400 : 200;
        return json(out, status, cors);
      }
    }
    return json({ error: "not_found" }, 404, cors);
  },
};
