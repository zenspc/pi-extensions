# Pi Session Mirror

View and control a running Pi terminal from your phone or another computer.
See the active conversation, streamed replies, and text tool results.
Send a prompt, queue a follow-up, stop the current run, or answer a question without closing Pi.

## Connect a device

You need Pi 1.4 or newer and Node.js 22.19 or newer on a Linux or macOS host.
Both devices need Tailscale, and the other device needs a browser.

From this checkout, install the package and start Pi in the project you want to share:

```sh
pnpm install --frozen-lockfile
pi install "$(pwd -P)/packages/pi-session-mirror"
```

1. Connect both devices to Tailscale and run `/mirror` in Pi.
2. Confirm that Pi may share this project.
   This opts in the exact working directory, not its subdirectories.
   Pi finds the host name and offers to set up a private [Serve](https://tailscale.com/docs/features/tailscale-serve) route on TCP port 8443.
   Check your [Tailscale access policy](https://tailscale.com/docs/features/access-control) first: only your account or devices should have access to that port.
   Pi keeps existing routes and does not edit your access policy.
   Tailscale may require a one-time HTTPS or operator approval; Pi shows the manual command if it cannot finish setup.
3. Scan the QR code in your terminal and select **Pair** in the browser.
   If you cannot scan the QR code, open the displayed address and type the code instead.
   Each code is single-use and expires after two minutes.

Pi remembers the Tailscale address.
Run `/mirror` or `/mirror pair` when you want to connect another browser.

## Daily use

Select a session by its name, project, and status.
If two sessions look the same, run `/mirror status` in the terminal to find the matching short ID.

**Send prompt** starts work when Pi is idle.
**Queue follow-up** asks Pi to run the prompt after its current work finishes.
**Stop run** requests an abort for the run shown in the browser, without stopping Pi or the host.
Standard Pi selection, confirmation, input, and editor dialogs appear in the browser automatically, regardless of the tool's name.
Answer in the browser or terminal; the first answer closes the question in both places.
[RPIV ask-user-question](#rpiv-ask-user-question) works automatically through its existing event interface.
Other custom question UIs can support the browser through the [question interface](#custom-question-extensions).
Unsupported custom dialogs and dialogs marked as authentication prompts remain terminal-only.

Closing the tab or losing the network does not stop Pi.
On reconnect, the browser loads a fresh snapshot, including the current reply and tool output.
If a submission is marked uncertain, look at the transcript or terminal before trying again.
The browser never resends an action automatically.

Type `/mirror` followed by a space to see the subcommands.

| Command | Effect |
|---|---|
| `/mirror enable` / `/mirror disable` | Start or stop sharing the current working directory. |
| `/mirror pair` | Create a pairing QR code. |
| `/mirror status` | Show the configured address, live session count, and this session's ID. |
| `/mirror revoke` | Disconnect all paired browsers and invalidate unused codes. |
| `/mirror stop-server` | Stop the host and turn off its dedicated Tailscale Serve route without closing Pi sessions. |
| `/mirror start` | Start only the host using its saved address. |
| `/mirror start <tailscale-https-url>` | Set a custom Tailscale HTTPS address for an existing Serve route. |

After a host restart, live Pi processes reconnect automatically.
Browser credentials expire after 12 hours or on host restart, so pair again when needed.
The mirror checks the running host's protocol before setup, pairing, and status requests so an incompatible host cannot be silently reused.
After upgrading, run `/mirror stop-server`, then `/reload`, then `/mirror`, and pair the browser again.
Reload the browser page as well: the background host and open tabs can otherwise keep older code even after Pi's extension is updated.
If ask-user questions disappear or the session goes blank only while a questionnaire is open, follow the same restart steps.
`/mirror stop-server` can also remove the saved Tailscale Serve route if the host is already stopped.
It leaves shared or repurposed Serve routes unchanged.
To turn Serve back on, run `/mirror`.
Do not use Funnel, public port forwarding, or a public relay.

## Security and limits

Pair only browsers you control.
A paired browser can see and prompt **all** opted-in sessions on this host and uses their existing Pi tool permissions.
Keep sensitive sessions disabled or use a restricted tool set when you only need read-only tools.

The mirror host binds to `127.0.0.1:47321` and uses a private Unix socket to reach Pi processes.
Its private `~/.pi-session-mirror/` directory stores the connection address and project opt-in markers, not transcripts or browser credentials.
Browser access requires pairing, and changing the Tailscale address revokes existing browser access.
The mirror does not log prompt bodies or change Pi's own session storage.

The browser shows up to 300 recent text entries on the active branch and marks long entries that it truncates.
It does not show images, thinking, terminal emulation, or arbitrary custom dialogs.
Paired browsers can answer mirrored confirmations, including permission questions, with the same authority as the terminal user.
Do not pair browsers that should not have that authority.
Prompts and question answers are limited to 16 KiB.
Question options are limited to 100 choices; oversized standard dialogs remain terminal-only rather than truncating their choices.
Slash commands, direct shell commands, attachments, and saved-session browsing are not supported.

## RPIV ask-user-question

[`@juicesharp/rpiv-ask-user-question`](https://pi.dev/packages/@juicesharp/rpiv-ask-user-question) is supported without modifying it or installing another mirror dependency.
Install that extension separately if you want its `ask_user_question` tool.
The adapter was verified against its published version 2.15.0.

When RPIV opens a questionnaire, the browser shows all its questions in one form.
Choose single or multiple options, select **Other** to write a custom answer, and optionally add notes to each question or the whole questionnaire.
Use **Submit all answers** to send one complete, atomic answer; incomplete forms are not submitted.
**Cancel question** cancels the entire questionnaire.
Answering in the terminal closes the matching browser form, and answering in the browser closes the terminal questionnaire.
Concurrent questionnaires are tracked separately; the newest open one is shown first.

The adapter uses RPIV's documented `rpiv:ask-user:prompt`, `answer`, `answer-result`, and `blocked` events.
It only reports success after RPIV acknowledges acceptance.
Older releases without that answer channel cannot be answered through this adapter; a missing acknowledgement is reported as uncertain, never retried automatically.
RPIV previews remain terminal-only because the prompt event exposes only whether a preview exists, not its content.
The complete browser answer, including notes and JSON structure, is limited to 16 KiB.

## Custom question extensions

The mirror does not inspect tool names, decode terminal output, or inject keyboard input.
Extensions using `ctx.ui.select()`, `confirm()`, `input()`, or `editor()` need no integration.
Extensions using `ctx.ui.custom()` must provide structured question data and a way to close their terminal UI.
Unless an adapter already supports their event interface, existing custom ask-user extensions must adopt this interface to gain browser support.

### Helper for custom terminal UIs

Import `customQuestion` from `@zenspc/pi-session-mirror/questions` and use it instead of `ctx.ui.custom()` for questions.
It works without an active mirror and returns a structured answer from either UI.
Keep the extension's existing tool name, parameter schema, option values, and result format.
Map the returned zero-based option indices back to those values.

```ts
import { customQuestion } from "@zenspc/pi-session-mirror/questions";

const answer = await customQuestion(pi, ctx, {
  kind: "choice",
  title: "Which route?",
  details: "Choose one route to continue.",
  options: [{ label: "Direct", description: "Fewer stops" }, { label: "Scenic" }],
  multiple: false,
  allowOther: false,
}, (_tui, _theme, keys, done) => {
  let selected = 0;
  return {
    render: () => ["Which route?", `${selected === 0 ? ">" : " "} Direct`, `${selected === 1 ? ">" : " "} Scenic`],
    handleInput(data) {
      if (keys.matches(data, "tui.select.up")) selected = 0;
      if (keys.matches(data, "tui.select.down")) selected = 1;
      if (keys.matches(data, "tui.select.confirm")) done({ kind: "choice", selected: [selected], other: null });
      if (keys.matches(data, "tui.select.cancel")) done({ kind: "cancel" });
    },
    invalidate() {},
  };
});
```

Use `multiple: true` for checkboxes and `allowOther: true` to offer a custom answer in the browser.
The extension's terminal UI should offer the same capabilities.
For text questions, use `{ kind: "text", title, multiline: true, prefill: "" }` and return `{ kind: "text", text }` from the terminal callback.
Pass an abort signal as the final argument to cancel the question; the default is `ctx.signal`.
Do not wrap a standard dialog in this helper, since standard dialogs are already mirrored.

### Interface without a package dependency

This is an extension event-bus convention, not an upstream Pi API.
An extension may implement it directly instead of importing the helper.
Emit `pi:question:v1` with a `QuestionRequest`:

```ts
type QuestionRequest = {
  question: QuestionSpec & { id: string }; // Fresh crypto.randomUUID() for each question.
  signal: AbortSignal; // Abort when the terminal answers, cancels, times out, or closes.
  respond(answer: QuestionAnswer): void; // Accept once and close the terminal UI.
};

type ChoiceQuestion = {
  kind: "choice"; title: string; details?: string;
  options: { label: string; description?: string }[]; multiple: boolean; allowOther: boolean;
};

type QuestionSpec = { title: string; details?: string } & (
  | { kind: "text"; multiline: boolean; prefill?: string; placeholder?: string }
  | Omit<ChoiceQuestion, "title" | "details">
  | { kind: "questionnaire"; questions: ChoiceQuestion[]; allowNotes: boolean }
);

type ChoiceAnswer = { kind: "choice"; selected: number[]; other: string | null };
type QuestionAnswer =
  | { kind: "cancel" }
  | { kind: "text"; text: string }
  | ChoiceAnswer
  | { kind: "questionnaire"; answers: (ChoiceAnswer & { notes?: string })[]; globalNote?: string };
```

Emit only after the terminal answer callback is ready.
The first answer must synchronously mark the request closed and abort its signal before returning.
The mirror validates browser answers against the current question and rejects expired IDs, out-of-range selections, and unsupported answer types.
It preserves the question across network reconnects, but never retries an uncertain answer automatically.
Titles and details are limited to 8,192 characters each.
Option labels are limited to 512 characters and descriptions to 2,048 characters; the complete choice question or questionnaire must fit within 64 KiB of JSON.
A questionnaire contains one to four choice questions, and its answer array follows the same question order.

## Checks

Run `pnpm --filter @zenspc/pi-session-mirror check` and `pnpm --filter @zenspc/pi-session-mirror test` from the checkout.
For a device test, pair a phone through Tailscale, then switch between Wi-Fi and cellular.
Check that live sessions remain visible, and that prompts, follow-ups, and stops only affect the selected session.
Drop and restore connectivity mid-reply, restart the mirror host, and use `/mirror revoke` to verify that all browsers are disconnected.
An unpaired browser must not be able to see or control sessions.
