import { randomUUID } from "node:crypto";
import { ExtensionEditorComponent, type ExtensionAPI, type ExtensionContext, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { acceptsAnswer, isQuestion, object, parseAnswer } from "./protocol.ts";
import type { Outcome, Question, QuestionAnswer, QuestionSpec } from "./protocol.ts";
import { createRpivAdapter } from "./rpiv.ts";

export type { Question, QuestionAnswer, QuestionSpec } from "./protocol.ts";
export const QUESTION_EVENT = "pi:question:v1";
export type QuestionRequest = {
  question: Question;
  signal: AbortSignal;
  respond: (answer: QuestionAnswer) => void;
};

export type DialogRequest = Omit<QuestionRequest, "respond"> & { respond: (answer: QuestionAnswer) => Outcome };

// The signal closes the losing UI as well as marking the request unavailable to other renderers.
export function withQuestion(pi: Pick<ExtensionAPI, "events">, spec: QuestionSpec,
  terminal: (signal: AbortSignal) => Promise<QuestionAnswer>, signal?: AbortSignal): Promise<QuestionAnswer> {
  if (signal?.aborted) return Promise.resolve({ kind: "cancel" });
  const question = { ...spec, id: randomUUID() };
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener("abort", cancel);
      controller.abort();
    };
    const finish = (answer: QuestionAnswer) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(answer);
    };
    const cancel = () => finish({ kind: "cancel" });
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = terminal(controller.signal);
      if (!settled && isQuestion(question)) pi.events.emit(QUESTION_EVENT, {
        question, signal: controller.signal,
        respond(value) {
          const answer = parseAnswer(value);
          if (answer && acceptsAnswer(question, answer)) finish(answer);
        },
      } satisfies QuestionRequest);
      void result.then(finish, (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      });
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
    }
  });
}

type QuestionFactory = Parameters<ExtensionUIContext["custom"]>[0];

/** Give a custom terminal question a structured alternative for other UI renderers. */
export function customQuestion(pi: Pick<ExtensionAPI, "events">,
  ctx: Pick<ExtensionContext, "signal"> & { ui: Pick<ExtensionUIContext, "custom"> }, spec: QuestionSpec,
  factory: (tui: Parameters<QuestionFactory>[0], theme: Parameters<QuestionFactory>[1],
    keys: Parameters<QuestionFactory>[2], done: (answer: QuestionAnswer) => void) => ReturnType<QuestionFactory>,
  signal = ctx.signal): Promise<QuestionAnswer> {
  return withQuestion(pi, spec, (close) => ctx.ui.custom<QuestionAnswer>((tui, theme, keys, done) => {
    const cancel = () => done({ kind: "cancel" });
    if (close.aborted) {
      cancel();
      return { render: () => [], invalidate() {} };
    }
    close.addEventListener("abort", cancel, { once: true });
    return factory(tui, theme, keys, done);
  }), signal);
}

export function createDialogMirror(pi: Pick<ExtensionAPI, "events">, enabled: () => boolean, changed: () => void,
  agentSignal: () => AbortSignal | undefined) {
  const requests = new Map<string, DialogRequest>();
  const removers = new Map<string, () => void>();
  const installed = new Map<ExtensionUIContext, () => void>();
  const current = () => [...requests.values()].at(-1);
  function remove(id: string) {
    removers.get(id)?.();
    removers.delete(id);
    requests.delete(id);
    changed();
  }
  function present(request: DialogRequest) {
    const { question, signal } = request;
    if (signal.aborted || requests.size >= 32 || requests.has(question.id)) return false;
    const close = () => remove(question.id);
    requests.set(question.id, request);
    removers.set(question.id, () => signal.removeEventListener("abort", close));
    signal.addEventListener("abort", close, { once: true });
    changed();
    return true;
  }
  const rpiv = createRpivAdapter(pi, enabled, present);
  pi.events.on(QUESTION_EVENT, (value) => {
    if (!enabled() || !object(value) || !isQuestion(value.question) || !(value.signal instanceof AbortSignal) ||
        typeof value.respond !== "function") return;
    const { question, signal, respond } = value;
    present({ question, signal, respond: (answer) => { respond(answer); return "answered"; } });
  });

  function install(ui: ExtensionUIContext) {
    if (installed.has(ui)) return;
    const original = { select: ui.select, confirm: ui.confirm, input: ui.input, editor: ui.editor };
    const combine = (signal?: AbortSignal) => {
      const signals = [signal, agentSignal()].filter((value): value is AbortSignal => value !== undefined);
      return signals.length ? AbortSignal.any(signals) : undefined;
    };
    const canMirror = (opts?: object) => enabled() && !(opts && "blockedKind" in opts && opts.blockedKind === "auth");
    const wrapped: typeof original = {
      async select(title, options, opts) {
        if (!canMirror(opts)) return original.select(title, options, opts);
        const answer = await withQuestion(pi, { kind: "choice", title, options: options.map((label) => ({ label })), multiple: false, allowOther: false },
          async (signal) => {
            const value = await original.select(title, options, { ...opts, signal });
            return value === undefined ? { kind: "cancel" } : { kind: "choice", selected: [options.indexOf(value)], other: null };
          }, combine(opts?.signal));
        return answer.kind === "choice" ? options[answer.selected[0]] : undefined;
      },
      async confirm(title, message, opts) {
        if (!canMirror(opts)) return original.confirm(title, message, opts);
        const answer = await withQuestion(pi, { kind: "choice", title, details: message, options: [{ label: "Yes" }, { label: "No" }], multiple: false, allowOther: false },
          async (signal) => ({ kind: "choice", selected: [await original.confirm(title, message, { ...opts, signal }) ? 0 : 1], other: null }), combine(opts?.signal));
        return answer.kind === "choice" && answer.selected[0] === 0;
      },
      async input(title, placeholder, opts) {
        if (!canMirror(opts)) return original.input(title, placeholder, opts);
        const answer = await withQuestion(pi, { kind: "text", title, multiline: false, placeholder }, async (signal) => {
          const value = await original.input(title, placeholder, { ...opts, signal });
          return value === undefined ? { kind: "cancel" } : { kind: "text", text: value };
        }, combine(opts?.signal));
        return answer.kind === "text" ? answer.text : undefined;
      },
      async editor(title, prefill) {
        if (!canMirror()) return original.editor(title, prefill);
        // editor() has no abort option. Use Pi's exported editor in a closable custom dialog.
        const answer = await customQuestion(pi, { ui, signal: agentSignal() },
          { kind: "text", title, multiline: true, prefill }, (tui, _theme, keys, done) =>
            new ExtensionEditorComponent(tui, keys, title, prefill, (text) => done({ kind: "text", text }), () => done({ kind: "cancel" })));
        return answer.kind === "text" ? answer.text : undefined;
      },
    };
    Object.assign(ui, wrapped);
    installed.set(ui, () => {
      for (const key of ["select", "confirm", "input", "editor"] as const) {
        if (ui[key] === wrapped[key]) Object.assign(ui, { [key]: original[key] });
      }
    });
  }

  function cancel() {
    for (const request of [...requests.values()].reverse()) {
      remove(request.question.id);
      try { request.respond({ kind: "cancel" }); } catch { /* An extension must not prevent the remaining dialogs from closing. */ }
    }
    rpiv.clear();
  }

  return {
    install,
    cancel,
    get question() { return current()?.question; },
    answer(id: string, answer: QuestionAnswer): Outcome {
      const request = current();
      if (!request || request.question.id !== id || request.signal.aborted) return "stale";
      if (!acceptsAnswer(request.question, answer)) return "invalid";
      const outcome = request.respond(answer);
      if (outcome === "answered" || outcome === "stale" || outcome === "waiting") remove(id);
      return outcome;
    },
    reset() {
      cancel();
      for (const restore of installed.values()) restore();
      installed.clear();
    },
  };
}
