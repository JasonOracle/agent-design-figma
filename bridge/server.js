#!/usr/bin/env node
/**
 * agnet-design-figma Bridge - local bridge server
 * ==================================================================
 *   WorkBuddy / CLI  ──HTTP──▶  Bridge  ──long-poll──▶  Figma plugin UI
 *                                                          │ postMessage
 *                                                          ▼
 *                                                    plugin main thread
 *                                                    (Figma Plugin API)
 *
 * Guarantees:
 *  - Binds ONLY to loopback (127.0.0.1, plus ::1 so "localhost" resolves too).
 *    Nothing is ever exposed to the LAN.
 *  - Every request needs the temporary token (query `?token=` or `x-vibe-token`).
 *  - POST /v1/command is SYNCHRONOUS: it does not answer until the plugin has
 *    really executed the op and reported ok/error. "queued"/"pending" is never
 *    returned as success.
 *  - Zero npm dependencies (node:http only).
 * ==================================================================
 */

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/* ------------------------------------------------------------------ */
/* config                                                             */
/* ------------------------------------------------------------------ */

const ROOT = path.resolve(__dirname, "..");
const TOKEN_FILE = path.join(ROOT, ".vibe", "token");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  if (i !== -1) {
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
  }
  return fallback;
}

const PORT = Number(arg("port", process.env.VIBE_PORT || 45677));
const HOST = "127.0.0.1";                       // hard-coded loopback on purpose
const LOOPBACK_V6 = "::1";                      // so http://localhost works on Windows
const DEFAULT_TIMEOUT = Number(arg("timeout", 15000));
const MAX_TIMEOUT = Number(arg("maxTimeout", 600000));  // stage builds can outlive 120s on a cold Figma
const MAX_WAIT = 60000;
const PLUGIN_STALE_MS = 45000;                  // after this we consider the plugin gone
const HISTORY_MAX = 50;

/* --- token -------------------------------------------------------- */

function loadOrCreateToken() {
  const fromArg = arg("token", null);
  if (typeof fromArg === "string" && fromArg.length >= 8) return fromArg;
  if (process.env.VIBE_TOKEN && process.env.VIBE_TOKEN.length >= 8) return process.env.VIBE_TOKEN;
  try {
    const existing = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (existing.length >= 8) return existing;
  } catch (_) { /* not created yet */ }
  const fresh = crypto.randomBytes(16).toString("hex");
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, fresh, { mode: 0o600 });
  return fresh;
}

const TOKEN = loadOrCreateToken();

/* ------------------------------------------------------------------ */
/* state                                                              */
/* ------------------------------------------------------------------ */

let seq = 0;
const nextId = () => `cmd_${Date.now().toString(36)}_${(++seq).toString(36)}`;

const queue = [];            // commands waiting for the plugin to pick up
const waiters = [];          // pending long-poll HTTP responses
const inflight = new Map();  // id -> { resolve, reject, timer, op, startedAt }
const history = [];          // last N finished commands

// A "client" is anything that wants to receive commands (the Figma plugin UI,
// or the mock plugin). Clients MUST register via POST /v1/hello and then
// identify themselves on every poll. This is what stops an unrelated page -
// e.g. an IDE preview of plugin/ui.html - from silently eating commands.
const CLIENT_TTL_MS = 5 * 60 * 1000;
const clients = new Map();   // clientId -> { id, label, info, lastSeen }

/* ------------------------------------------------------------------ */
/* logging                                                            */
/* ------------------------------------------------------------------ */

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
const log = (...a) => console.log(`[${stamp()}]`, ...a);

/* ------------------------------------------------------------------ */
/* core plumbing                                                      */
/* ------------------------------------------------------------------ */

function enqueue(op, params) {
  const cmd = { id: nextId(), op, params: params || {}, createdAt: Date.now() };
  queue.push(cmd);
  log(`queue  + ${cmd.id}  ${op} ${JSON.stringify(cmd.params)}   (waiting: ${queue.length})`);
  flushWaiters();
  return cmd;
}

/**
 * Can this long-poll still receive bytes?
 *
 * A client that goes away (e.g. the plugin iframe is destroyed when the
 * plugin is re-run) can leave its response object behind. Writing to that
 * socket is a silent no-op: the command vanished while we happily logged
 * "deploy", and the caller waited forever -> NO_RESULT. So liveness is
 * checked before every single delivery.
 */
function waiterAlive(w) {
  if (!w || w.done) return false;
  const res = w.res;
  if (!res || res.writableEnded || res.destroyed) return false;
  const sock = res.socket;
  if (!sock || sock.destroyed || !sock.writable) return false;
  return true;
}

function dropWaiter(w) {
  w.done = true;
  clearTimeout(w.timer);
}

/** Remove long-polls whose client is gone, so they can never eat a command. */
function pruneWaiters(reason) {
  let dropped = 0;
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (!waiterAlive(waiters[i])) {
      dropWaiter(waiters[i]);
      waiters.splice(i, 1);
      dropped++;
    }
  }
  if (dropped) {
    log(`prune  dropped ${dropped} dead long-poll(s)${reason ? " (" + reason + ")" : ""} - live waiters: ${waiters.length}`);
  }
  return dropped;
}

/**
 * Hand queued commands to any waiting long-poll.
 * Never hands a command to a dead socket: if no live waiter exists the
 * command simply stays queued (which surfaces as NOT_PICKED_UP, an honest
 * error, instead of a silent black hole).
 */
function flushWaiters() {
  if (queue.length === 0 || waiters.length === 0) return;
  pruneWaiters("pre-delivery");
  while (queue.length > 0 && waiters.length > 0) {
    const waiter = waiters.shift();
    if (!waiterAlive(waiter)) {
      dropWaiter(waiter);
      log("deploy  skipped a dead long-poll");
      continue;
    }
    clearTimeout(waiter.timer);
    const cmd = queue.shift();
    waiter.cmdId = cmd.id;
    waiter.send({ ok: true, cmd });
    log(`deploy  ${cmd.id} -> client "${waiter.clientId}" (queue left: ${queue.length})`);

    // Watchdog: if a deployed command never comes back, NAME the client that
    // swallowed it. Without this, the failure shows up only as a bare
    // NO_RESULT on the caller side, which is very hard to attribute.
    const watchdog = setTimeout(() => {
      if (inflight.has(cmd.id)) {
        log(`warn   ${cmd.id} ("${cmd.op}") was deployed to client "${waiter.clientId}" but no result after 10s - that client never reported back`);
      }
    }, 10000);
    watchdog.unref?.();
  }
}

/**
 * Submit a command and wait for the plugin's REAL result.
 * Never resolves on "queued" - only on ok / error / timeout.
 */
function submitAndWait(op, params, timeoutMs, allowOfflineQueue) {
  const client = activeClient();
  const stale = client ? Date.now() - client.lastSeen : Infinity;
  if (!allowOfflineQueue && stale > PLUGIN_STALE_MS) {
    const err = new Error(
      !client
        ? "No Figma plugin is connected. Open Figma Desktop, run \"agnet-design-figma Bridge (Dev)\" from Plugins > Development, and wait for the panel to show 'connected'."
        : `Figma plugin has not polled for ${Math.round(stale / 1000)}s - it looks closed or crashed. Re-run the plugin and retry.`
    );
    err.code = "PLUGIN_OFFLINE";
    return Promise.reject(err);
  }

  const cmd = enqueue(op, params);
  return new Promise((resolve, reject) => {
    const entry = {
      resolve,
      reject,
      op,
      startedAt: Date.now(),
      timer: setTimeout(() => {
        inflight.delete(cmd.id);
        const still = queue.some((c) => c.id === cmd.id);
        const err = new Error(
          still
            ? `Timed out after ${timeoutMs}ms: the Figma plugin never picked up "${op}" (still queued).`
            : `Timed out after ${timeoutMs}ms: the plugin picked up "${op}" but never returned a result.`
        );
        err.code = still ? "NOT_PICKED_UP" : "NO_RESULT";
        history.push({ id: cmd.id, op, status: "timeout", error: err.message, at: Date.now() });
        reject(err);
      }, timeoutMs),
    };
    inflight.set(cmd.id, entry);
  });
}

function deliverResult(id, ok, data, error) {
  const entry = inflight.get(id);
  const record = {
    id,
    op: entry ? entry.op : undefined,
    status: ok ? "ok" : "error",
    nodeId: ok && data && data.created ? data.created.id : undefined,
    error: ok ? undefined : (error && error.message) || "unknown error",
    at: Date.now(),
  };
  history.push(record);
  while (history.length > HISTORY_MAX) history.shift();

  if (!entry) {
    log(`result  ${id} -> no caller waiting (late/duplicate), status=${record.status}`);
    return { delivered: false, reason: "unknown-or-expired-command" };
  }
  clearTimeout(entry.timer);
  inflight.delete(id);
  const ms = Date.now() - entry.startedAt;
  if (ok) {
    log(`result  ${id}  ok    ${ms}ms  ${record.nodeId ? "node " + record.nodeId : ""}`);
    entry.resolve(data);
  } else {
    log(`result  ${id}  ERROR ${ms}ms  ${record.error}`);
    const err = new Error(record.error);
    err.code = (error && error.code) || "PLUGIN_ERROR";
    err.partial = error && error.partial;
    entry.reject(err);
  }
  return { delivered: true, ms };
}

/* ------------------------------------------------------------------ */
/* HTTP                                                               */
/* ------------------------------------------------------------------ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-vibe-token",
  "Access-Control-Max-Age": "600",
};

function send(res, code, body) {
  const text = body === undefined ? "" : JSON.stringify(body, null, 2);
  res.writeHead(code, {
    ...CORS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}
const sendErr = (res, code, errCode, message, extra) =>
  send(res, code, { ok: false, error: { code: errCode, message, ...(extra || {}) } });

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("body too large"), { code: "TOO_LARGE" })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(Object.assign(new Error("Body is not valid JSON: " + e.message), { code: "BAD_JSON" })); }
    });
    req.on("error", reject);
  });
}

function authOk(url, req) {
  const given = url.searchParams.get("token") || req.headers["x-vibe-token"] || "";
  if (given.length !== TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(TOKEN));
}

/** The most recently active registered client, or null if none. */
function activeClient() {
  let best = null;
  for (const c of clients.values()) {
    if (Date.now() - c.lastSeen > CLIENT_TTL_MS) continue;
    if (!best || c.lastSeen > best.lastSeen) best = c;
  }
  return best;
}

function pluginStatus() {
  const c = activeClient();
  const stale = c ? Date.now() - c.lastSeen : null;
  return {
    connected: stale !== null && stale <= PLUGIN_STALE_MS,
    lastSeenAgoMs: stale,
    staleAfterMs: PLUGIN_STALE_MS,
    label: c ? c.label : null,
    info: c ? c.info : null,
    instance: c ? c.id : null,
    // List only live clients. Reloading the plugin destroys the old iframe,
    // which can never say goodbye and gets a brand new client id - so its
    // record lingered and /health looked as if several clients were competing
    // for commands. (Real write commands were never affected: delivery checks
    // liveness, and lookups go through activeClient().)
    registered: [...clients.values()]
      .filter((x) => Date.now() - x.lastSeen <= CLIENT_TTL_MS)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((x) => ({ id: x.id, label: x.label, lastSeenAgoMs: Date.now() - x.lastSeen })),
    expiredClients: [...clients.values()].filter((x) => Date.now() - x.lastSeen > CLIENT_TTL_MS).length,
    note: clients.size === 0 ? "no client has registered via POST /v1/hello" : undefined,
  };
}

const handleRequest = async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${HOST}:${PORT}`); }
  catch (_) { return sendErr(res, 400, "BAD_URL", "Malformed URL"); }

  const route = `${req.method} ${url.pathname}`;

  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }

  /* ---- public health (no token; contains no secrets) ---- */
  if (route === "GET /health" || route === "GET /") {
    return send(res, 200, {
      service: "agnet-design-figma-bridge",
      ok: true,
      host: HOST,
      port: PORT,
      tokenRequired: true,
      plugin: pluginStatus(),
      queue: queue.length,
      inflight: inflight.size,
      recent: history.slice(-8),
    });
  }

  if (!authOk(url, req)) {
    log(`${route}  -> 401 unauthorized`);
    return sendErr(res, 401, "UNAUTHORIZED", "Missing or invalid token. Use ?token=<token> or the x-vibe-token header.");
  }

  /* ---- plugin: long-poll for the next command ---- */
  if (route === "GET /v1/poll") {
    // Registration gate: a client with a valid token but no /v1/hello is
    // refused outright, so it can never swallow a command.
    const clientId = url.searchParams.get("client");
    if (!clientId) {
      log("poll   rejected: no client id");
      return sendErr(res, 403, "CLIENT_REQUIRED", "Missing `client` id. Register with POST /v1/hello first.");
    }
    const client = clients.get(clientId);
    if (!client || Date.now() - client.lastSeen > CLIENT_TTL_MS) {
      clients.delete(clientId);
      log(`poll   rejected: unregistered/expired client "${clientId}"`);
      return sendErr(res, 403, "CLIENT_NOT_REGISTERED", `Unknown or expired client "${clientId}". Register with POST /v1/hello first.`);
    }
    client.lastSeen = Date.now();
    const wait = Math.min(Math.max(Number(url.searchParams.get("wait")) || 20000, 0), MAX_WAIT);

    if (queue.length > 0) {
      const cmd = queue.shift();
      log(`deploy  ${cmd.id} -> plugin (immediate)`);
      return send(res, 200, { ok: true, cmd });
    }

    let done = false;
    const waiter = {
      res,                       // kept so liveness can be checked before delivery
      clientId,
      cmdId: null,
      send(payload) { if (done) return; done = true; send(res, 200, payload); },
      timer: setTimeout(() => { if (done) return; done = true; send(res, 200, { ok: true, cmd: null }); }, wait),
    };
    waiter.timer.unref?.();
    waiters.push(waiter);

    const forget = () => {
      if (done) return;
      done = true;
      clearTimeout(waiter.timer);
      const i = waiters.indexOf(waiter);
      if (i !== -1) waiters.splice(i, 1);
    };
    // Whichever fires first; res is the more reliable of the two.
    req.on("close", forget);
    res.on("close", forget);
    return;
  }

  /* ---- plugin: report the real execution result ---- */
  if (route === "POST /v1/result") {
    const rid = url.searchParams.get("client");
    if (rid && clients.has(rid)) clients.get(rid).lastSeen = Date.now();
    let body;
    try { body = await readBody(req); }
    catch (e) { return sendErr(res, 400, e.code || "BAD_BODY", e.message); }
    if (!body.id) return sendErr(res, 400, "BAD_BODY", "Missing `id`");
    const out = deliverResult(body.id, body.ok === true, body.data, body.error);
    return send(res, 200, { ok: true, ...out });
  }

  /* ---- plugin: register itself (mandatory before polling) ---- */
  if (route === "POST /v1/hello") {
    let body = {};
    try { body = await readBody(req); } catch (_) { /* optional */ }
    const clientId = body.clientId || body.instance;
    if (!clientId) {
      return sendErr(res, 400, "BAD_BODY", 'Missing `clientId`. Send {"clientId":"...","label":"figma-plugin-ui","info":{...}}');
    }
    const isNew = !clients.has(clientId);
    clients.set(clientId, {
      id: clientId,
      label: body.label || "unknown",
      info: body.info || null,
      lastSeen: Date.now(),
    });
    for (const [id, c] of clients) if (Date.now() - c.lastSeen > CLIENT_TTL_MS) clients.delete(id); // drop ghosts
    const page = body.info && body.info.page ? body.info.page : "-";
    log(`hello  ${isNew ? "new  " : "again"} client "${clientId}" (${body.label || "unknown"}) page="${page}"`);
    return send(res, 200, { ok: true, clientId });
  }

  /* ---- caller: submit a command and wait for the real result ---- */
  if (route === "POST /v1/command") {
    let body;
    try { body = await readBody(req); }
    catch (e) { return sendErr(res, 400, e.code || "BAD_BODY", e.message); }
    if (!body.op || typeof body.op !== "string") {
      return sendErr(res, 400, "BAD_BODY", "Missing `op` (string). Send {\"op\":\"create-frame\",\"params\":{...}}");
    }
    const timeoutMs = Math.min(Math.max(Number(body.timeoutMs) || DEFAULT_TIMEOUT, 1000), MAX_TIMEOUT);
    const queuedAt = Date.now();
    log(`command ${body.op} from caller (timeout ${timeoutMs}ms)`);
    try {
      const data = await submitAndWait(body.op, body.params, timeoutMs, body.allowOfflineQueue === true);
      return send(res, 200, { ok: true, status: "ok", elapsedMs: Date.now() - queuedAt, data });
    } catch (e) {
      const code = e.code || "ERROR";
      const http = code === "PLUGIN_OFFLINE" ? 503 : code === "TIMEOUT" || code === "NOT_PICKED_UP" || code === "NO_RESULT" ? 504 : 400;
      log(`command ${body.op} failed: ${code} ${e.message}`);
      return sendErr(res, http, code, e.message, e.partial ? { partial: e.partial } : undefined);
    }
  }

  /* ---- caller: history ---- */
  if (route === "GET /v1/history") {
    return send(res, 200, { ok: true, history: history.slice(-Number(url.searchParams.get("n")) || -20) });
  }

  return sendErr(res, 404, "NOT_FOUND", `No such endpoint: ${route}`);
};

const server = http.createServer(handleRequest);

/* ------------------------------------------------------------------ */
/* start                                                              */
/* ------------------------------------------------------------------ */

function start() {
  server.listen(PORT, HOST, () => {
    console.log("");
    console.log("  ┌───────────────────────────────────────────────────────────┐");
    console.log("  │  agnet-design-figma Bridge  -  local Figma write channel  │");
    console.log("  └───────────────────────────────────────────────────────────┘");
    log(`listening on http://${HOST}:${PORT}  (loopback only, token required)`);
    log(`token: ${TOKEN}`);
    log(`token file: ${TOKEN_FILE}`);
    console.log("");
    console.log("  Next: in Figma Desktop -> Plugins > Development > agnet-design-figma Bridge (Dev)");
    console.log("        the plugin panel should turn green (connected).");
    console.log("");
  });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      log(`FATAL: port ${PORT} is already in use. Another bridge is probably running.`);
      log(`       stop it, or start with:  node bridge/server.js --port <other>`);
    } else {
      log(`server error: ${e.message}`);
    }
    process.exit(1);
  });

  // Best-effort second listener on ::1 so that "http://localhost:PORT"
  // also works when Windows resolves localhost to IPv6 first.
  const v6 = http.createServer(handleRequest);
  v6.on("error", (e) => log(`note: could not also bind [${LOOPBACK_V6}]:${PORT} (${e.code}); use http://127.0.0.1:${PORT}`));
  if (arg("no-ipv6", false) !== true) v6.listen(PORT, LOOPBACK_V6, () => log(`also listening on http://[${LOOPBACK_V6}]:${PORT} (for "localhost")`));

  // Self-healing: reap long-polls whose client is gone even if no command is
  // in flight, so the waiter list can never accumulate dead entries.
  const sweeper = setInterval(() => pruneWaiters("sweep"), 5000);
  sweeper.unref?.();

  const bye = () => { log("shutting down"); process.exit(0); };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
}

start();
