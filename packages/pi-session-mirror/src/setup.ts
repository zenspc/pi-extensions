import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { encode } from "uqr";
import { loadConnections, parseConnections } from "./connections.ts";
import type { Connection, Mode } from "./connections.ts";
import { connectLocal, HOST_PROTOCOL, object, PORT, privateDir, wire } from "./protocol.ts";
import { setupTailscale, stopTailscale } from "./tailscale.ts";

type AdminRequest =
  | { kind: "status" | "revoke" | "shutdown" }
  | { kind: "pair"; mode: Mode }
  | { kind: "pair-active"; mode: Mode; code: string }
  | { kind: "configure"; connection: Connection };

export function admin(request: AdminRequest) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const unavailable = () => reject(new Error("Mirror host not reachable. Run /mirror to set up a connection."));
    let connection;
    try { connection = connectLocal(); } catch { return unavailable(); }
    const write = wire(connection, (value) => {
      if (!object(value) || value.kind !== request.kind) return connection.destroy();
      if (typeof value.error === "string") reject(new Error(value.error)); else resolve(value);
      connection.destroy();
    });
    connection.on("connect", () => write(request));
    connection.on("close", unavailable);
    connection.setTimeout(3_000, () => connection.destroy());
  });
}

function parseStatus(value: Record<string, unknown>) {
  const connections = parseConnections(value.connections);
  if (value.protocol !== HOST_PROTOCOL || !connections?.length || typeof value.sessions !== "number") {
    throw new Error("The mirror host is running an incompatible version. Run /mirror stop-server, then /reload and /mirror again.");
  }
  return { connections, sessions: value.sessions };
}

export async function mirrorStatus() {
  return parseStatus(await admin({ kind: "status" }));
}

export async function startMirror(connection?: Connection) {
  const running = await admin({ kind: "status" }).catch(() => undefined);
  if (running) {
    const status = parseStatus(running);
    if (connection && !status.connections.some(({ mode, origin }) => mode === connection.mode && origin === connection.origin)) {
      await admin({ kind: "configure", connection });
    }
  } else {
    const dir = privateDir(true);
    if (!connection && !loadConnections(dir).length) throw new Error("No saved mirror connection. Run /mirror to set one up.");
    await launch(connection);
  }
  return mirrorStatus();
}

export async function stopMirror(exec: ExtensionAPI["exec"]) {
  const stopped = await admin({ kind: "shutdown" }).then(() => true, () => false);
  const message = stopped ? "Mirror host stopped. Pi sessions are unaffected." : "Mirror host did not respond to shutdown.";
  try {
    const connection = loadConnections(privateDir()).find(({ mode }) => mode === "tailscale");
    return connection ? `${message} ${await stopTailscale(exec, connection.origin)}` : message;
  } catch (error) {
    throw new Error(`${message} ${error instanceof Error ? error.message : "Could not check Tailscale Serve."}`);
  }
}

export async function setupMirror({ pi, ctx, shared, enable, refresh }: {
  pi: ExtensionAPI; ctx: ExtensionContext; shared: boolean; enable: () => void; refresh: () => void;
}) {
  if (!ctx.isProjectTrusted()) throw new Error("Trust this project in Pi before enabling mirroring.");
  const saved = loadConnections(privateDir(true));
  if (!shared && !await ctx.ui.confirm("Share this project?", `Paired browsers can read and prompt Pi sessions in ${ctx.cwd}.`)) return;
  const connection = await setupTailscale((...args) => pi.exec(...args), ctx.ui, saved[0]?.origin);
  if (!connection) return;
  await startMirror(connection);
  if (!shared) enable();
  refresh();
  await pairMirror(ctx);
}

export async function pairMirror(ctx: ExtensionContext) {
  const status = await mirrorStatus();
  const connection = status.connections[0];
  const { mode: selectedMode, origin } = connection;
  const result = await admin({ kind: "pair", mode: selectedMode });
  if (result.origin !== origin || typeof result.code !== "string" || !/^[a-f0-9]{12}$/.test(result.code)) {
    throw new Error("Could not create a pairing code for that connection.");
  }
  const code = result.code;
  const qr = terminalQr(`${origin}/#pair=${code}`);
  let timer: NodeJS.Timeout | undefined;
  try {
    await ctx.ui.custom<void>((tui, _theme, keys, done) => {
      function check() {
        timer = setTimeout(async () => {
          const state = await admin({ kind: "pair-active", mode: selectedMode, code }).catch(() => undefined);
          if (!timer) return;
          if (state?.active === true) check(); else done();
        }, 1000).unref();
      }
      check();
      return {
        render(width) {
          const lines = ["Scan to pair this browser", origin, `Code: ${code} (expires in 2 minutes)`, "Press Enter or Esc to close"];
          const wrap = (text: string, size: number) => text.match(new RegExp(`.{1,${Math.max(1, size)}}`, "g")) ?? [];
          const side = width - qr.width - 2;
          const text = lines.flatMap((line) => wrap(line, side >= 26 ? side : width));
          const rows = tui.terminal.rows;
          if (side >= 26 && qr.lines.length < rows && text.length <= qr.lines.length) {
            return qr.lines.map((line, index) => line + (text[index] ? `  ${text[index]}` : ""));
          }
          return qr.width <= width && qr.lines.length + text.length < rows ? [...qr.lines, ...text] : text;
        },
        handleInput(data) {
          if (keys.matches(data, "tui.select.confirm") || keys.matches(data, "tui.select.cancel")) done();
        },
        invalidate() {},
      };
    });
  } finally {
    clearTimeout(timer);
    timer = undefined;
  }
}

function terminalQr(url: string) {
  const { data } = encode(url, { border: 4, ecc: "L" });
  const lines: string[] = [];
  const rgb = (black: boolean) => black ? "0;0;0" : "255;255;255";
  // Pack two QR rows into each terminal row. Fixed colors keep it scannable on either terminal theme.
  for (let y = 0; y < data.length; y += 2) {
    let line = "";
    let previous = "";
    for (let x = 0; x < data[y].length; x++) {
      const colors = `\x1b[38;2;${rgb(data[y][x])};48;2;${rgb(data[y + 1]?.[x] ?? false)}m`;
      line += (colors === previous ? "" : colors) + "▀";
      previous = colors;
    }
    lines.push(line + "\x1b[0m");
  }
  return { width: data[0].length, lines };
}

function launch(connection?: Connection) {
  return new Promise<void>((resolve, reject) => {
    const args = connection ? [connection.mode, connection.origin] : [];
    const child = spawn(process.execPath, [fileURLToPath(new URL("./host.ts", import.meta.url)), ...args], {
      detached: true, cwd: homedir(), env: { HOME: homedir() }, stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const timer = setTimeout(() => { child.kill(); failed(); }, 5_000);
    function failed() {
      clearTimeout(timer);
      reject(new Error(`Mirror host could not start. Check that loopback port ${PORT} and the private socket are available.`));
    }
    child.once("error", failed);
    child.once("exit", failed);
    child.once("message", (value: unknown) => {
      clearTimeout(timer);
      if (!object(value) || value.started !== true) return failed();
      child.unref();
      resolve();
    });
  });
}
