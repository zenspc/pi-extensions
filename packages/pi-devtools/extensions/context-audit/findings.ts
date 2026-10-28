/** Turns measurements into plain statements with the lever that fixes each one. */
import type { Report } from "./report.ts";
import { PI_ORIGIN } from "./setup.ts";
import { fmtPercent, fmtTokens, sum } from "./units.ts";

export interface Finding {
	level: "warn" | "info";
	text: string;
	/** What to change; omitted when the finding is only an observation. */
	lever?: string;
}

type Measured = Omit<Report, "findings">;

const SKILLS_WARN_TOKENS = 2000;
const TOOLS_WARN_TOKENS = 4000;
const HEAVY_TOOL_TOKENS = 1500;
const CONTEXT_FILES_WARN_TOKENS = 2000;
const SOURCE_SHARE_WARN = 0.2;
const SOURCE_MIN_TOKENS = 1500;
const SETUP_SHARE_WARN = 0.25;
const BIGGEST_BLOCK_SHARE_WARN = 0.05;
const WINDOW_PRESSURE = 0.7;
const DOMINANT_TOOL_SHARE = 0.4;
const THINKING_SHARE_WARN = 0.2;
const INJECTED_SHARE_INFO = 0.05;
const SIGNATURE_INFO_CHARS = 50_000;

const names = (labels: readonly string[]) => labels.map((l) => `\`${l}\``).join(", ");

export function deriveFindings(report: Measured): Finding[] {
	const findings: Finding[] = [];
	const { contextWindow: window, setup, rates } = report;
	const setupTokens = (chars: number) => chars * rates.setup;
	const conversationTokens = (chars: number) => chars * rates.conversation;
	const fixed = setupTokens(report.setupChars);
	const used = report.measuredTokens ?? report.totalTokens;

	if (window && used / window >= WINDOW_PRESSURE) {
		findings.push({
			level: "warn",
			text: `Context is ${fmtPercent(used, window)} full (${fmtTokens(used)} of ${fmtTokens(window)}).`,
			lever: "Run /compact, or start a new session for unrelated work.",
		});
	}
	if (window && fixed / window >= SETUP_SHARE_WARN) {
		findings.push({
			level: "warn",
			text: `Fixed overhead alone is ${fmtPercent(fixed, window)} of the window (${fmtTokens(fixed)}) before you type anything.`,
		});
	}

	const skills = setup.filter((i) => i.kind === "skill");
	const skillTokens = setupTokens(sum(skills, (i) => i.chars));
	if (skillTokens >= SKILLS_WARN_TOKENS) {
		findings.push({
			level: "warn",
			text: `${skills.length} skills cost ${fmtTokens(skillTokens)} on every request. Largest: ${names(skills.slice(0, 3).map((s) => s.label))}.`,
			lever: "Disable skills you rarely use: settings.json `skills` / `packages[].skills` entries like `-skills/<name>/SKILL.md`, or `disable-model-invocation: true` in SKILL.md.",
		});
	}

	const tools = setup.filter((i) => i.kind === "tool");
	const toolTokens = setupTokens(sum(tools, (i) => i.chars));
	const heavy = tools.filter((t) => setupTokens(t.chars) >= HEAVY_TOOL_TOKENS);
	if (toolTokens >= TOOLS_WARN_TOKENS || heavy.length > 0) {
		const heavyText = heavy.length > 0 ? ` Heavy (≥${fmtTokens(HEAVY_TOOL_TOKENS)} each): ${names(heavy.map((t) => t.label))}.` : "";
		findings.push({
			level: "warn",
			text: `${tools.length} tools cost ${fmtTokens(toolTokens)} on every request.${heavyText}`,
			lever: "Deactivate tools you do not use, disable the extension that adds them, or register them with `exposure: \"codemode\"` / `\"deferred\"`.",
		});
	}

	const files = setup.filter((i) => i.kind === "context-file");
	const fileTokens = setupTokens(sum(files, (i) => i.chars));
	if (fileTokens >= CONTEXT_FILES_WARN_TOKENS) {
		findings.push({
			level: "warn",
			text: `Context files cost ${fmtTokens(fileTokens)} on every request: ${names(files.map((f) => f.label))}.`,
			lever: "Trim them to rules the agent cannot infer from the repository.",
		});
	}

	const topSource = report.sources.find((s) => s.origin !== PI_ORIGIN);
	if (topSource && topSource.chars / report.setupChars >= SOURCE_SHARE_WARN && setupTokens(topSource.chars) >= SOURCE_MIN_TOKENS) {
		findings.push({
			level: "info",
			text: `\`${topSource.origin}\` is ${fmtPercent(topSource.chars, report.setupChars)} of fixed overhead (${fmtTokens(setupTokens(topSource.chars))}).`,
			lever: "If you rarely use it, remove it from `packages` in settings.json or exclude its extensions and skills.",
		});
	}

	const [biggest] = report.biggest;
	if (window && biggest && conversationTokens(biggest.chars) / window >= BIGGEST_BLOCK_SHARE_WARN) {
		const tokens = conversationTokens(biggest.chars);
		findings.push({
			level: "warn",
			text: `One block is ${fmtTokens(tokens)} (${fmtPercent(tokens, window)} of the window): ${biggest.label}.`,
			lever: "Read files with offset/limit, pipe commands through head/grep, or compact once it is no longer needed.",
		});
	}

	for (const repeat of report.repeats.slice(0, 3)) {
		findings.push({
			level: "warn",
			text: `\`${repeat.label}\` returned ${repeat.count} times, ${fmtTokens(conversationTokens(repeat.chars))} in total.`,
			lever: "Each copy stays in context. Reuse the earlier result or note what you need from it.",
		});
	}

	const [topResult] = report.toolResults;
	if (topResult && topResult.chars / Math.max(1, report.conversationChars) >= DOMINANT_TOOL_SHARE) {
		findings.push({
			level: "info",
			text: `\`${topResult.tool}\` results are ${fmtPercent(topResult.chars, report.conversationChars)} of the conversation (${topResult.count} calls, ${fmtTokens(conversationTokens(topResult.chars))}).`,
		});
	}

	if (report.thinkingChars / Math.max(1, report.conversationChars) >= THINKING_SHARE_WARN) {
		findings.push({
			level: "warn",
			text: `Thinking is ${fmtPercent(report.thinkingChars, report.conversationChars)} of the conversation (${fmtTokens(conversationTokens(report.thinkingChars))}).`,
			lever: "Use a lower thinking level for routine work (setting: defaultThinkingLevel), or compact long sessions.",
		});
	}
	if (report.signatureChars >= SIGNATURE_INFO_CHARS) {
		findings.push({
			level: "info",
			text: `Replies carry ${Math.round(report.signatureChars / 1000)}k chars of opaque thinking signatures, which are not priced above. Whether they count toward context depends on the provider; if yours does, thinking costs more than shown.`,
			lever: "A lower thinking level shrinks them; compaction drops them. A conversation rate under about 2 chars/token in the header suggests they are counted.",
		});
	}

	const [topInjected] = report.injected;
	if (topInjected && topInjected.chars / Math.max(1, report.conversationChars) >= INJECTED_SHARE_INFO) {
		findings.push({
			level: "info",
			text: `Extension messages \`${topInjected.label}\` inject ${fmtTokens(conversationTokens(topInjected.chars))} into the conversation.`,
			lever: "Check the extension that sends them for a setting that limits injection size.",
		});
	}
	return findings;
}
