import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isQuestion, object } from "./protocol.ts";
import type { ChoiceQuestion, Outcome, Question, QuestionAnswer } from "./protocol.ts";
import type { DialogRequest } from "./questions.ts";

const PROMPT = "rpiv:ask-user:prompt";
const ANSWER = "rpiv:ask-user:answer";
const RESULT = "rpiv:ask-user:answer-result";
const BLOCKED = "rpiv:ask-user:blocked";

function questionnaire(value: unknown): { toolCallId: string; question: Question } | undefined {
  if (!object(value) || typeof value.toolCallId !== "string" || !value.toolCallId || value.toolCallId.length > 512 ||
      !Array.isArray(value.questions) || !value.questions.length || value.questions.length > 4) return;
  const questions: ChoiceQuestion[] = [];
  for (const item of value.questions) {
    if (!object(item) || typeof item.question !== "string" || typeof item.header !== "string" ||
        typeof item.multiSelect !== "boolean" || !Array.isArray(item.options) || item.options.length > 100) return;
    const options: ChoiceQuestion["options"] = [];
    for (const option of item.options) {
      if (!object(option) || typeof option.label !== "string" || typeof option.description !== "string") return;
      options.push({ label: option.label, description: option.description });
    }
    questions.push({ kind: "choice", title: item.question, details: item.header, options, multiple: item.multiSelect, allowOther: true });
  }
  const question: Question = { id: randomUUID(), kind: "questionnaire", title: "Questions from Pi", questions, allowNotes: true };
  if (isQuestion(question)) return { toolCallId: value.toolCallId, question };
}

export function createRpivAdapter(pi: Pick<ExtensionAPI, "events">, enabled: () => boolean,
  present: (request: DialogRequest) => boolean) {
  const open = new Map<string, AbortController>();
  function close(toolCallId: string) {
    const controller = open.get(toolCallId);
    open.delete(toolCallId);
    controller?.abort();
  }

  function submit(toolCallId: string, answer: QuestionAnswer): Outcome {
    if (!open.has(toolCallId)) return "stale";
    if (answer.kind !== "cancel" && answer.kind !== "questionnaire") return "invalid";
    const requestId = randomUUID();
    const verdict: { outcome: Outcome } = { outcome: "uncertain" };
    const unsubscribe = pi.events.on(RESULT, (value) => {
      if (!object(value) || value.requestId !== requestId || value.toolCallId !== toolCallId || typeof value.ok !== "boolean") return;
      if (value.ok) verdict.outcome = "answered";
      else if (value.code === "not_found") verdict.outcome = "stale";
      else if (value.code === "invalid_answer" || value.code === "invalid_payload") verdict.outcome = "invalid";
      else if (value.code === "unsupported_host") verdict.outcome = "waiting";
    });
    try {
      // RPIV's answer channel returns a synchronous verdict. Missing acknowledgements are never success.
      pi.events.emit(ANSWER, {
        toolCallId, requestId,
        ...(answer.kind === "cancel" ? { cancel: true } : {
          answers: answer.answers.map((entry, questionIndex) => ({
            questionIndex,
            ...(entry.selected.length && { optionIndexes: entry.selected }),
            ...(entry.other !== null && { text: entry.other }),
            ...(entry.notes?.trim() && { notes: entry.notes.trim() }),
          })),
          ...(answer.globalNote?.trim() && { globalNote: answer.globalNote.trim() }),
        }),
      });
    } finally { unsubscribe(); }
    if (verdict.outcome === "answered" || verdict.outcome === "stale" || verdict.outcome === "waiting") close(toolCallId);
    return verdict.outcome;
  }

  pi.events.on(PROMPT, (value) => {
    if (!enabled() || open.size >= 32) return;
    const parsed = questionnaire(value);
    if (!parsed || open.has(parsed.toolCallId)) return;
    const { toolCallId, question } = parsed;
    const controller = new AbortController();
    open.set(toolCallId, controller);
    if (!present({ question, signal: controller.signal, respond: (answer) => submit(toolCallId, answer) })) close(toolCallId);
  });
  pi.events.on(BLOCKED, (value) => {
    if (object(value) && value.active === false && typeof value.toolCallId === "string") close(value.toolCallId);
  });

  return {
    clear() { for (const toolCallId of [...open.keys()]) close(toolCallId); },
  };
}
