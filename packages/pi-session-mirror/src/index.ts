import { randomUUID } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import type { Socket } from "node:net";
import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext, MessageStartEvent, SessionEntry, ToolExecutionUpdateEvent } from "@earendil-works/pi-coding-agent";
import { connectionFor } from "./connections.ts";
import { connectLocal, id, MAX_LIVE, MAX_ROWS, object, parseAction, PORT, privateDir, projectMarker, ROW_CHARS, wire } from "./protocol.ts";
import type { Action, Outcome, Publish, Row, View } from "./protocol.ts";
import { createDialogMirror } from "./questions.ts";
import { admin, mirrorStatus, pairMirror, setupMirror, startMirror, stopMirror } from "./setup.ts";

// Pi reloads extension factories on session replacement, but the picker should keep targeting this process.
const processKey = Symbol.for("@zenspc/pi-session-mirror/registration");
type Registration = { id: string; outcomes: Map<string, Outcome> };
const processState: typeof process & { [processKey]?: Registration } = process;
type Message = MessageStartEvent["message"];

const subcommands = {
  enable: "Share Pi sessions in this directory",
  disable: "Stop sharing this directory",
  start: "Start the host or set an HTTPS address",
  status: "Show host and session status",
  pair: "Show a browser pairing QR code",
  revoke: "Revoke all browser access",
  "stop-server": "Stop the host and its Tailscale Serve route",
};

function text(content: unknown): string {
  if (typeof content === "string") return clip(content);
  if (!Array.isArray(content)) return "";
  let result = "";
  for (const block of content) {
    if (!object(block) || block.type !== "text" || typeof block.text !== "string") continue;
    result += (result ? "\n" : "") + block.text.slice(0, ROW_CHARS + 1 - result.length);
    if (result.length > ROW_CHARS) break;
  }
  return clip(result);
}

function clip(value: string) {
  const suffix = "\n[Text truncated in mirror]";
  return value.length <= ROW_CHARS ? value : value.slice(0, ROW_CHARS - suffix.length) + suffix;
}

function entryRow(entry: SessionEntry): Row | null {
  const id = entry.id;
  if (entry.type === "compaction" || entry.type === "branch_summary") {
    return { id, label: entry.type === "compaction" ? "Compaction" : "Branch summary", text: clip(entry.summary) };
  }
  if (entry.type === "custom_message" && entry.display) {
    return { id, label: "Extension", text: text(entry.content) };
  }
  if (entry.type !== "message") return null;
  const message = entry.message;
  if (message.role === "toolResult") {
    const label = `${message.toolName}${message.isError ? " · error" : ""}`.slice(0, 256);
    return { id, label, text: text(message.content) };
  }
  if (message.role === "user" || message.role === "assistant") {
    const label = message.role === "user" ? "You" : "Pi";
    const body = text(message.content);
    if (body) return { id, label, text: body };
    if (message.role === "assistant" && message.stopReason === "error") return { id, label, text: "[Pi reported an error; see the terminal.]" };
    if (message.role === "user") return { id, label, text: "[No text to display]" };
  }
  return null;
}

export default function sessionMirror(pi: ExtensionAPI) {
  let ctx: ExtensionContext | undefined;
  let socket: Socket | undefined;
  let maintaining: NodeJS.Timeout | undefined;
  let scheduled: NodeJS.Timeout | undefined;
  let marker: string | undefined;
  let optedIn = false;
  let epoch = randomUUID();
  let run: string | null = null;
  let waiting = false;
  let assistant: { timestamp: number; text: string } | undefined;
  const tools = new Map<string, { row: Row; finished: boolean }>();
  const rowCache = new WeakMap<SessionEntry, Row | null>();
  let sent: { view: View; rows: Row[]; meta: string } | undefined;
  let leaf: string | null | undefined;
  let rows: Row[] = [];
  let truncated = false;
  let persistedTools = new Set<string>();
  let persistedReplies = new Set<number>();
  const dialogs = createDialogMirror(pi, enabled, changed, () => ctx?.signal);

  function enabled() {
    if (!ctx) return false;
    try {
      marker ??= projectMarker(privateDir(), ctx.cwd);
      return existsSync(marker);
    } catch { return false; }
  }

  function disconnect() {
    socket?.destroy();
    socket = undefined;
    sent = undefined;
  }

  function rebuildTranscript(current: ExtensionContext) {
    const nextLeaf = current.sessionManager.getLeafId();
    if (leaf === nextLeaf) return;
    leaf = nextLeaf;
    const recent: Row[] = [];
    persistedTools = new Set();
    persistedReplies = new Set();
    const branch = current.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0 && recent.length <= MAX_ROWS; i--) {
      const entry = branch[i];
      if (entry.type === "message" && entry.message.role === "assistant") persistedReplies.add(entry.message.timestamp);
      if (entry.type === "message" && entry.message.role === "toolResult") persistedTools.add(entry.message.toolCallId);
      let row = rowCache.get(entry);
      if (row === undefined) {
        row = entryRow(entry);
        rowCache.set(entry, row);
      }
      if (row) recent.push(row);
    }
    truncated = recent.length > MAX_ROWS;
    rows = recent.slice(0, MAX_ROWS).reverse();
  }

  function publish() {
    const current = ctx;
    const connection = socket;
    if (!current || !connection || connection.connecting || connection.destroyed) return;
    if (!enabled()) return disconnect();
    rebuildTranscript(current);
    const live: Row[] = [];
    if (assistant?.text && !persistedReplies.has(assistant.timestamp)) live.push({ id: "live-reply", label: "Pi · streaming", text: assistant.text });
    for (const [toolId, tool] of tools) {
      if (tool.finished && persistedTools.has(toolId)) {
        tools.delete(toolId);
      } else if (live.length < MAX_LIVE) live.push(tool.row);
    }
    const view: View = {
      epoch, run, live, truncated,
      name: (current.sessionManager.getSessionName() ?? "Untitled").slice(0, 256),
      project: (basename(current.cwd) || current.cwd).slice(0, 4096),
      status: waiting || dialogs.question ? "waiting" : current.isIdle() ? "idle" : "busy",
      canPrompt: Boolean(current.model),
      ...(dialogs.question && { question: dialogs.question }),
    };
    const meta = JSON.stringify(view);
    if (sent?.rows === rows && sent.meta === meta) return;
    let keep = 0;
    if (sent?.view.epoch === epoch) {
      const previous = sent.rows;
      while (keep < rows.length && rows[keep] === previous[keep]) keep++;
    }
    const registration = processState[processKey];
    if (!registration || !send) return;
    if (send({ kind: "view", id: registration.id, view, keep, append: rows.slice(keep) } satisfies Publish)) sent = { view, rows, meta };
  }

  function changed() {
    if (!socket || scheduled) return;
    // Coalesce token updates. The session manager commits finalized messages after message_end handlers.
    scheduled = setTimeout(() => { scheduled = undefined; publish(); }, 80);
    scheduled.unref();
  }

  function perform(action: Action): Outcome {
    const current = ctx;
    if (!current || !enabled() || action.epoch !== epoch) return "stale";
    if (action.kind === "answer") return dialogs.answer(action.question, action.answer);
    if (waiting || dialogs.question) return "waiting";
    const idle = current.isIdle();
    if (action.kind === "stop") {
      if (idle || action.run !== run) return "stale";
      current.abort();
      return "stopping";
    }
    if (!current.model) return "no-model";
    if (action.kind === "send" && !idle) return "busy";
    if (action.kind === "followUp" && (idle || action.run !== run)) return "stale";
    pi.sendUserMessage(action.text, { expandPromptTemplates: false, ...(action.kind === "followUp" && { deliverAs: "followUp" }) });
    return action.kind === "followUp" ? "queued" : "submitted";
  }

  let send: ReturnType<typeof wire> | undefined;
  function maintain() {
    optedIn = enabled();
    if (!optedIn) {
      assistant = undefined;
      tools.clear();
      return disconnect();
    }
    if (socket && !socket.destroyed) return publish();
    try {
      const connection = connectLocal();
      const registration = processState[processKey] ??= { id: randomUUID(), outcomes: new Map() };
      socket = connection;
      const write = wire(connection, (value) => {
        if (socket !== connection || !object(value) || value.kind !== "action" || !id(value.delivery) ||
            typeof value.expires !== "number" || !Number.isFinite(value.expires)) return connection.destroy();
        const action = parseAction(value.action);
        if (!action) return connection.destroy();
        let outcome = registration.outcomes.get(action.request);
        if (!outcome) {
          if (value.expires <= Date.now()) outcome = "stale";
          else if (registration.outcomes.size >= 20_000) outcome = "limit";
          else {
            try { outcome = perform(action); } catch { outcome = "uncertain"; }
            registration.outcomes.set(action.request, outcome);
          }
        }
        write({ kind: "outcome", delivery: value.delivery, outcome });
        changed();
      });
      send = write;
      connection.on("connect", publish);
      connection.on("close", () => { if (socket === connection) disconnect(); });
      connection.unref();
    } catch { /* The host may not have been started. Retry on the next tick. */ }
  }

  function attach(current: ExtensionContext) {
    if (current.mode !== "tui" || !current.isProjectTrusted()) return;
    ctx = current;
    if (current.hasUI) dialogs.install(current.ui);
    maintain();
    maintaining ??= setInterval(maintain, 1500).unref();
  }

  pi.on("session_start", (_event, current) => attach(current));
  pi.on("session_shutdown", () => {
    dialogs.reset();
    clearInterval(maintaining);
    clearTimeout(scheduled);
    maintaining = scheduled = undefined;
    disconnect();
    ctx = undefined;
    marker = undefined;
    optedIn = false;
    epoch = randomUUID();
    leaf = undefined;
    run = null;
    waiting = false;
    assistant = undefined;
    tools.clear();
  });
  pi.on("session_tree", () => {
    dialogs.cancel();
    epoch = randomUUID();
    leaf = undefined;
    assistant = undefined;
    tools.clear();
    changed();
  });
  pi.on("session_info_changed", changed);
  pi.on("session_compact", changed);
  pi.on("model_select", (_event, current) => { if (ctx) ctx = current; changed(); });
  pi.on("agent_start", () => { run = randomUUID(); changed(); });
  pi.on("agent_end", () => { run = null; assistant = undefined; tools.clear(); changed(); });
  pi.on("agent_settled", changed);
  pi.on("ui_prompt_start", () => { waiting = true; changed(); });
  pi.on("ui_prompt_end", () => { waiting = false; changed(); });
  pi.on("message_start", ({ message }) => {
    if (message.role === "user" && run) run = randomUUID();
    changed();
  });
  function trackAssistant(message: Message) {
    if (optedIn && message.role === "assistant") assistant = { timestamp: message.timestamp, text: text(message.content) };
    changed();
  }
  pi.on("message_update", ({ message }) => trackAssistant(message));
  pi.on("message_end", ({ message }) => trackAssistant(message));
  pi.on("turn_end", () => { assistant = undefined; tools.clear(); changed(); });

  function trackTool(toolId: string, name: string, content: unknown, finished = false, failed = false) {
    if (optedIn && (tools.has(toolId) || tools.size < MAX_LIVE)) {
      tools.set(toolId, { finished, row: {
        id: `live-${toolId}`.slice(0, 512), label: `${name}${failed ? " · error" : finished ? "" : " · running"}`.slice(0, 256), text: text(content),
      } });
    }
    changed();
  }
  pi.on("tool_execution_start", (event) => trackTool(event.toolCallId, event.toolName, undefined));
  pi.on("tool_execution_update", (event: ToolExecutionUpdateEvent) => {
    trackTool(event.toolCallId, event.toolName, object(event.partialResult) ? event.partialResult.content : undefined);
  });
  pi.on("tool_execution_end", (event) => {
    trackTool(event.toolCallId, event.toolName, object(event.result) ? event.result.content : undefined, true, event.isError);
  });

  function setSharing(current: ExtensionContext, share: boolean) {
    if (!current.isProjectTrusted()) throw new Error("Trust this project in Pi before changing mirroring.");
    marker = projectMarker(privateDir(true), current.cwd);
    if (share) {
      writeFileSync(marker, "", { mode: 0o600, flag: "a" });
      attach(current);
    } else {
      rmSync(marker, { force: true });
      maintain();
    }
  }

  pi.registerCommand("mirror", {
    description: "Open Pi Session Mirror setup and pairing",
    getArgumentCompletions: (prefix) => {
      const items = Object.entries(subcommands)
        .filter(([name]) => name.startsWith(prefix.trimStart()))
        .map(([name, description]) => ({ value: name, label: name, description }));
      return items.length ? items : null;
    },
    handler: async (args, current) => {
      if (current.mode !== "tui") return;
      const [command, target, extra] = args.trim().split(/\s+/);
      const notify = (message: string) => current.ui.notify(message, "info");
      try {
        if (!command) {
          await setupMirror({ pi, ctx: current, shared: enabled(), enable: () => setSharing(current, true), refresh: maintain });
        } else if (command === "enable" || command === "disable") {
          setSharing(current, command === "enable");
          notify(`Mirror ${command === "enable" ? "enabled" : "disabled"} for this working directory.`);
        } else if (command === "start") {
          const connection = target && !extra ? connectionFor("tailscale", target) : undefined;
          if (target && !connection) throw new Error("Usage: /mirror start [<tailscale-https-url>]");
          const result = await startMirror(connection);
          maintain();
          notify(`Mirror host running at ${result.connections.map(({ origin }) => origin).join(", ")}. Loopback port: ${PORT}.`);
        } else if (command === "status") {
          const result = await mirrorStatus();
          const registration = socket && !socket.connecting && processState[processKey];
          const local = registration ? ` · this session ${registration.id.slice(0, 8)}` : "";
          notify(`${result.connections.map(({ origin }) => origin).join(", ")} · ${result.sessions} live · this directory ${enabled() ? "enabled" : "disabled"}${local}`);
        } else if (command === "pair") {
          if ((target && target !== "tailscale") || extra) throw new Error("Usage: /mirror pair [tailscale]");
          await pairMirror(current);
        } else if (command === "revoke") {
          await admin({ kind: "revoke" });
          notify("All mirror browsers and outstanding codes revoked.");
        } else if (command === "stop-server") {
          notify(await stopMirror((...args) => pi.exec(...args)));
        } else notify("Run /mirror for setup, or type /mirror followed by a space for commands.");
      } catch (error) {
        current.ui.notify(error instanceof Error ? error.message : "Mirror command failed.", "error");
      }
    },
  });
}
