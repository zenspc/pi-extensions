import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";

// Cache freshness is a heuristic; providers can invalidate it for non-time reasons.
// These TTLs match Anthropic retention. Other providers may differ.
function getCacheTtlMs(): number {
	return process.env.PI_CACHE_RETENTION === "long"
		? 60 * 60 * 1000
		: 5 * 60 * 1000;
}

function formatElapsed(ms: number): string {
	const totalSec = Math.max(0, Math.floor(ms / 1000));
	if (totalSec < 60) return `${totalSec}s`;
	const totalMin = Math.floor(totalSec / 60);
	const sec = totalSec % 60;
	if (totalMin < 60) return `${totalMin}m${String(sec).padStart(2, "0")}s`;
	return `${Math.floor(totalMin / 60)}h${String(totalMin % 60).padStart(
		2,
		"0"
	)}m`;
}

function parseTimestamp(timestamp: unknown): number | null {
	if (typeof timestamp === "number" && Number.isFinite(timestamp))
		return timestamp;
	if (typeof timestamp === "string") {
		const ms = Date.parse(timestamp);
		return Number.isNaN(ms) ? null : ms;
	}
	return null;
}

export function createFooterActivity(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	requestRender: () => void
) {
	let lastResponseAt: number | null = null;
	let assistantStartTime: number | null = null;
	let agentActive = !ctx.isIdle();
	let lastSpeed: number | null = null;
	let tick: ReturnType<typeof setInterval> | null = null;
	let disposed = false;

	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type === "message" && entry.message.role === "assistant") {
			lastResponseAt = parseTimestamp(entry.timestamp);
			break;
		}
	}

	const stopTick = () => {
		if (tick !== null) clearInterval(tick);
		tick = null;
	};
	const startTick = () => {
		if (
			disposed ||
			tick !== null ||
			agentActive ||
			assistantStartTime !== null ||
			lastResponseAt === null ||
			Date.now() - lastResponseAt >= getCacheTtlMs()
		)
			return;
		tick = setInterval(() => {
			requestRender();
			// Repaint once at expiry, then stop until the next assistant response.
			if (
				lastResponseAt !== null &&
				Date.now() - lastResponseAt >= getCacheTtlMs()
			)
				stopTick();
		}, 1000);
	};
	const subscriptions = [
		pi.on("agent_start", async () => {
			agentActive = true;
			stopTick();
			requestRender();
		}),
		pi.on("agent_end", async () => {
			agentActive = false;
			startTick();
			requestRender();
		}),
		pi.on("message_start", async (event) => {
			if (event.message.role !== "assistant") return;
			assistantStartTime = Date.now();
			stopTick();
			requestRender();
		}),
		pi.on("message_end", async (event) => {
			if (event.message.role !== "assistant") return;
			const elapsed =
				assistantStartTime !== null
					? (Date.now() - assistantStartTime) / 1000
					: 0;
			if (elapsed > 0.5 && event.message.usage.output > 0)
				lastSpeed = Math.round(event.message.usage.output / elapsed);
			assistantStartTime = null;
			lastResponseAt = Date.now();
			startTick();
			requestRender();
		}),
	];
	startTick();

	return {
		get speed() {
			return lastSpeed;
		},
		renderTimer(theme: Theme): string {
			if (agentActive || assistantStartTime !== null)
				return theme.fg("muted", "live");
			if (lastResponseAt === null) return "";
			const ttlMs = getCacheTtlMs();
			const idleMs = Math.max(
				0,
				Math.min(Date.now() - lastResponseAt, ttlMs)
			);
			const ratio = idleMs / ttlMs;
			const color =
				ratio >= 1 ? "error" : ratio >= 0.5 ? "warning" : "success";
			return theme.fg(color, formatElapsed(idleMs));
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			stopTick();
			for (const unsubscribe of subscriptions) unsubscribe();
		},
	};
}
