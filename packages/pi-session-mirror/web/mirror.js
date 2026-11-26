const $ = (id) => document.getElementById(id);
const picker = $("sessions");
const transcript = $("transcript");
const conversation = $("conversation");
const prompt = $("prompt");
const controls = { send: $("send"), followUp: $("queue"), stop: $("stop") };
let selected = null;
let view;
let source;
let reconnect;
let watchdog;
let retryDelay = 500;
let live = false;
let pending = false;
let pendingPair = false;
let sessions = [];
let questionKey;
let uncertainQuestion;
let readAnswer;

const scannedCode = /^#pair=([a-f0-9]{12})$/.exec(location.hash)?.[1];
if (scannedCode) {
  history.replaceState(null, "", location.pathname + location.search);
  $("code").value = scannedCode;
}

function refresh() {
  const available = live && view;
  const busy = available && view.status === "busy";
  const idle = available && view.status === "idle";
  controls.send.hidden = Boolean(busy);
  controls.followUp.hidden = !busy;
  controls.send.disabled = !idle || !view.canPrompt || pending;
  controls.followUp.disabled = !busy || !view.run || !view.canPrompt || pending;
  controls.stop.disabled = !busy || !view.run || pending;
  prompt.disabled = !available || (!idle && !busy) || !view.canPrompt || pending;
  $("question-fields").disabled = !available || !view.question || pending || uncertainQuestion === view.question.id;
  $("run-status").textContent = !selected ? "No session selected" : !available ? "Session offline" :
    view.status === "waiting" ? (view.question ? "Waiting for your answer" : "This dialog requires input in the terminal") : busy ? "Running" :
    view.canPrompt ? "Idle" : "Idle - choose a model in the terminal";
}

function clearView() {
  view = undefined;
  transcript.replaceChildren();
  $("live").replaceChildren();
  $("truncated").hidden = true;
  renderQuestion();
  refresh();
}

function setPairing(show) {
  $("pair").hidden = !show;
  $("mirror").hidden = show;
  if (show) {
    source?.close();
    source = undefined;
    clearTimeout(reconnect);
    clearTimeout(watchdog);
    live = false;
    selected = null;
    sessions = [];
    prompt.value = "";
    $("action-status").textContent = "";
    clearView();
    $("connection").textContent = "Browser not paired";
  }
}

function row({ label, text }) {
  const item = document.createElement("article");
  if (label === "You" || label === "Pi" || label === "Pi · streaming") item.className = "message";
  const title = document.createElement("h3");
  title.textContent = label;
  const body = document.createElement("pre");
  body.textContent = text;
  item.append(title, body);
  return item;
}

function answerText(parent, id, title, multiline = true, prefill = "", placeholder = "") {
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = title;
  const input = document.createElement(multiline ? "textarea" : "input");
  input.id = id;
  input.maxLength = 16384;
  input.value = prefill;
  input.placeholder = placeholder;
  if (multiline) input.rows = 3;
  parent.append(label, input);
  return input;
}

function renderAnswer(question, parent, prefix) {
  if (question.kind === "text") {
    const input = answerText(parent, `${prefix}-text`, "Your answer", question.multiline, question.prefill, question.placeholder);
    return () => ({ kind: "text", text: input.value });
  }
  const options = [...question.options];
  if (question.allowOther) options.push({ label: options.some((option) => option.label.toLowerCase() === "other") ? "Other (custom)" : "Other" });
  const inputs = options.map((option, index) => {
    const label = document.createElement("label");
    label.className = "question-option";
    const input = document.createElement("input");
    input.type = question.multiple ? "checkbox" : "radio";
    input.name = `${prefix}-choice`;
    input.value = index < question.options.length ? String(index) : "other";
    const text = document.createElement("span");
    text.textContent = option.label;
    label.append(input, text);
    if (option.description) {
      const description = document.createElement("small");
      description.textContent = option.description;
      text.append(" ", document.createElement("br"), description);
    }
    parent.append(label);
    return input;
  });
  const custom = question.allowOther ? answerText(parent, `${prefix}-other`, "Custom answer") : undefined;
  return () => {
    const checked = inputs.filter((input) => input.checked).map((input) => input.value);
    const other = checked.includes("other") ? custom.value.trim() : null;
    if (!checked.length || other === "") return;
    return { kind: "choice", selected: checked.filter((value) => value !== "other").map(Number), other };
  };
}

function renderQuestion() {
  const question = view?.question;
  const key = question ? `${view.epoch}/${question.id}` : undefined;
  $("question").hidden = !question;
  if (questionKey === key) return;
  questionKey = key;
  uncertainQuestion = undefined;
  readAnswer = undefined;
  const answers = $("question-answers");
  answers.replaceChildren();
  if (!question) return;
  $("action-status").textContent = "";
  $("question-title").textContent = question.title;
  $("question-details").textContent = question.details ?? "";
  $("submit-question").textContent = question.kind === "questionnaire" ? "Submit all answers" : "Submit answer";
  if (question.kind !== "questionnaire") {
    readAnswer = renderAnswer(question, answers, "question");
    return;
  }
  const readers = question.questions.map((item, index) => {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "questionnaire-item";
    const legend = document.createElement("legend");
    legend.textContent = `${index + 1}. ${item.title}`;
    const details = document.createElement("p");
    details.textContent = item.details ?? "";
    fieldset.append(legend, details);
    const read = renderAnswer(item, fieldset, `question-${index}`);
    const notes = question.allowNotes ? answerText(fieldset, `question-${index}-notes`, "Notes (optional)") : undefined;
    answers.append(fieldset);
    return () => {
      const answer = read();
      if (!answer) return;
      return { ...answer, ...(notes?.value.trim() && { notes: notes.value.trim() }) };
    };
  });
  const global = question.allowNotes ? answerText(answers, "question-global-note", "Note for all questions (optional)") : undefined;
  readAnswer = () => {
    const entries = readers.map((read) => read());
    if (entries.some((entry) => !entry)) return;
    return { kind: "questionnaire", answers: entries, ...(global?.value.trim() && { globalNote: global.value.trim() }) };
  };
}

function render(next, keep, append) {
  const bottom = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 64;
  const replacing = view?.epoch !== next.epoch;
  view = next;
  while (transcript.childElementCount > keep) transcript.lastElementChild.remove();
  const fragment = document.createDocumentFragment();
  for (const message of append) fragment.append(row(message));
  transcript.append(fragment);
  $("live").replaceChildren(...view.live.map(row));
  $("truncated").hidden = !view.truncated;
  renderQuestion();
  if (bottom || replacing) conversation.scrollTop = conversation.scrollHeight;
  refresh();
}

function updatePicker() {
  const status = { idle: "Idle", busy: "Running", waiting: "Waiting for input" };
  const options = sessions.map((session) => new Option(`${session.name} · ${session.project} · ${status[session.status]} · ${session.id.slice(0, 8)}`, session.id));
  if (selected && !sessions.some((session) => session.id === selected)) options.unshift(new Option("Previous session · Offline", selected));
  if (!selected) options.unshift(new Option(sessions.length ? "Choose a session" : "No live Pi sessions", ""));
  picker.replaceChildren(...options);
  picker.value = selected ?? "";
  picker.disabled = !live || options.length === 0;
}

async function reconnectAfterError(stream) {
  if (stream !== source) return;
  clearTimeout(watchdog);
  stream.close();
  live = false;
  $("connection").textContent = "Reconnecting…";
  updatePicker();
  refresh();
  try {
    const status = await fetch("/api/status", { signal: AbortSignal.timeout(4500) });
    if (stream !== source) return;
    if (status.status === 401) return setPairing(true);
  } catch { /* Stay offline until the host answers. */ }
  if (stream !== source) return;
  reconnect = setTimeout(connect, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 5000);
}

function connect() {
  clearTimeout(reconnect);
  reconnect = undefined;
  clearTimeout(watchdog);
  source?.close();
  live = false;
  refresh();
  const stream = new EventSource(selected ? `/api/events?session=${encodeURIComponent(selected)}` : "/api/events");
  source = stream;
  let failed = false;
  const onError = () => {
    if (failed) return;
    failed = true;
    void reconnectAfterError(stream);
  };
  const watch = () => {
    if (stream !== source) return;
    clearTimeout(watchdog);
    watchdog = setTimeout(onError, 45_000);
  };
  watch();
  stream.addEventListener("heartbeat", watch);
  stream.addEventListener("sessions", (event) => {
    if (stream !== source) return;
    watch();
    const restored = !live;
    live = true;
    retryDelay = 500;
    setPairing(false);
    $("connection").textContent = "Connected to host";
    sessions = JSON.parse(event.data);
    if (!selected && sessions.length === 1) return select(sessions[0].id);
    if (restored && view) clearView();
    updatePicker();
    refresh();
  });
  stream.addEventListener("snapshot", (event) => {
    if (stream !== source) return;
    const snapshot = JSON.parse(event.data);
    render(snapshot.view, 0, snapshot.rows);
  });
  stream.addEventListener("update", (event) => {
    if (stream !== source) return;
    const { view: next, keep, append } = JSON.parse(event.data);
    if (view?.epoch !== next.epoch || transcript.childElementCount < keep) return connect();
    render(next, keep, append);
  });
  stream.addEventListener("offline", () => { if (stream === source) clearView(); });
  stream.onerror = onError;
}

function select(id) {
  selected = id;
  prompt.value = "";
  $("action-status").textContent = "";
  clearView();
  connect();
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(7000),
  });
  return { status: response.status, data: await response.json() };
}

async function act(kind, answer) {
  const answering = kind === "answer";
  if (!selected || !view || (answering ? $("question-fields").disabled : controls[kind].disabled)) return;
  const actionStatus = $("action-status");
  const session = selected;
  const epoch = view.epoch;
  const text = prompt.value;
  const question = answering ? view.question.id : undefined;
  if (!answering && kind !== "stop" && (!text.trim() || /^\s*[!/]/.test(text) || new TextEncoder().encode(text).length > 16384)) {
    actionStatus.textContent = "Enter a text prompt up to 16 KiB, without slash or shell commands.";
    return;
  }
  const body = { request: crypto.randomUUID(), epoch, kind };
  if (answering) {
    body.question = question;
    body.answer = answer;
  } else {
    if (kind !== "stop") body.text = text;
    if (kind !== "send") body.run = view.run;
  }
  pending = true;
  actionStatus.textContent = "Sending…";
  refresh();
  const sameSelection = () => session === selected && (!view || (epoch === view.epoch &&
    (!answering || !view.question || view.question.id === question)));
  const uncertain = () => {
    if (!sameSelection()) return;
    if (answering) uncertainQuestion = question;
    else if (kind !== "stop") prompt.value = "";
    actionStatus.textContent = "Delivery uncertain. Check the transcript or terminal before trying again. Nothing was resent.";
  };
  try {
    const { status, data } = await post(`/api/sessions/${session}/action`, body);
    if (status === 401) return setPairing(true);
    if (!sameSelection()) return;
    if (data.outcome === "uncertain") return uncertain();
    const messages = {
      submitted: "Prompt submitted to Pi.", queued: "Follow-up submitted to Pi's queue.", stopping: "Stop requested.",
      busy: "Pi became busy. Choose Queue follow-up to send this prompt.", stale: "The session or run changed. Nothing was sent.",
      waiting: "Answer the open question first. Unsupported custom dialogs require the terminal.", "no-model": "Choose a model in the terminal.",
      answered: "Answer submitted to Pi.", invalid: "Choose a valid answer for this question.",
      limit: "The mirror rejected this action because a request limit was reached.",
    };
    if (data.outcome === "submitted" || data.outcome === "queued") prompt.value = "";
    actionStatus.textContent = messages[data.outcome] ?? data.error ?? "Action rejected.";
  } catch { uncertain(); }
  finally { pending = false; refresh(); }
}

$("question").addEventListener("submit", (event) => {
  event.preventDefault();
  const question = view?.question;
  if (!question || $("question-fields").disabled) return;
  const answer = readAnswer?.();
  if (!answer) {
    $("action-status").textContent = "Select an option or enter a custom answer for every question.";
    return;
  }
  const text = answer.kind === "questionnaire" ? JSON.stringify(answer) : answer.kind === "text" ? answer.text : answer.other ?? "";
  if (new TextEncoder().encode(text).length > 16384) {
    $("action-status").textContent = "The complete answer is limited to 16 KiB.";
    return;
  }
  void act("answer", answer);
});
$("cancel-question").addEventListener("click", () => { void act("answer", { kind: "cancel" }); });

$("pair").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (pendingPair) return;
  pendingPair = true;
  $("pair-button").disabled = true;
  try {
    const { status, data } = await post("/api/pair", { code: $("code").value });
    if (status === 200) {
      $("code").value = "";
      $("pair-status").textContent = "";
      $("connection").textContent = "Connecting…";
      connect();
    } else $("pair-status").textContent = data.error ?? "Pairing failed.";
  } catch { $("pair-status").textContent = "Pairing response was lost. Reload the page before generating another code."; }
  finally { pendingPair = false; $("pair-button").disabled = false; }
});
$("compose").addEventListener("submit", (event) => { event.preventDefault(); void act("send"); });
controls.followUp.addEventListener("click", () => { void act("followUp"); });
controls.stop.addEventListener("click", () => { void act("stop"); });
picker.addEventListener("change", () => select(picker.value || null));
connect();
