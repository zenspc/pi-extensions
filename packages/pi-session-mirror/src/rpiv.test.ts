import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { createDialogMirror } from "./questions.ts";
import { acceptsAnswer, isPublish, object, parseAction, parseAnswer } from "./protocol.ts";
import type { QuestionAnswer } from "./protocol.ts";
import { randomUUID } from "node:crypto";

const promptEvent = "rpiv:ask-user:prompt";
const answerEvent = "rpiv:ask-user:answer";
const resultEvent = "rpiv:ask-user:answer-result";
const blockedEvent = "rpiv:ask-user:blocked";

function prompt(toolCallId = "call_rpiv_123") {
  return { toolCallId, questions: [
    { question: "Which route?", header: "Route", multiSelect: false,
      options: [{ label: "Direct", description: "Fewer stops", hasPreview: false }, { label: "Scenic", description: "More views", hasPreview: true }] },
    { question: "Which tests?", header: "Testing", multiSelect: true,
      options: [{ label: "Unit", description: "Fast", hasPreview: false }, { label: "Integration", description: "End to end", hasPreview: false }] },
  ] };
}

function answer() {
  return { kind: "questionnaire", answers: [
    { kind: "choice", selected: [1], other: null, notes: " route note " },
    { kind: "choice", selected: [0, 1], other: "Also manual tests" },
  ], globalNote: " global note " } satisfies QuestionAnswer;
}

function setup() {
  const events = createEventBus();
  const mirror = createDialogMirror({ events }, () => true, () => {}, () => undefined);
  return { events, mirror };
}

function verdict(events: ReturnType<typeof createEventBus>, payload: unknown, fields = {}) {
  assert.ok(object(payload));
  events.emit(resultEvent, { toolCallId: payload.toolCallId, requestId: payload.requestId, ok: true, ...fields });
}

test("RPIV prompts appear as one questionnaire without modifying the RPIV extension", () => {
  const events = createEventBus();
  const mirror = createDialogMirror({ events }, () => true, () => {}, () => undefined);
  events.emit(promptEvent, prompt());
  assert.ok(mirror.question, "RPIV options must appear in the mirror");
  assert.equal(mirror.question.kind, "questionnaire");
  assert.ok(mirror.question.kind === "questionnaire");
  assert.equal(mirror.question.questions.length, 2);
  assert.equal(mirror.question.questions[0].title, "Which route?");
  assert.equal(mirror.question.questions[0].details, "Route");
  assert.deepEqual(mirror.question.questions[1].options, [{ label: "Unit", description: "Fast" }, { label: "Integration", description: "End to end" }]);
  mirror.reset();
});

test("RPIV receives all answers and notes atomically, correlated by request and tool call", () => {
  const { events, mirror } = setup();
  const attempts: unknown[] = [];
  events.on(answerEvent, (payload) => {
    attempts.push(payload);
    verdict(events, payload);
  });
  events.emit(promptEvent, prompt());
  const question = mirror.question;
  assert.ok(question);
  assert.equal(mirror.answer(question.id, { kind: "choice", selected: [0], other: null }), "invalid");
  assert.equal(mirror.answer(question.id, { kind: "questionnaire", answers: [answer().answers[0]] }), "invalid");
  assert.equal(attempts.length, 0, "incomplete answers never reach RPIV");
  assert.equal(mirror.answer(question.id, answer()), "answered");
  assert.equal(attempts.length, 1);
  const payload = attempts[0];
  assert.ok(object(payload));
  assert.equal(payload.toolCallId, prompt().toolCallId);
  assert.equal(typeof payload.requestId, "string");
  assert.deepEqual(payload.answers, [
    { questionIndex: 0, optionIndexes: [1], notes: "route note" },
    { questionIndex: 1, optionIndexes: [0, 1], text: "Also manual tests" },
  ]);
  assert.equal(payload.globalNote, "global note");
  assert.equal(mirror.question, undefined);
  assert.equal(mirror.answer(question.id, answer()), "stale");
  assert.equal(attempts.length, 1);
});

test("rejected RPIV answers stay open, and unrelated or missing acknowledgements are uncertain", () => {
  const { events, mirror } = setup();
  events.emit(promptEvent, prompt());
  const question = mirror.question;
  assert.ok(question);
  const off = events.on(answerEvent, (payload) => verdict(events, payload, { ok: false, code: "invalid_answer" }));
  assert.equal(mirror.answer(question.id, answer()), "invalid");
  assert.equal(mirror.question?.id, question.id);
  off();
  const wrong = events.on(answerEvent, (payload) => {
    verdict(events, payload, { requestId: "wrong" });
    verdict(events, payload, { toolCallId: "wrong" });
  });
  assert.equal(mirror.answer(question.id, answer()), "uncertain");
  assert.equal(mirror.question?.id, question.id);
  wrong();
  assert.equal(mirror.answer(question.id, answer()), "uncertain");
  const accept = events.on(answerEvent, (payload) => verdict(events, payload));
  assert.equal(mirror.answer(question.id, answer()), "answered");
  accept();
});

test("RPIV not-found and unsupported-host verdicts clear the remote question", () => {
  for (const code of ["not_found", "unsupported_host"]) {
    const { events, mirror } = setup();
    events.on(answerEvent, (payload) => verdict(events, payload, { ok: false, code }));
    events.emit(promptEvent, prompt());
    const question = mirror.question;
    assert.ok(question);
    assert.equal(mirror.answer(question.id, answer()), code === "not_found" ? "stale" : "waiting");
    assert.equal(mirror.question, undefined);
  }
});

test("terminal completion closes only its matching RPIV questionnaire and cancel targets the active one", () => {
  const { events, mirror } = setup();
  const attempts: unknown[] = [];
  events.on(answerEvent, (payload) => { attempts.push(payload); verdict(events, payload); });
  events.emit(promptEvent, prompt("first"));
  const first = mirror.question;
  assert.ok(first);
  events.emit(promptEvent, prompt("first"));
  assert.equal(mirror.question?.id, first.id, "duplicate prompts must not reset browser drafts");
  events.emit(promptEvent, prompt("second"));
  const second = mirror.question;
  assert.ok(second);
  assert.notEqual(first.id, second.id);
  assert.equal(mirror.answer(first.id, answer()), "stale");
  events.emit(blockedEvent, { toolCallId: "first", active: false });
  assert.equal(mirror.question?.id, second.id);
  events.emit(blockedEvent, { toolCallId: "unrelated", active: false });
  assert.equal(mirror.question?.id, second.id);
  assert.equal(mirror.answer(second.id, { kind: "cancel" }), "answered");
  assert.equal(mirror.question, undefined);
  assert.equal(attempts.length, 1);
  assert.ok(object(attempts[0]));
  assert.equal(attempts[0].toolCallId, "second");
  assert.equal(attempts[0].cancel, true);
  assert.equal(attempts[0].answers, undefined);
});

test("session reset cancels each RPIV questionnaire and clears ones with no acknowledgement", () => {
  const { events, mirror } = setup();
  const cancelled: unknown[] = [];
  events.on(answerEvent, (payload) => { cancelled.push(payload); });
  events.emit(promptEvent, prompt("first"));
  events.emit(promptEvent, prompt("second"));
  mirror.reset();
  assert.equal(mirror.question, undefined);
  assert.equal(cancelled.length, 2);
  for (const payload of cancelled) {
    assert.ok(object(payload));
    assert.equal(payload.cancel, true);
  }
  events.emit(promptEvent, prompt("first"));
  assert.ok(mirror.question, "reset releases tool-call registrations");
  mirror.reset();
});

test("disabled mirroring, old event payloads and malformed RPIV prompts remain terminal-only", () => {
  const events = createEventBus();
  let enabled = false;
  const mirror = createDialogMirror({ events }, () => enabled, () => {}, () => undefined);
  events.emit(promptEvent, prompt());
  assert.equal(mirror.question, undefined);
  enabled = true;
  for (const value of [null, {}, { questions: prompt().questions }, { ...prompt(), toolCallId: "" },
    { ...prompt(), questions: [] }, { ...prompt(), questions: Array(5).fill(prompt().questions[0]) },
    { ...prompt(), questions: [{ ...prompt().questions[0], question: 123 }] },
    { ...prompt(), questions: [{ ...prompt().questions[0], options: [{ label: "One", description: 123 }] }] }]) {
    events.emit(promptEvent, value);
    assert.equal(mirror.question, undefined);
  }
});

test("questionnaire transport validates complete answers, note types and aggregate size", () => {
  const { events, mirror } = setup();
  events.emit(promptEvent, prompt());
  const question = mirror.question;
  assert.ok(question);
  const response = answer();
  assert.deepEqual(parseAnswer(response), response);
  assert.equal(acceptsAnswer(question, response), true);
  assert.equal(acceptsAnswer(question, { ...response, answers: [{ ...response.answers[0], selected: [0, 1] }, response.answers[1]] }), false);
  assert.equal(parseAnswer({ ...response, globalNote: 123 }), undefined);
  assert.equal(parseAnswer({ ...response, answers: [{ ...response.answers[0], notes: 123 }] }), undefined);
  assert.equal(parseAnswer({ ...response, globalNote: "x".repeat(16384) }), undefined);
  assert.equal(parseAnswer({ ...response, answers: Array(5).fill(response.answers[0]) }), undefined);
  const action = { kind: "answer", request: randomUUID(), epoch: randomUUID(), question: question.id, answer: response };
  assert.deepEqual(parseAction(action), action);
  assert.equal(isPublish({ kind: "view", id: randomUUID(), keep: 0, append: [], view: {
    epoch: randomUUID(), name: "Test", project: "Test", status: "waiting", run: null, canPrompt: true, truncated: false, live: [], question,
  } }), true);
  mirror.reset();
});
