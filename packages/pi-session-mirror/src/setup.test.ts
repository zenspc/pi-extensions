import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentSessionFromServices, createAgentSessionServices, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { connectionFor, isMode, loadConnections, parseConnection, parseConnections, saveConnections } from "./connections.ts";
import { startHost } from "./host.ts";
import mirror from "./index.ts";
import { object, PORT, privateDir, socketPath, wire } from "./protocol.ts";
import { mirrorStatus, startMirror } from "./setup.ts";
import { serveRoute, setupTailscale } from "./tailscale.ts";

const hostname = "demo.example.ts.net";
const port = "8443";
const key = `${hostname}:${port}`;
const upstream = `http://127.0.0.1:${PORT}`;
const ready = { TCP: { [port]: { HTTPS: true } }, Web: { [key]: { Handlers: { "/": { Proxy: upstream } } } } };

function fakeTailscale(config: unknown) {
  const writes: string[][] = [];
  let current = config;
  const exec: ExtensionAPI["exec"] = async (command, args) => {
    assert.equal(command, "tailscale");
    let value;
    if (args.join(" ") === "status --json") value = { BackendState: "Running", Self: { DNSName: hostname + "." } };
    else if (args.join(" ") === "serve status --json") value = current;
    else {
      writes.push(args);
      current = args.at(-1) === "off" ? {} : ready;
      value = null;
    }
    return { stdout: JSON.stringify(value), stderr: "", code: 0, killed: false };
  };
  return { exec, writes, use: (next: unknown) => { current = next; } };
}

test("Serve only reuses the dedicated private mirror route", () => {
  assert.equal(serveRoute({}, hostname, port), "free");
  assert.equal(serveRoute(ready, hostname, port), "ready");
  assert.equal(serveRoute({ ...ready, AllowFunnel: { [key]: true } }, hostname, port), "conflict");
  assert.equal(serveRoute({ Foreground: { foreground: ready } }, hostname, port), "conflict");
  assert.equal(serveRoute({ ...ready, Web: { [key]: { Handlers: { "/": { Proxy: upstream }, "/other": { Text: "other app" } } } } }, hostname, port), "conflict");
  assert.equal(serveRoute({ TCP: { [port]: { HTTPS: true } } }, hostname, port), "conflict");
});

test("guided Tailscale setup requires consent and leaves newly occupied ports alone", async () => {
  const fresh = fakeTailscale({});
  assert.equal(await setupTailscale(fresh.exec, { confirm: async () => false }), undefined);
  assert.deepEqual(fresh.writes, []);
  const consent = { confirm: async () => true };
  assert.deepEqual(await setupTailscale(fresh.exec, consent), { mode: "tailscale", origin: `https://${key}` });
  assert.deepEqual(fresh.writes, [["serve", "--bg", `--https=${port}`, upstream]]);
  await setupTailscale(fresh.exec, { confirm: async () => assert.fail("already set up") });
  assert.equal(fresh.writes.length, 1);

  const occupied = fakeTailscale({});
  await assert.rejects(setupTailscale(occupied.exec, { confirm: async () => {
    occupied.use({ ...ready, AllowFunnel: { [key]: true } });
    return true;
  } }), /already in use/);
  assert.deepEqual(occupied.writes, []);
});

test("setup refuses an older host before reusing its incompatible questionnaire transport", async (t) => {
  const home = process.env.HOME;
  const cwd = mkdtempSync(join(tmpdir(), "mirror-old-host-"));
  process.env.HOME = cwd;
  t.after(() => {
    if (home === undefined) delete process.env.HOME; else process.env.HOME = home;
    rmSync(cwd, { recursive: true, force: true });
  });
  const requests: string[] = [];
  let protocol: number | undefined;
  const host = createServer((socket) => {
    const send = wire(socket, (value) => {
      assert.ok(object(value));
      assert.equal(value.kind, "status");
      requests.push(value.kind);
      send({ kind: "status", connections: [{ mode: "tailscale", origin: `https://${key}` }], sessions: 1, protocol });
    });
  });
  await new Promise<void>((resolve) => host.listen(socketPath(privateDir(true)), resolve));
  t.after(() => new Promise<void>((resolve, reject) => host.close((error) => error ? reject(error) : resolve())));
  for (protocol of [undefined, 0, 999]) {
    await assert.rejects(mirrorStatus(), /incompatible version.*stop-server/);
    await assert.rejects(startMirror(), /incompatible version.*stop-server/);
  }
  assert.deepEqual(requests, Array(6).fill("status"), "incompatible hosts must not be configured or paired");
});

test("/mirror stop-server also stops the saved background Tailscale route", async (t) => {
  const home = process.env.HOME;
  const cwd = mkdtempSync(join(tmpdir(), "mirror-stop-"));
  process.env.HOME = cwd;
  t.after(() => {
    if (home === undefined) delete process.env.HOME; else process.env.HOME = home;
    rmSync(cwd, { recursive: true, force: true });
  });
  const dir = privateDir(true);
  const connection = connectionFor("tailscale", `https://${key}`);
  assert.ok(connection);
  saveConnections(dir, [connection]);
  const host = await startHost({ initial: [connection], dir, port: 0 });
  t.after(host.close);
  assert.deepEqual(await mirrorStatus(), { connections: [connection], sessions: 0 });
  assert.deepEqual(await startMirror(), { connections: [connection], sessions: 0 });
  const tailscale = fakeTailscale(ready);
  const services = await createAgentSessionServices({
    cwd, agentDir: join(cwd, "agent"), settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: { noExtensions: true, extensionFactories: [(pi) => mirror({ ...pi, exec: tailscale.exec })] },
  });
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(cwd) });
  t.after(async () => {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  });
  const notices: string[] = [];
  await session.bindExtensions({ mode: "tui", uiContext: {
    ...session.extensionRunner.createContext().ui,
    notify: (message) => { notices.push(message); },
    select: async () => assert.fail("Tailscale setup must not ask for a connection mode"),
    input: async () => assert.fail("Tailscale setup must not ask for a local HTTPS address"),
    confirm: async () => false,
  } });
  await session.prompt("/mirror");
  assert.deepEqual(notices, []);
  for (const command of ["/mirror start lan https://mirror.home.example.com", "/mirror start https://mirror.home.example.com", "/mirror pair lan"]) {
    await session.prompt(command);
    assert.match(notices.at(-1) ?? "", /^Usage: \/mirror (start|pair)/);
  }
  assert.deepEqual(tailscale.writes, []);
  const off = ["serve", "--bg", `--https=${port}`, "off"];
  await session.prompt("/mirror stop-server");
  assert.deepEqual(tailscale.writes, [off]);
  await host.close();

  await session.prompt("/mirror stop-server");
  assert.deepEqual(tailscale.writes, [off]);
  tailscale.use(ready);
  await session.prompt("/mirror stop-server");
  assert.deepEqual(tailscale.writes, [off, off]);

  tailscale.use({ ...ready, Web: { [key]: { Handlers: { "/": { Proxy: upstream }, "/other": { Text: "other app" } } } } });
  await session.prompt("/mirror stop-server");
  tailscale.use({ ...ready, Web: { [key]: { Handlers: { "/": { Proxy: "http://127.0.0.1:8080" } } } } });
  await session.prompt("/mirror stop-server");
  assert.deepEqual(tailscale.writes, [off, off]);
});

test("saved LAN connections are ignored without losing the Tailscale address", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mirror-connections-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tailscale = { mode: "tailscale", origin: `https://${key}` };
  const lan = { mode: "lan", origin: "https://mirror.home.example.com" };
  const path = join(dir, "connections.json");
  writeFileSync(path, JSON.stringify([lan, tailscale]), { mode: 0o600 });
  assert.deepEqual(loadConnections(dir), [tailscale]);
  writeFileSync(path, JSON.stringify([lan]));
  assert.deepEqual(loadConnections(dir), []);
});

test("connections accept only one exact Tailscale HTTPS origin", () => {
  const connection = { mode: "tailscale", origin: `https://${key}` };
  assert.deepEqual(connectionFor("tailscale", `https://${key}/`), connection);
  assert.equal(isMode("lan"), false);
  assert.equal(parseConnection({ mode: "lan", origin: "https://mirror.example.com" }), undefined);
  assert.equal(parseConnections([{ mode: "lan", origin: "https://mirror.example.com" }]), undefined);
  assert.deepEqual(parseConnections([connection]), [connection]);
  assert.equal(parseConnections([connection, connection]), undefined);
  for (const url of ["https://mirror.example.com", `http://${key}`, `https://name@${key}`, `https://${key}/app`, `https://${key}/?query=1`, `https://${key}/#pair=123`]) {
    assert.equal(connectionFor("tailscale", url), undefined);
  }
});
