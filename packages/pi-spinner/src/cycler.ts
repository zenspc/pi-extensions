/**
 * MessageCycler: rotates through a list of messages on a timer, calling
 * `ctx.ui.setWorkingMessage()` on each tick.
 *
 * One cycler per session. The owner (the extension factory) is responsible
 * for calling start() on session_start and stop() on session_shutdown.
 *
 * Behavior:
 *   - On start(): picks a random message, calls setWorkingMessage, then
 *     schedules the next tick.
 *   - On tick(): picks a new message (avoiding immediate repeat when there
 *     are 2+ options), calls setWorkingMessage, schedules the next tick.
 *   - On stop(): clears the pending timer and (by default) restores pi's
 *     default "Working..." text. Pass `{ restoreDefault: false }` to skip
 *     the restoration. The cycler is fully re-startable afterwards.
 *
 * Uses setTimeout (chained) rather than setInterval so a long blocking
 * operation does not pile up overlapping ticks. The next tick is scheduled
 * after the message is set, never before.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { themeMessage } from "./presets.ts";

export interface CyclerOptions {
	messages: readonly string[];
	intervalMs: number;
	ctx: ExtensionContext;
}

export interface StopOptions {
	/** If true (default), call setWorkingMessage() to restore pi's default. */
	restoreDefault?: boolean;
}

export class MessageCycler {
	private messages: readonly string[];
	private intervalMs: number;
	private ctx: ExtensionContext;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private lastIndex = -1;
	private running = false;

	constructor(opts: CyclerOptions) {
		this.messages = opts.messages;
		this.intervalMs = opts.intervalMs;
		this.ctx = opts.ctx;
	}

	/** Swap in a new message list and/or interval (e.g. after editing config). */
	update(messages: readonly string[], intervalMs: number): void {
		this.messages = messages;
		this.intervalMs = intervalMs;
		// If running, the change takes effect on the next scheduled tick.
	}

	/** Begin cycling. No-op if there are no messages. */
	start(): void {
		if (this.running) return;
		if (this.messages.length === 0) return;
		this.running = true;
		this.lastIndex = -1;
		this.tick();
	}

	/**
	 * Stop cycling. By default also calls `setWorkingMessage()` to restore
	 * pi's default "Working..." text; pass `{ restoreDefault: false }` to
	 * clear the timer without touching the working message.
	 */
	stop(opts: StopOptions = {}): void {
		this.running = false;
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		if (opts.restoreDefault !== false) {
			this.ctx.ui.setWorkingMessage();
		}
	}

	/** Force-advance to the next message immediately. */
	tickNow(): void {
		if (!this.running) return;
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		this.tick();
	}

	/** True if a tick is currently scheduled. */
	get isRunning(): boolean {
		return this.running;
	}

	private pickIndex(): number {
		if (this.messages.length === 1) return 0;
		// Avoid immediate repeat when 2+ messages exist
		let idx = Math.floor(Math.random() * this.messages.length);
		if (idx === this.lastIndex) {
			idx = (idx + 1) % this.messages.length;
		}
		return idx;
	}

	private tick(): void {
		if (!this.running) return;
		const idx = this.pickIndex();
		this.lastIndex = idx;
		const raw = this.messages[idx] ?? "Working...";
		this.ctx.ui.setWorkingMessage(themeMessage(raw, this.ctx.ui.theme));
		this.timer = setTimeout(() => this.tick(), this.intervalMs);
	}
}
