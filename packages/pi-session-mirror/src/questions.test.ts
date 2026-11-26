import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createEventBus, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { acceptsAnswer, isPublish, isQuestion, parseAction, parseAnswer } from "./protocol.ts";
import type { Publish, Question, QuestionAnswer } from "./protocol.ts";
import { createDialogMirror, customQuestion, QUESTION_EVENT, withQuestion } from "./questions.ts";
import type { QuestionRequest } from "./questions.ts";

function choice() {
  return { id: randomUUID(), kind: "choice", title: "Choose", options: [{ label: "One" }, { label: "Two" }], multiple: false, allowOther: false } satisfies Question;
}

function deferred<T>() {
  let resolve: (value: T) => void;
  let reject: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve: (value: T) => resolve(value), reject: (error: Error) => reject(error) };
}

function capture(events: ReturnType<typeof createEventBus>) {
  let request: QuestionRequest | undefined;
  events.on(QUESTION_EVENT, (value) => {
    assert.ok(typeof value === "object" && value !== null && "question" in value && isQuestion(value.question) &&
      "signal" in value && value.signal instanceof AbortSignal && "respond" in value && typeof value.respond === "function");
    const { question, signal, respond } = value;
    request = { question, signal, respond: (answer) => { respond(answer); } };
  });
  return () => { assert.ok(request); return request; };
}

test("a remote answer closes the terminal and all competing renderers before resolving", async () => {
  const events = createEventBus();
  const getRequest = capture(events);
  let terminalClosed = 0;
  let terminalAnswer: ((answer: QuestionAnswer) => void) | undefined;
  const result = withQuestion({ events }, choice(), (signal) => new Promise((resolve) => {
    terminalAnswer = resolve;
    signal.addEventListener("abort", () => { terminalClosed++; resolve({ kind: "cancel" }); }, { once: true });
  }));
  const request = getRequest();
  request.respond({ kind: "text", text: "wrong type" });
  request.respond({ kind: "choice", selected: [0, 1], other: null });
  request.respond({ kind: "choice", selected: [0], other: "not permitted" });
  assert.equal(request.signal.aborted, false);
  request.respond({ kind: "choice", selected: [1], other: null });
  assert.equal(request.signal.aborted, true);
  request.respond({ kind: "choice", selected: [0], other: null });
  terminalAnswer?.({ kind: "choice", selected: [0], other: null });
  assert.deepEqual(await result, { kind: "choice", selected: [1], other: null });
  assert.equal(terminalClosed, 1);
});

test("custom terminal questions close through their own done callback, including cancellation before mounting", async () => {
  const events = createEventBus();
  const getRequest = capture(events);
  let begin: (() => void) | undefined;
  let closed = 0;
  const ui: Pick<ExtensionUIContext, "custom"> = {
    custom(factory) {
      return new Promise((resolve) => {
        let finished = false;
        const done = (answer: unknown) => {
          if (finished) return;
          finished = true;
          closed++;
          Reflect.apply(resolve, undefined, [answer]);
        };
        // These test factories do not use the terminal, theme, or keybindings.
        begin = () => { Reflect.apply(factory, undefined, [undefined, undefined, undefined, done]); };
        begin();
      });
    },
  };
  const result = customQuestion({ events }, { ui, signal: undefined }, choice(), () => ({ render: () => ["Choose"], invalidate() {} }));
  getRequest().respond({ kind: "choice", selected: [1], other: null });
  assert.deepEqual(await result, { kind: "choice", selected: [1], other: null });
  assert.equal(closed, 1);

  const controller = new AbortController();
  let constructed = false;
  const delayed: Pick<ExtensionUIContext, "custom"> = {
    custom(factory) {
      return new Promise((resolve) => {
        begin = () => { Reflect.apply(factory, undefined, [undefined, undefined, undefined, resolve]); };
      });
    },
  };
  const cancelled = customQuestion({ events }, { ui: delayed, signal: controller.signal }, choice(), () => {
    constructed = true;
    return { render: () => [], invalidate() {} };
  });
  controller.abort();
  begin?.();
  assert.deepEqual(await cancelled, { kind: "cancel" });
  assert.equal(constructed, false);
});

test("terminal completion, cancellation and timeout invalidate remote callbacks", async () => {
  const events = createEventBus();
  const getRequest = capture(events);
  const terminal = deferred<QuestionAnswer>();
  const result = withQuestion({ events }, choice(), () => terminal.promise);
  const request = getRequest();
  terminal.resolve({ kind: "choice", selected: [0], other: null });
  assert.deepEqual(await result, { kind: "choice", selected: [0], other: null });
  assert.equal(request.signal.aborted, true);
  request.respond({ kind: "choice", selected: [1], other: null });

  const controller = new AbortController();
  let cancelled = false;
  const pending = withQuestion({ events }, choice(), (signal) => new Promise((resolve) => {
    signal.addEventListener("abort", () => { cancelled = true; resolve({ kind: "cancel" }); }, { once: true });
  }), controller.signal);
  controller.abort();
  assert.deepEqual(await pending, { kind: "cancel" });
  assert.equal(cancelled, true);
  assert.equal(getRequest().signal.aborted, true);

  const timed = withQuestion({ events }, choice(), () => new Promise((resolve) => {
    setTimeout(() => resolve({ kind: "cancel" }), 1);
  }));
  const expired = getRequest();
  assert.deepEqual(await timed, { kind: "cancel" });
  assert.equal(expired.signal.aborted, true);
  const aborted = new AbortController();
  aborted.abort();
  assert.deepEqual(await withQuestion({ events }, choice(), () => assert.fail("must not open a cancelled dialog"), aborted.signal), { kind: "cancel" });
});

test("terminal failures close the question and a losing failure does not replace the chosen answer", async () => {
  const events = createEventBus();
  const getRequest = capture(events);
  const broken = withQuestion({ events }, choice(), async () => { throw new Error("terminal failed"); });
  const request = getRequest();
  await assert.rejects(broken, /terminal failed/);
  assert.equal(request.signal.aborted, true);
  const terminal = deferred<QuestionAnswer>();
  const result = withQuestion({ events }, choice(), () => terminal.promise);
  getRequest().respond({ kind: "cancel" });
  terminal.reject(new Error("late failure"));
  assert.deepEqual(await result, { kind: "cancel" });
});

test("the mirror scopes answers to the current question and restores an underlying question", async () => {
  const events = createEventBus();
  let enabled = true;
  let changes = 0;
  const mirror = createDialogMirror({ events }, () => enabled, () => changes++, () => undefined);
  const first = withQuestion({ events }, choice(), (signal) => new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve({ kind: "cancel" }), { once: true });
  }));
  const previous = mirror.question;
  assert.ok(previous);
  const second = withQuestion({ events }, { kind: "text", title: "Text", multiline: true, prefill: "draft" },
    (signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ kind: "cancel" }), { once: true })));
  const current = mirror.question;
  assert.ok(current);
  assert.notEqual(current.id, previous.id);
  assert.equal(mirror.answer(previous.id, { kind: "cancel" }), "stale");
  assert.equal(mirror.answer(current.id, { kind: "choice", selected: [0], other: null }), "invalid");
  assert.equal(mirror.answer(current.id, { kind: "text", text: "!this is data\n/reload" }), "answered");
  assert.deepEqual(await second, { kind: "text", text: "!this is data\n/reload" });
  assert.equal(mirror.question?.id, previous.id);
  mirror.cancel();
  assert.deepEqual(await first, { kind: "cancel" });
  assert.equal(mirror.question, undefined);
  assert.ok(changes >= 4);
  enabled = false;
  const off = new AbortController();
  const hidden = withQuestion({ events }, choice(), (signal) => new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve({ kind: "cancel" }), { once: true });
  }), off.signal);
  assert.equal(mirror.question, undefined);
  off.abort();
  await hidden;
});

test("question and answer validation rejects malformed, oversized and mismatched data", () => {
  const question = choice();
  assert.equal(isQuestion(question), true);
  for (const changes of [{ id: "bad" }, { title: "x".repeat(8193) }, { options: [] },
    { options: Array.from({ length: 101 }, () => ({ label: "One" })) }, { multiple: 1 },
    { options: [{ label: "x".repeat(513) }] }, { options: [{ label: "One", description: "x".repeat(2049) }] },
    { options: Array.from({ length: 100 }, () => ({ label: "One", description: "x".repeat(2000) })) }]) {
    assert.equal(isQuestion({ ...question, ...changes }), false);
  }
  for (const answer of [null, {}, { kind: "unknown" }, { kind: "text", text: "😀".repeat(4097) },
    { kind: "choice", selected: [0, 0], other: null }, { kind: "choice", selected: [-1], other: null },
    { kind: "choice", selected: [1.5], other: null }, { kind: "choice", selected: [100], other: null },
    { kind: "choice", selected: ["0"], other: null }, { kind: "choice", selected: [], other: " " }]) {
    assert.equal(parseAnswer(answer), undefined);
  }
  assert.equal(acceptsAnswer(question, { kind: "choice", selected: [2], other: null }), false);
  assert.equal(acceptsAnswer(question, { kind: "choice", selected: [], other: null }), false);
  assert.equal(acceptsAnswer(question, { kind: "text", text: "not a choice" }), false);
  assert.equal(acceptsAnswer({ ...question, multiple: true, allowOther: true }, { kind: "choice", selected: [0, 1], other: "Other" }), true);
  const action = { kind: "answer", request: randomUUID(), epoch: randomUUID(), question: question.id,
    answer: { kind: "text", text: "/a/path" } };
  assert.deepEqual(parseAction(action), action);
  assert.equal(parseAction({ ...action, question: "bad" }), undefined);
  assert.equal(parseAction({ ...action, answer: { kind: "text", text: "x".repeat(16385) } }), undefined);
  const publish = { kind: "view", id: randomUUID(), keep: 0, append: [], view: {
    epoch: randomUUID(), name: "Test", project: "Test", status: "waiting", run: null, canPrompt: false, truncated: false, live: [], question,
  } } satisfies Publish;
  assert.equal(isPublish(publish), true);
  assert.equal(isPublish({ ...publish, view: { ...publish.view, status: "idle" } }), false);
});
