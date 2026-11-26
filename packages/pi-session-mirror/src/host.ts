import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync, unlinkSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createLocalServer, type Socket } from "node:net";
import { pathToFileURL } from "node:url";
import { connectionFor, isMode, loadConnections, parseConnection, parseConnections, saveConnections, withConnection } from "./connections.ts";
import type { Connection } from "./connections.ts";
import { HOST_PROTOCOL, id, isOutcome, isPublish, object, parseAction, PORT, privateDir, PROMPT_BYTES, socketPath, wire } from "./protocol.ts";
import type { Action, Outcome, Snapshot } from "./protocol.ts";

const COOKIE = "__Host-pi-mirror";
const SESSION_SECONDS = 12 * 60 * 60;
const PAIR_TTL = 120_000;
const ACTION_TTL = 4_000;
const MAX_BROWSERS = 32;
const MAX_SSE_BUFFER = 18 * 1024 * 1024;

const assets = new Map([
  ["/", "index.html", "text/html; charset=utf-8"],
  ["/mirror.js", "mirror.js", "text/javascript; charset=utf-8"],
  ["/mirror.css", "mirror.css", "text/css; charset=utf-8"],
].map(([path, file, type]) => [path, { type, data: readFileSync(new URL(`../web/${file}`, import.meta.url)) }]));

type Browser = { origin: string; expires: number };
type Pending = { finish: (outcome: Outcome) => void };
type Peer = {
  socket: Socket;
  snapshot: Snapshot;
  pending: Map<string, Pending>;
  send: ReturnType<typeof wire>;
};
type Stream = { browser: Browser; response: ServerResponse; selected: string | null };

export async function startHost({ initial, port = PORT, dir }: { initial: Connection[]; port?: number; dir: string }) {
  const configured = parseConnections(initial);
  if (!configured?.length) throw new Error("Configure at least one mirror HTTPS connection.");
  let connections = configured;
  const path = socketPath(dir);
  const browsers = new Map<string, Browser>();
  const peers = new Map<string, Peer>();
  const streams = new Set<Stream>();
  const sockets = new Set<Socket>();
  const pairing = new Map<string, { code: string; expires: number }>();
  let attempts = 0;
  let attemptWindow = 0;
  let closing: Promise<void> | undefined;

  function reply(res: ServerResponse, status: number, body: object) {
    if (res.destroyed) return;
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
  }

  function sse(stream: Stream, event: string, data: unknown) {
    if (stream.browser.expires <= Date.now() || stream.response.writableLength > MAX_SSE_BUFFER) {
      // Reconnect slow readers with a fresh snapshot instead of queuing more output.
      stream.response.destroy();
      return;
    }
    stream.response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function registry() {
    return [...peers].map(([session, { snapshot: { view } }]) => ({
      id: session, name: view.name, project: view.project, status: view.status,
    }));
  }

  function sendRegistry() {
    const data = registry();
    for (const stream of streams) sse(stream, "sessions", data);
  }

  function expire() {
    const now = Date.now();
    for (const [token, browser] of browsers) if (browser.expires <= now) browsers.delete(token);
    for (const stream of streams) if (stream.browser.expires <= now) stream.response.destroy();
  }

  function revoke(origin?: string) {
    if (origin) pairing.delete(origin); else pairing.clear();
    for (const [token, browser] of browsers) if (!origin || browser.origin === origin) browsers.delete(token);
    for (const stream of streams) if (!origin || stream.browser.origin === origin) stream.response.destroy();
  }

  function authenticated(req: IncomingMessage, origin: string) {
    const token = req.headers.cookie?.match(/(?:^|;\s*)__Host-pi-mirror=([a-f0-9]{64})(?:;|$)/)?.[1];
    const browser = token && browsers.get(token);
    return browser && browser.origin === origin && browser.expires > Date.now() ? browser : undefined;
  }

  function dispatch(peer: Peer, action: Action) {
    if (peer.pending.size >= 64) return Promise.resolve<Outcome>("limit");
    return new Promise<Outcome>((resolve) => {
      // This ID identifies the relay attempt; Pi deduplicates the browser's separate request ID.
      const delivery = randomUUID();
      const timer = setTimeout(() => finish("uncertain"), ACTION_TTL);
      function finish(outcome: Outcome) {
        clearTimeout(timer);
        peer.pending.delete(delivery);
        resolve(outcome);
      }
      peer.pending.set(delivery, { finish });
      if (!peer.send({ kind: "action", delivery, expires: Date.now() + ACTION_TTL, action })) finish("uncertain");
    });
  }

  async function http(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Strict-Transport-Security", "max-age=86400");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
    const origin = connections.find((connection) => new URL(connection.origin).host === req.headers.host)?.origin;
    if (!origin || req.headers["x-forwarded-proto"] !== "https" || !req.url?.startsWith("/") || req.url.startsWith("//")) {
      return reply(res, 421, { error: "Use a configured mirror HTTPS URL." });
    }
    const url = new URL(req.url, origin);
    if (url.origin !== origin) return reply(res, 400, { error: "Invalid URL." });
    const asset = assets.get(url.pathname);
    if (req.method === "GET" && asset) return res.writeHead(200, { "Content-Type": asset.type }).end(asset.data);
    if (req.method === "POST" && req.headers.origin !== origin) return reply(res, 403, { error: "Origin not allowed." });
    if (req.method === "POST" && url.pathname === "/api/pair") {
      const now = Date.now();
      if (now >= attemptWindow) {
        attemptWindow = now + 60_000;
        attempts = 0;
      }
      if (++attempts > 10) {
        res.setHeader("Retry-After", Math.ceil((attemptWindow - now) / 1000));
        return reply(res, 429, { error: "Too many pairing attempts. Try again in a minute." });
      }
      const value = await jsonBody(req, 1024);
      const code = object(value) && typeof value.code === "string" ? value.code.trim().toLowerCase() : "";
      const pair = pairing.get(origin);
      if (!/^[a-f0-9]{12}$/.test(code) || !pair || pair.expires <= Date.now() ||
          !timingSafeEqual(Buffer.from(code), Buffer.from(pair.code))) {
        return reply(res, 401, { error: "The pairing code is invalid, used, or expired." });
      }
      expire();
      if (browsers.size >= MAX_BROWSERS) return reply(res, 503, { error: "Too many paired browsers. Revoke access in Pi first." });
      pairing.delete(origin);
      const token = randomBytes(32).toString("hex");
      browsers.set(token, { origin, expires: Date.now() + SESSION_SECONDS * 1000 });
      res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}`);
      return reply(res, 200, { paired: true });
    }

    const browser = authenticated(req, origin);
    if (!browser) return reply(res, 401, { error: "Pair this browser in Pi first." });
    if (req.method === "GET" && url.pathname === "/api/status") return res.writeHead(204).end();
    if (req.method === "GET" && url.pathname === "/api/events") {
      const selected = url.searchParams.get("session");
      if (selected !== null && !id(selected)) return reply(res, 400, { error: "Invalid session ID." });
      if (streams.size >= MAX_BROWSERS * 3 || [...streams].filter((s) => s.browser === browser).length >= 3) {
        return reply(res, 429, { error: "Too many open mirror tabs." });
      }
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" });
      const stream = { browser, response: res, selected };
      streams.add(stream);
      res.on("close", () => streams.delete(stream));
      const snapshot = selected ? peers.get(selected)?.snapshot : undefined;
      // One write guarantees the initial registry and snapshot are ordered, even under backpressure.
      res.write(`event: sessions\ndata: ${JSON.stringify(registry())}\n\n` +
        (snapshot ? `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n` : ""));
      return;
    }
    const target = /^\/api\/sessions\/([^/]+)\/action$/.exec(url.pathname)?.[1];
    if (req.method === "POST" && id(target)) {
      const action = parseAction(await jsonBody(req, PROMPT_BYTES * 6 + 512));
      if (!action) return reply(res, 400, { error: "Invalid action. Send a valid question answer or a plain text prompt up to 16 KiB, without slash or shell commands." });
      if (authenticated(req, origin) !== browser) return reply(res, 401, { error: "Browser access expired or was revoked." });
      const peer = peers.get(target);
      if (!peer) return reply(res, 409, { error: "This Pi session is offline." });
      const outcome = await dispatch(peer, action);
      return reply(res, outcome === "uncertain" ? 504 : 200, { outcome });
    }
    return reply(res, 404, { error: "Not found." });
  }

  const httpServer = createServer({ requestTimeout: 10_000, headersTimeout: 8_000 }, (req, res) => {
    void http(req, res).catch(() => { if (!res.headersSent) reply(res, 400, { error: "Invalid request." }); });
  });
  httpServer.maxConnections = 128;

  const local = createLocalServer((socket) => {
    sockets.add(socket);
    let session: string | undefined;
    socket.setTimeout(4_000, () => socket.destroy());
    const send = wire(socket, (value) => {
      if (isPublish(value)) {
        if (session !== undefined && session !== value.id) return socket.destroy();
        const previous = peers.get(value.id);
        if (previous && previous.socket !== socket) return socket.destroy();
        const fresh = !previous || previous.snapshot.view.epoch !== value.view.epoch;
        if (value.keep > (fresh ? 0 : previous.snapshot.rows.length)) return socket.destroy();
        const snapshot = { view: value.view, rows: [...(previous?.snapshot.rows.slice(0, value.keep) ?? []), ...value.append] };
        const peer = previous ?? { socket, snapshot, pending: new Map<string, Pending>(), send };
        const before = peer.snapshot.view;
        peer.snapshot = snapshot;
        session = value.id;
        peers.set(session, peer);
        socket.setTimeout(0);
        // A snapshot/delta goes first so controls are already current when a new picker entry appears.
        for (const stream of streams) {
          if (stream.selected === session) sse(stream, fresh ? "snapshot" : "update", fresh ? snapshot : value);
        }
        if (fresh || before.name !== value.view.name || before.project !== value.view.project || before.status !== value.view.status) sendRegistry();
        return;
      }
      if (!object(value)) return socket.destroy();
      if (session !== undefined) {
        if (value.kind !== "outcome" || !id(value.delivery) || !isOutcome(value.outcome)) return socket.destroy();
        peers.get(session)?.pending.get(value.delivery)?.finish(value.outcome);
        return;
      }
      const kind = value.kind;
      if (kind === "status") send({ kind, connections, sessions: peers.size, protocol: HOST_PROTOCOL });
      else if (kind === "configure") {
        const connection = parseConnection(value.connection);
        if (!connection) send({ kind, error: "Invalid HTTPS connection." });
        else {
          const previous = connections.find(({ mode }) => mode === connection.mode);
          const next = withConnection(connections, connection);
          try {
            saveConnections(dir, next);
            connections = next;
            if (previous && previous.origin !== connection.origin) revoke(previous.origin);
            send({ kind });
          } catch { send({ kind, error: "Could not save mirror connection settings." }); }
        }
      } else if (kind === "pair") {
        const connection = value.mode === undefined && connections.length === 1 ? connections[0] :
          connections.find(({ mode }) => mode === value.mode);
        if (!connection) send({ kind, error: "Choose a configured connection to pair." });
        else {
          const pair = { code: randomBytes(6).toString("hex"), expires: Date.now() + PAIR_TTL };
          pairing.set(connection.origin, pair);
          send({ kind, code: pair.code, origin: connection.origin, expires: pair.expires });
        }
      } else if (kind === "pair-active") {
        const connection = connections.find(({ mode }) => mode === value.mode);
        const pair = connection && pairing.get(connection.origin);
        send({ kind, active: Boolean(pair && pair.code === value.code && pair.expires > Date.now()) });
      } else if (kind === "revoke") {
        revoke();
        send({ kind });
      } else if (kind === "shutdown") {
        send({ kind });
        socket.end(() => { void close(); });
        return;
      } else return socket.destroy();
      socket.end();
    });
    socket.on("close", () => {
      sockets.delete(socket);
      if (!session) return;
      const peer = peers.get(session);
      if (!peer || peer.socket !== socket) return;
      peers.delete(session);
      for (const pending of peer.pending.values()) pending.finish("uncertain");
      for (const stream of streams) if (stream.selected === session) sse(stream, "offline", null);
      sendRegistry();
    });
  });
  local.maxConnections = 128;

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "127.0.0.1", () => { httpServer.off("error", reject); resolve(); });
  });
  try {
    // Owning the fixed loopback port serializes host startup before stale socket cleanup.
    const existing = lstatSync(path, { throwIfNoEntry: false });
    if (existing?.isSocket()) unlinkSync(path);
    await new Promise<void>((resolve, reject) => {
      local.once("error", reject);
      local.listen(path, () => { local.off("error", reject); resolve(); });
    });
  } catch (error) {
    httpServer.close();
    throw error;
  }
  const timer = setInterval(() => {
    expire();
    for (const stream of streams) sse(stream, "heartbeat", null);
  }, 15_000);

  function close() {
    if (closing) return closing;
    clearInterval(timer);
    revoke();
    httpServer.close();
    httpServer.closeAllConnections();
    for (const socket of sockets) socket.destroy();
    closing = new Promise<void>((resolve) => local.close(() => resolve()));
    return closing;
  }

  const address = httpServer.address();
  return { close, port: typeof address === "object" && address ? address.port : port };
}

async function jsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  if (req.headers["content-type"]?.split(";", 1)[0] !== "application/json" || Number(req.headers["content-length"]) > limit) {
    throw new Error("Invalid body headers");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    if (!Buffer.isBuffer(chunk) || (size += chunk.length) > limit) throw new Error("Body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const dir = privateDir(true);
    const saved = loadConnections(dir);
    const mode = process.argv[2];
    const connection = isMode(mode) ? connectionFor(mode, process.argv[3] ?? "") : undefined;
    if (mode && !connection) throw new Error("Invalid mirror connection.");
    const initial = connection ? withConnection(saved, connection) : saved;
    const host = await startHost({ initial, dir });
    try { if (connection) saveConnections(dir, initial); } catch (error) { await host.close(); throw error; }
    for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { void host.close(); });
    process.send?.({ started: true }, () => process.disconnect?.());
  } catch {
    process.send?.({ started: false });
    process.exitCode = 1;
  }
}
