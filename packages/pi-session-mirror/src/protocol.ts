import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

export const PORT = 47321;
// Bump when wire shapes or bundled browser behavior require a host restart.
export const HOST_PROTOCOL = 1;
export const PROMPT_BYTES = 16_384;
export const MAX_ROWS = 300;
export const MAX_LIVE = 32;
export const ROW_CHARS = 8192;
const MAX_FRAME = 18 * 1024 * 1024; // A bounded transcript, including worst-case JSON escaping.

export type ChoiceQuestion = {
  kind: "choice"; title: string; details?: string;
  options: { label: string; description?: string }[]; multiple: boolean; allowOther: boolean;
};
export type QuestionSpec = { title: string; details?: string } & (
  | { kind: "text"; multiline: boolean; prefill?: string; placeholder?: string }
  | Omit<ChoiceQuestion, "title" | "details">
  | { kind: "questionnaire"; questions: ChoiceQuestion[]; allowNotes: boolean }
);
export type Question = QuestionSpec & { id: string };
export type ChoiceAnswer = { kind: "choice"; selected: number[]; other: string | null };
export type QuestionAnswer =
  | { kind: "cancel" }
  | { kind: "text"; text: string }
  | ChoiceAnswer
  | { kind: "questionnaire"; answers: (ChoiceAnswer & { notes?: string })[]; globalNote?: string };
export type Row = { id: string; label: string; text: string };
export type View = {
  epoch: string;
  name: string;
  project: string;
  status: "idle" | "busy" | "waiting";
  run: string | null;
  canPrompt: boolean;
  truncated: boolean;
  live: Row[];
  question?: Question;
};
export type Publish = { kind: "view"; id: string; view: View; keep: number; append: Row[] };
export type Snapshot = { view: View; rows: Row[] };
export type Action = { request: string; epoch: string } & (
  | { kind: "send"; text: string }
  | { kind: "followUp"; text: string; run: string }
  | { kind: "stop"; run: string }
  | { kind: "answer"; question: string; answer: QuestionAnswer }
);
export type Outcome = "submitted" | "queued" | "stopping" | "stale" | "busy" | "waiting" | "no-model" | "limit" | "uncertain" | "answered" | "invalid";

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function id(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
}

export function parseAction(value: unknown): Action | undefined {
  if (!object(value) || !id(value.request) || !id(value.epoch)) return;
  const { request, epoch, kind, run, text } = value;
  if (kind === "answer" && id(value.question)) {
    const answer = parseAnswer(value.answer);
    if (answer) return { kind, request, epoch, question: value.question, answer };
    return;
  }
  if (kind === "stop" && id(run)) return { kind, request, epoch, run };
  if (typeof text !== "string" || !text.trim() || /^[\s]*[!/]/.test(text) || Buffer.byteLength(text) > PROMPT_BYTES) return;
  if (kind === "send") return { kind, request, epoch, text };
  if (kind === "followUp" && id(run)) return { kind, request, epoch, run, text };
}

export function isQuestion(value: unknown): value is Question {
  if (!object(value) || !id(value.id) || typeof value.title !== "string" || value.title.length > ROW_CHARS ||
      (value.details !== undefined && (typeof value.details !== "string" || value.details.length > ROW_CHARS))) return false;
  if (value.kind === "text") return typeof value.multiline === "boolean" &&
    (value.prefill === undefined || (typeof value.prefill === "string" && Buffer.byteLength(value.prefill) <= PROMPT_BYTES)) &&
    (value.placeholder === undefined || (typeof value.placeholder === "string" && value.placeholder.length <= ROW_CHARS));
  if (value.kind === "questionnaire") return typeof value.allowNotes === "boolean" &&
    Array.isArray(value.questions) && value.questions.length > 0 && value.questions.length <= 4 &&
    value.questions.every((question) => object(question) && question.kind === "choice" && isQuestion({ ...question, id: value.id })) &&
    Buffer.byteLength(JSON.stringify(value)) <= 65_536;
  return value.kind === "choice" && typeof value.multiple === "boolean" && typeof value.allowOther === "boolean" &&
    Array.isArray(value.options) && value.options.length > 0 && value.options.length <= 100 && value.options.every((option) =>
      object(option) && typeof option.label === "string" && option.label.length <= 512 &&
      (option.description === undefined || (typeof option.description === "string" && option.description.length <= 2048))) &&
    Buffer.byteLength(JSON.stringify(value)) <= 65_536;
}

export function parseAnswer(value: unknown): QuestionAnswer | undefined {
  if (!object(value)) return;
  if (value.kind === "cancel") return { kind: "cancel" };
  if (value.kind === "text" && typeof value.text === "string" && Buffer.byteLength(value.text) <= PROMPT_BYTES) {
    return { kind: "text", text: value.text };
  }
  if (value.kind === "questionnaire" && Array.isArray(value.answers) && value.answers.length > 0 && value.answers.length <= 4 &&
      (value.globalNote === undefined || typeof value.globalNote === "string") && Buffer.byteLength(JSON.stringify(value)) <= PROMPT_BYTES) {
    const answers: (ChoiceAnswer & { notes?: string })[] = [];
    for (const entry of value.answers) {
      if (!object(entry) || entry.kind !== "choice" || (entry.notes !== undefined && typeof entry.notes !== "string")) return;
      const answer = parseAnswer(entry);
      if (answer?.kind !== "choice") return;
      answers.push({ ...answer, ...(typeof entry.notes === "string" && { notes: entry.notes }) });
    }
    return { kind: "questionnaire", answers, ...(typeof value.globalNote === "string" && { globalNote: value.globalNote }) };
  }
  if (value.kind === "choice" && Array.isArray(value.selected) && value.selected.length <= 100 &&
      value.selected.every((index) => Number.isInteger(index) && index >= 0 && index < 100) &&
      new Set(value.selected).size === value.selected.length &&
      (value.other === null || (typeof value.other === "string" && Boolean(value.other.trim()) && Buffer.byteLength(value.other) <= PROMPT_BYTES))) {
    return { kind: "choice", selected: value.selected, other: value.other };
  }
}

export function acceptsAnswer(question: Question, answer: QuestionAnswer): boolean {
  if (answer.kind === "cancel") return true;
  if (question.kind === "text") return answer.kind === "text";
  if (question.kind === "questionnaire") return answer.kind === "questionnaire" && answer.answers.length === question.questions.length &&
    (question.allowNotes || (answer.globalNote === undefined && answer.answers.every((entry) => entry.notes === undefined))) &&
    question.questions.every((entry, index) => acceptsAnswer({ ...entry, id: question.id }, answer.answers[index]));
  if (answer.kind !== "choice" || answer.selected.some((index) => index >= question.options.length) ||
      (answer.other !== null && !question.allowOther)) return false;
  const count = answer.selected.length + Number(answer.other !== null);
  return count > 0 && (question.multiple || count === 1);
}

function row(value: unknown): value is Row {
  return object(value) && typeof value.id === "string" && value.id.length <= 512 &&
    typeof value.label === "string" && value.label.length <= 256 &&
    typeof value.text === "string" && value.text.length <= ROW_CHARS;
}

export function isPublish(value: unknown): value is Publish {
  if (!object(value) || value.kind !== "view" || !id(value.id) || typeof value.keep !== "number" ||
      !Number.isInteger(value.keep) || value.keep < 0 || !Array.isArray(value.append) ||
      value.keep + value.append.length > MAX_ROWS || !value.append.every(row) || !object(value.view)) return false;
  const v = value.view;
  return id(v.epoch) && typeof v.name === "string" && v.name.length <= 256 && typeof v.project === "string" &&
    v.project.length <= 4096 && (v.status === "idle" || v.status === "busy" || v.status === "waiting") &&
    (v.run === null || id(v.run)) && typeof v.canPrompt === "boolean" && typeof v.truncated === "boolean" &&
    Array.isArray(v.live) && v.live.length <= MAX_LIVE && v.live.every(row) &&
    (v.question === undefined || (v.status === "waiting" && isQuestion(v.question)));
}

export function isOutcome(value: unknown): value is Outcome {
  return value === "submitted" || value === "queued" || value === "stopping" || value === "stale" || value === "busy" ||
    value === "waiting" || value === "no-model" || value === "limit" || value === "uncertain" || value === "answered" || value === "invalid";
}

export function privateDir(create = false): string {
  if (!process.geteuid) throw new Error("Pi Session Mirror requires a Unix host.");
  const path = join(homedir(), ".pi-session-mirror");
  if (create) {
    try { mkdirSync(path, { mode: 0o700 }); } catch (error) {
      if (!object(error) || error.code !== "EEXIST") throw error;
    }
  }
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat || !stat.isDirectory() || stat.uid !== process.geteuid() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${path} must be a private directory owned by your user (mode 0700).`);
  }
  return path;
}

export function socketPath(dir: string): string {
  const path = join(dir, "host.sock");
  if (Buffer.byteLength(path) >= 104) throw new Error("Pi Session Mirror socket path is too long.");
  return path;
}

export function projectMarker(dir: string, cwd: string): string {
  return join(dir, `project-${createHash("sha256").update(realpathSync(cwd)).digest("hex")}`);
}

export function connectLocal(): Socket {
  return createConnection(socketPath(privateDir()));
}

export function wire(socket: Socket, receive: (value: unknown) => void) {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("error", () => socket.destroy());
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let end: number;
    while (!socket.destroyed && (end = buffer.indexOf("\n")) !== -1) {
      if (end > MAX_FRAME) return socket.destroy();
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try { receive(JSON.parse(line)); } catch { return socket.destroy(); }
    }
    if (buffer.length > MAX_FRAME) socket.destroy();
  });
  return (value: object) => {
    if (socket.destroyed) return false;
    const data = JSON.stringify(value) + "\n";
    if (data.length > MAX_FRAME || socket.writableLength > MAX_FRAME) {
      socket.destroy();
      return false;
    }
    socket.write(data);
    return true;
  };
}
