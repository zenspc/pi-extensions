import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withQuestion } from "./questions.ts";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSessionFromServices, createAgentSessionServices, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { loadConnections, type Connection } from "./connections.ts";
import { startHost } from "./host.ts";
import mirror from "./index.ts";
import { connectLocal, object, privateDir, projectMarker, wire } from "./protocol.ts";
import type { Action, Publish, Snapshot } from "./protocol.ts";

const origin = "https://test-node.example.ts.net:8443";
const initialConnections = [{ mode: "tailscale", origin }] satisfies Connection[];

function control(kind: string, fields: object = {}) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = connectLocal();
    const write = wire(socket, (value) => {
      if (!object(value) || value.kind !== kind) return socket.destroy();
      resolve(value);
      socket.destroy();
    });
    socket.setTimeout(2000, () => socket.destroy());
    socket.on("connect", () => write({ ...fields, kind }));
    socket.on("close", () => reject(new Error(`Host did not answer ${kind}`)));
  });
}

function watch(port: number, cookie: string, id = "", via = origin) {
  const url = `http://127.0.0.1:${port}/api/events${id ? `?session=${id}` : ""}`;
  const request = get(url, { headers: { Host: new URL(via).host, "X-Forwarded-Proto": "https", Cookie: cookie }, signal: AbortSignal.timeout(12_000) });
  type Event = { kind: string; data: unknown };
  const events: Event[] = [];
  let notify: (() => void) | undefined;
  let ended = false;
  let snapshot: Snapshot | undefined;
  request.on("response", (res) => {
    let buffer = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const match = /^event: (\w+)\ndata: (.+)$/.exec(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (match) events.push({ kind: match[1], data: JSON.parse(match[2]) });
      }
      notify?.();
    });
    res.on("close", () => { ended = true; notify?.(); });
  });
  request.on("error", () => { ended = true; notify?.(); });
  async function take() {
    while (!events.length && !ended) await new Promise<void>((resolve) => { notify = resolve; });
    const event = events.shift();
    if (event?.kind === "snapshot") snapshot = event.data as Snapshot;
    else if (event?.kind === "update" && snapshot) {
      const { view, keep, append } = event.data as Publish;
      snapshot = { view, rows: [...snapshot.rows.slice(0, keep), ...append] };
    }
    return event;
  }
  return {
    close: () => request.destroy(),
    async until<T>(kind: string, accept: (data: T) => boolean = () => true): Promise<T> {
      for (let event = await take(); event; event = await take()) {
        if (event.kind === kind && accept(event.data as T)) return event.data as T;
      }
      throw new Error(`Stream ended while waiting for ${kind}`);
    },
    async view(accept: (value: Snapshot) => boolean) {
      for (let event = await take(); event; event = await take()) {
        if ((event.kind === "snapshot" || event.kind === "update") && snapshot && accept(snapshot)) return snapshot;
      }
      throw new Error("Stream ended while waiting for a view");
    },
    async closed() {
      while (await take()) { /* Drain remaining data. */ }
    },
  };
}

function request(port: number, path: string, { cookie = "", body, via = origin, from = via }: {
  cookie?: string; body?: object; via?: string; from?: string;
} = {}) {
  // Reproduce the headers provided by a reverse proxy when forwarding HTTPS to loopback.
  return new Promise<{ status: number | undefined; headers: import("node:http").IncomingHttpHeaders; data: unknown }>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: body ? "POST" : "GET", signal: AbortSignal.timeout(5500),
      headers: { Host: new URL(via).host, "X-Forwarded-Proto": "https", Cookie: cookie, ...(body && { Origin: from, "Content-Type": "application/json" }) },
    }, (res) => {
      let content = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { content += chunk; });
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers,
        data: res.headers["content-type"]?.startsWith("application/json") ? JSON.parse(content) : content,
      }));
    });
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function paired(port: number) {
  const { code } = await control("pair");
  assert.match(String(code), /^[a-f0-9]{12}$/);
  const res = await request(port, "/api/pair", { body: { code } });
  assert.equal(res.status, 200);
  const header = res.headers["set-cookie"]?.[0];
  assert.match(header ?? "", /^__Host-pi-mirror=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200$/);
  assert.equal((await request(port, "/api/pair", { body: { code } })).status, 401);
  return String(header).split(";", 1)[0];
}

function answer(text: string): AssistantMessage {
  return {
    role: "assistant", content: [{ type: "text", text }], timestamp: Date.now(),
    api: "openai-completions", provider: "mirror-test", model: "test", stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

function modelCall(signal?: AbortSignal) {
  const stream = createAssistantMessageEventStream();
  const partial = answer("");
  signal?.addEventListener("abort", () => {
    stream.push({ type: "error", reason: "aborted", error: { ...partial, stopReason: "aborted" } });
  }, { once: true });
  stream.push({ type: "start", partial });
  return {
    stream,
    update(text: string) {
      partial.content = [{ type: "text", text }];
      stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial });
    },
    finish(text: string) {
      stream.push({ type: "done", reason: "stop", message: { ...partial, content: [{ type: "text", text }] } });
    },
    read(path: string) {
      stream.push({ type: "done", reason: "toolUse", message: { ...partial, stopReason: "toolUse",
        content: [{ type: "toolCall", id: "read-test", name: "read", arguments: { path } }],
      } });
    },
  };
}

test("real Pi session mirrors in both directions, catches up, deduplicates and scopes stop to the run", { timeout: 22_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-mirror-"));
  const home = process.env.HOME;
  process.env.HOME = root;
  const dir = privateDir(true);
  const host = await startHost({ initial: initialConnections, dir, port: 0 });
  const remote = new Set<ReturnType<typeof watch>>();
  let host2: Awaited<ReturnType<typeof startHost>> | undefined;
  t.after(async () => {
    for (const stream of remote) stream.close();
    await host.close();
    await host2?.close();
    if (home === undefined) delete process.env.HOME; else process.env.HOME = home;
    rmSync(root, { recursive: true, force: true });
  });
  const cookie = await paired(host.port);
  const registry = watch(host.port, cookie);
  remote.add(registry);
  assert.deepEqual(await registry.until("sessions"), []);

  const other = connectLocal();
  t.after(() => other.destroy());
  const otherId = randomUUID();
  const otherEpoch = randomUUID();
  const otherActions: unknown[] = [];
  const sendOther = wire(other, (message) => {
    if (object(message) && message.kind === "action") {
      otherActions.push(message.action);
      other.destroy(); // The host cannot tell whether this action was run before the connection closed.
    }
  });
  other.on("connect", () => sendOther({ kind: "view", id: otherId, keep: 0, append: [], view: {
    epoch: otherEpoch, name: "Other session", project: "other-dir", status: "idle", run: null, live: [], canPrompt: true, truncated: false,
  } } satisfies Publish));

  let extensionPi: ExtensionAPI | undefined;
  const services = await createAgentSessionServices({
    cwd: root, agentDir: join(root, "agent"),
    settingsManager: SettingsManager.inMemory({ cacheWarming: "off", compaction: { enabled: false } }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
      extensionFactories: [(pi) => { extensionPi = pi; mirror(pi); }] },
  });
  const calls: ReturnType<typeof modelCall>[] = [];
  let nextCall: ((call: ReturnType<typeof modelCall>) => void) | undefined;
  services.modelRuntime.registerProvider("mirror-test", {
    baseUrl: "http://127.0.0.1:1", api: "openai-completions", apiKey: "test-only",
    models: [{ id: "test", name: "test", reasoning: false, input: ["text"], contextWindow: 80_000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(_model, _context, options) {
      const call = modelCall(options?.signal);
      if (nextCall) { nextCall(call); nextCall = undefined; } else calls.push(call);
      return call.stream;
    },
  });
  const takeCall = () => calls.shift() ?? new Promise<ReturnType<typeof modelCall>>((resolve) => { nextCall = resolve; });
  const model = services.modelRuntime.getModel("mirror-test", "test");
  assert.ok(model);
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(root), model });
  t.after(async () => {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    await session.abort();
    session.dispose();
  });
  let terminalChoice: ((value: string | undefined) => void) | undefined;
  let terminalClosed = 0;
  let terminalConfirm: ((value: boolean) => void) | undefined;
  let terminalInput: ((value: string | undefined) => void) | undefined;
  await session.bindExtensions({ mode: "tui", uiContext: {
    ...session.extensionRunner.getUIContext(),
    confirm(_title, _message, opts) {
      return new Promise((resolve) => {
        terminalConfirm = resolve;
        opts?.signal?.addEventListener("abort", () => resolve(false), { once: true });
      });
    },
    input(_title, _placeholder, opts) {
      return new Promise((resolve) => {
        terminalInput = resolve;
        opts?.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
      });
    },
    select(_title, _options, opts) {
      return new Promise((resolve) => {
        terminalChoice = resolve;
        opts?.signal?.addEventListener("abort", () => { terminalClosed++; resolve(undefined); }, { once: true });
      });
    },
  } });
  const complete = session.extensionRunner.getCommand("mirror")?.getArgumentCompletions;
  assert.ok(complete);
  assert.deepEqual((await complete(""))?.map((item) => item.value), ["enable", "disable", "start", "status", "pair", "revoke", "stop-server"]);
  assert.deepEqual((await complete("sta"))?.map((item) => item.value), ["start", "status"]);
  assert.equal(await complete("start "), null);

  type Session = { id: string; project: string };
  assert.deepEqual(await registry.until<Session[]>("sessions", (list) => list.length === 1), [{ id: otherId, project: "other-dir", name: "Other session", status: "idle" }]);
  writeFileSync(projectMarker(dir, root), "", { mode: 0o600 });
  const list = await registry.until<Session[]>("sessions", (items) => items.length === 2);
  const current = list.find((item) => item.id !== otherId)?.id;
  assert.ok(current);
  const stream = watch(host.port, cookie, current);
  remote.add(stream);
  const initial = await stream.until<Snapshot>("snapshot");
  const epoch = initial.view.epoch;
  const actionURL = `/api/sessions/${current}/action`;
  async function act(body: Action) {
    const response = await request(host.port, actionURL, { cookie, body });
    assert.equal(response.status, 200);
    assert.ok(object(response.data));
    return response.data.outcome;
  }

  const selection = session.extensionRunner.getUIContext().select("Choose a route", ["Direct", "Scenic"]);
  const questionView = await stream.view((snap) => snap.view.status === "waiting");
  assert.ok(questionView.view.question?.kind === "choice", "select options must appear in the browser view");
  assert.deepEqual(questionView.view.question.options, [{ label: "Direct" }, { label: "Scenic" }]);
  terminalChoice?.("Direct");
  assert.equal(await selection, "Direct");
  await stream.view((snap) => snap.view.status === "idle");
  const ui = session.extensionRunner.getUIContext();
  const fromBrowser = ui.select("Remote choice", ["Direct", "Scenic"]);
  const remoteQuestion = (await stream.view((snap) => snap.view.question?.title === "Remote choice")).view.question;
  assert.ok(remoteQuestion);
  const reconnected = watch(host.port, cookie, current);
  remote.add(reconnected);
  assert.deepEqual((await reconnected.until<Snapshot>("snapshot")).view.question, remoteQuestion);
  reconnected.close();
  assert.equal(await act({ kind: "answer", request: randomUUID(), epoch, question: remoteQuestion.id,
    answer: { kind: "choice", selected: [7], other: null } }), "invalid");
  const response = { kind: "answer", request: randomUUID(), epoch, question: remoteQuestion.id,
    answer: { kind: "choice", selected: [1], other: null } } satisfies Action;
  const beforeClose = terminalClosed;
  assert.equal(await act(response), "answered");
  assert.equal(await fromBrowser, "Scenic");
  assert.equal(terminalClosed, beforeClose + 1, "the browser answer must dismiss the terminal dialog");
  assert.equal(await act(response), "answered", "the same request is not executed twice");
  assert.equal(await act({ ...response, request: randomUUID() }), "stale");
  await stream.view((snap) => !snap.view.question && snap.view.status === "idle");

  const confirmation = ui.confirm("Continue?", "This is a confirmation.");
  const confirmQuestion = (await stream.view((snap) => snap.view.question?.title === "Continue?")).view.question;
  assert.ok(confirmQuestion);
  assert.equal(await act({ kind: "answer", request: randomUUID(), epoch, question: confirmQuestion.id,
    answer: { kind: "choice", selected: [0], other: null } }), "answered");
  assert.equal(await confirmation, true);
  terminalConfirm?.(false);
  await stream.view((snap) => !snap.view.question);

  const input = ui.input("A path", "Enter a path");
  const inputQuestion = (await stream.view((snap) => snap.view.question?.title === "A path")).view.question;
  assert.ok(inputQuestion);
  assert.equal(await act({ kind: "answer", request: randomUUID(), epoch, question: inputQuestion.id,
    answer: { kind: "text", text: "/tmp/example" } }), "answered");
  assert.equal(await input, "/tmp/example", "answers are data, not slash commands");
  terminalInput?.("late terminal answer");
  await stream.view((snap) => !snap.view.question);

  const controller = new AbortController();
  const cancelled = ui.select("Cancelled by its caller", ["One"], { signal: controller.signal });
  const cancelQuestion = (await stream.view((snap) => snap.view.question?.title === "Cancelled by its caller")).view.question;
  assert.ok(cancelQuestion);
  controller.abort();
  assert.equal(await cancelled, undefined);
  assert.equal(await act({ ...response, request: randomUUID(), question: cancelQuestion.id }), "stale");
  await stream.view((snap) => !snap.view.question);

  assert.ok(extensionPi);
  let customClosed = false;
  const custom = withQuestion(extensionPi, { kind: "choice", title: "Any custom extension", details: "Pick several or write your own.",
    options: [{ label: "Alpha", description: "First option" }, { label: "Beta" }], multiple: true, allowOther: true },
  (signal) => new Promise((resolve) => signal.addEventListener("abort", () => { customClosed = true; resolve({ kind: "cancel" }); }, { once: true })));
  const customView = (await stream.view((snap) => snap.view.question?.title === "Any custom extension")).view.question;
  assert.ok(customView);
  assert.equal(await act({ kind: "answer", request: randomUUID(), epoch, question: customView.id,
    answer: { kind: "choice", selected: [0, 1], other: "Also gamma" } }), "answered");
  assert.deepEqual(await custom, { kind: "choice", selected: [0, 1], other: "Also gamma" });
  assert.equal(customClosed, true);
  await stream.view((snap) => !snap.view.question);

  const rpivAttempts: unknown[] = [];
  const offRpiv = extensionPi.events.on("rpiv:ask-user:answer", (value) => {
    assert.ok(object(value));
    rpivAttempts.push(value);
    extensionPi?.events.emit("rpiv:ask-user:answer-result", { toolCallId: value.toolCallId, requestId: value.requestId, ok: true });
    extensionPi?.events.emit("rpiv:ask-user:blocked", { toolCallId: value.toolCallId, active: false });
  });
  extensionPi.events.emit("rpiv:ask-user:prompt", { toolCallId: "rpiv-network-call", questions: [
    { question: "Which route?", header: "Route", multiSelect: false,
      options: [{ label: "Direct", description: "Fewer stops" }, { label: "Scenic", description: "More views" }] },
    { question: "Which tests?", header: "Tests", multiSelect: true,
      options: [{ label: "Unit", description: "Fast" }, { label: "Integration", description: "Complete" }] },
  ] });
  const questionnaire = (await stream.view((snap) => snap.view.question?.kind === "questionnaire")).view.question;
  assert.ok(questionnaire?.kind === "questionnaire");
  assert.equal(questionnaire.questions.length, 2);
  const rpivReconnect = watch(host.port, cookie, current);
  remote.add(rpivReconnect);
  assert.deepEqual((await rpivReconnect.until<Snapshot>("snapshot")).view.question, questionnaire);
  rpivReconnect.close();
  const rpivAction = { kind: "answer", request: randomUUID(), epoch, question: questionnaire.id, answer: {
    kind: "questionnaire", answers: [
      { kind: "choice", selected: [1], other: null, notes: "route note" },
      { kind: "choice", selected: [0, 1], other: "manual tests" },
    ], globalNote: "global note",
  } } satisfies Action;
  assert.equal(await act(rpivAction), "answered");
  assert.equal(await act(rpivAction), "answered");
  assert.equal(rpivAttempts.length, 1, "duplicate HTTP delivery emits only one RPIV submission");
  const rpivPayload = rpivAttempts[0];
  assert.ok(object(rpivPayload));
  assert.equal(rpivPayload.toolCallId, "rpiv-network-call");
  assert.deepEqual(rpivPayload.answers, [
    { questionIndex: 0, optionIndexes: [1], notes: "route note" },
    { questionIndex: 1, optionIndexes: [0, 1], text: "manual tests" },
  ]);
  assert.equal(rpivPayload.globalNote, "global note");
  await stream.view((snap) => !snap.view.question);
  offRpiv();

  const terminal = session.prompt("terminal prompt");
  const first = await takeCall();
  first.update("assembling <script>");
  const inProgress = await stream.view((snap) => snap.view.live.some((row) => row.text === "assembling <script>"));
  assert.equal(inProgress.rows.filter((row) => row.text === "terminal prompt").length, 1);
  const run = inProgress.view.run;
  assert.ok(run);
  await session.extensionRunner.emit({ type: "ui_prompt_start", reason: "ui_prompt", kind: "confirm" });
  await stream.view((snap) => snap.view.status === "waiting");
  assert.equal(await act({ kind: "stop", request: randomUUID(), epoch, run }), "waiting");
  await session.extensionRunner.emit({ type: "ui_prompt_end", reason: "ui_prompt", kind: "confirm" });
  const follow = { kind: "followUp", text: "phone follow-up", request: randomUUID(), epoch, run } satisfies Action;
  assert.deepEqual(await Promise.all([act(follow), act(follow)]), ["queued", "queued"]);
  stream.close();
  const resumed = watch(host.port, cookie, current);
  remote.add(resumed);
  const snapshot = await resumed.until<Snapshot>("snapshot");
  assert.equal(snapshot.view.live.filter((row) => row.text === "assembling <script>").length, 1);
  first.finish("final terminal reply");
  await takeCall();
  const second = await resumed.view((snap) => snap.rows.some((row) => row.text === "phone follow-up") && Boolean(snap.view.run && snap.view.run !== run));
  assert.equal(second.rows.filter((row) => row.text === "phone follow-up").length, 1);
  assert.equal(await act({ kind: "stop", request: randomUUID(), epoch, run }), "stale");
  assert.ok(second.view.run);
  assert.equal(await act({ kind: "stop", request: randomUUID(), epoch, run: second.view.run }), "stopping");
  await terminal;
  await resumed.view((snap) => snap.view.status === "idle");
  const prompt = { kind: "send", request: randomUUID(), epoch, text: "idle from phone" } satisfies Action;
  assert.equal(await act(prompt), "submitted");
  const toolFile = join(root, "fixture.txt");
  writeFileSync(toolFile, "mirror tool output");
  (await takeCall()).read(toolFile);
  (await takeCall()).finish("phone reply");
  const completed = await resumed.view((snap) => snap.view.status === "idle" && snap.rows.some((row) => row.text === "phone reply"));
  assert.ok(completed.rows.some((row) => row.label === "read" && row.text === "mirror tool output"));
  assert.deepEqual(otherActions, []);
  const firstReplyId = completed.rows.find((row) => row.text === "final terminal reply")?.id;
  assert.ok(firstReplyId);
  await session.navigateTree(firstReplyId, { summarize: false });
  const branched = await resumed.until<Snapshot>("snapshot");
  assert.notEqual(branched.view.epoch, epoch);
  assert.deepEqual(branched.rows.map((row) => row.text), ["terminal prompt", "final terminal reply"]);
  assert.equal(await act({ ...prompt, request: randomUUID() }), "stale");

  const otherPrompt = { ...prompt, request: randomUUID(), epoch: otherEpoch };
  const delivery = await request(host.port, `/api/sessions/${otherId}/action`, { cookie, body: otherPrompt });
  assert.equal(delivery.status, 504);
  assert.deepEqual(delivery.data, { outcome: "uncertain" });
  assert.deepEqual(otherActions, [otherPrompt]);

  await control("revoke");
  await resumed.closed();
  assert.equal((await request(host.port, "/api/status", { cookie })).status, 401);
  await host.close();
  host2 = await startHost({ initial: initialConnections, dir, port: 0 });
  const newCookie = await paired(host2.port);
  const restarted = watch(host2.port, newCookie, current);
  remote.add(restarted);
  assert.deepEqual((await restarted.until<Snapshot>("snapshot")).rows, branched.rows);
  rmSync(projectMarker(dir, root));
  await restarted.until("offline");
});

test("the HTTP listener requires a pairing cookie, exact origin and bounded text", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-mirror-auth-"));
  const home = process.env.HOME;
  process.env.HOME = root;
  const dir = privateDir(true);
  chmodSync(dir, 0o755);
  assert.throws(() => privateDir(), /must be a private directory/);
  chmodSync(dir, 0o700);
  const host = await startHost({ initial: initialConnections, dir, port: 0 });
  t.after(async () => {
    await host.close();
    if (home === undefined) delete process.env.HOME; else process.env.HOME = home;
    rmSync(root, { recursive: true, force: true });
  });
  assert.equal((await fetch(`http://127.0.0.1:${host.port}/`)).status, 421);
  const page = await request(host.port, "/");
  assert.equal(page.status, 200);
  assert.match(String(page.headers["content-security-policy"]), /frame-ancestors 'none'/);
  assert.equal((await request(host.port, "/api/events")).status, 401);
  const path = `/api/sessions/${randomUUID()}/action`;
  const body = { kind: "send", request: randomUUID(), epoch: randomUUID(), text: "hello" };
  assert.equal((await request(host.port, path, { body })).status, 401);
  const cookie = await paired(host.port);
  assert.equal((await request(host.port, path, { cookie, body, from: "https://unrelated.example" })).status, 403);
  for (const text of [" ", "/reload", "!pwd", "😀".repeat(4097)]) {
    assert.equal((await request(host.port, path, { cookie, body: { ...body, text } })).status, 400);
  }
  assert.equal((await request(host.port, path, { cookie, body })).status, 409);
  for (let i = 0; i < 8; i++) assert.equal((await request(host.port, "/api/pair", { body: { code: "000000000000" } })).status, 401);
  assert.equal((await request(host.port, "/api/pair", { body: { code: "000000000000" } })).status, 429);
});

test("the host rejects LAN connections and revokes access when the Tailscale origin changes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-mirror-origin-"));
  const home = process.env.HOME;
  process.env.HOME = root;
  const dir = privateDir(true);
  const host = await startHost({ initial: initialConnections, dir, port: 0 });
  t.after(async () => {
    await host.close();
    if (home === undefined) delete process.env.HOME; else process.env.HOME = home;
    rmSync(root, { recursive: true, force: true });
  });
  const lan = "https://mirror.home.example.com";
  const oldCookie = await paired(host.port);
  assert.deepEqual(await control("configure", { connection: { mode: "lan", origin: lan } }), { kind: "configure", error: "Invalid HTTPS connection." });
  assert.deepEqual(loadConnections(dir), []);
  assert.equal((await request(host.port, "/", { via: lan })).status, 421);
  assert.deepEqual(await control("pair", { mode: "lan" }), { kind: "pair", error: "Choose a configured connection to pair." });
  assert.equal((await control("pair-active", { mode: "lan", code: "000000000000" })).active, false);

  const { code: oldCode } = await control("pair", { mode: "tailscale" });
  const stream = watch(host.port, oldCookie);
  t.after(stream.close);
  assert.deepEqual(await stream.until("sessions"), []);
  const via = "https://new-node.example.ts.net:8443";
  const connection = { mode: "tailscale", origin: via } satisfies Connection;
  assert.deepEqual(await control("configure", { connection }), { kind: "configure" });
  assert.deepEqual(loadConnections(dir), [connection]);
  await stream.closed();
  assert.equal((await request(host.port, "/api/status", { cookie: oldCookie })).status, 421);
  assert.equal((await request(host.port, "/api/status", { via, cookie: oldCookie })).status, 401);
  assert.equal((await request(host.port, "/api/pair", { via, body: { code: oldCode } })).status, 401);

  const { code } = await control("pair", { mode: "tailscale" });
  assert.equal((await control("pair-active", { mode: "tailscale", code })).active, true);
  const response = await request(host.port, "/api/pair", { via, body: { code } });
  assert.equal(response.status, 200);
  const cookie = response.headers["set-cookie"]?.[0].split(";", 1)[0];
  assert.ok(cookie);
  assert.equal((await control("pair-active", { mode: "tailscale", code })).active, false);
  assert.equal((await request(host.port, "/api/status", { via, cookie })).status, 204);
});
