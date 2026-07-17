import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  resolveFooterThinkingLevel,
  thinkingLevelColorToken,
} from "./custom-footer-helpers.mjs";

// Heuristic only: providers can invalidate prompt cache for non-time reasons
// (model switch, tool-set/system-prompt changes, compaction, etc.).
// Default matches Anthropic short retention (5m). PI_CACHE_RETENTION=long uses
// Anthropic long retention (1h). OpenAI long is 24h and some providers differ.
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

  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return `${hours}h${String(min).padStart(2, "0")}m`;
}

function parseEntryTimestamp(timestamp: unknown): number | null {
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return timestamp;
  }
  if (typeof timestamp === "string") {
    const ms = Date.parse(timestamp);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    // Track tokens/sec for the most recent assistant response
    let lastSpeed: number | null = null;
    let assistantStartTime: number | null = null;

    // Time since last assistant response (prompt-cache freshness heuristic)
    let lastResponseAt: number | null = null;
    let agentActive = false;
    let requestRender: (() => void) | null = null;
    // After one render at/after TTL, stop ticking until the next response.
    let idleFrozen = false;

    // thinking_level_select only fires on actual changes, not session start.
    // Always read live level via pi.getThinkingLevel() in render; this just repaints.
    pi.on("thinking_level_select", async () => {
      requestRender?.();
    });

    // Seed from existing session history when resuming
    const branch = ctx.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry.type === "message" && entry.message.role === "assistant") {
        lastResponseAt = parseEntryTimestamp(entry.timestamp);
        break;
      }
    }

    pi.on("agent_start", async () => {
      agentActive = true;
      requestRender?.();
    });

    pi.on("agent_end", async () => {
      agentActive = false;
      requestRender?.();
    });

    pi.on("message_start", async (event) => {
      if (event.message.role === "assistant") {
        assistantStartTime = Date.now();
        requestRender?.();
      }
    });

    pi.on("message_end", async (event) => {
      if (event.message.role === "assistant") {
        const m = event.message as AssistantMessage;
        const outputTokens = m.usage.output;
        const elapsed = assistantStartTime ? (Date.now() - assistantStartTime) / 1000 : 0;

        // Skip if elapsed is unreasonably small (e.g. restored from session)
        if (elapsed > 0.5 && outputTokens > 0) {
          lastSpeed = Math.round(outputTokens / elapsed);
        }
        assistantStartTime = null;
        lastResponseAt = Date.now();
        idleFrozen = false;
        requestRender?.();
      }
    });

    let footerDispose: (() => void) | null = null;

    pi.on("session_shutdown", async () => {
      footerDispose?.();
      footerDispose = null;
      requestRender = null;
    });

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

      const tick = setInterval(() => {
        if (
          lastResponseAt === null ||
          agentActive ||
          assistantStartTime !== null ||
          idleFrozen
        ) {
          return;
        }
        // Render once at TTL, then freeze until the next assistant response.
        if (Date.now() - lastResponseAt >= getCacheTtlMs()) {
          idleFrozen = true;
        }
        tui.requestRender();
      }, 1000);

      const dispose = () => {
        clearInterval(tick);
        unsubBranch();
        requestRender = null;
      };
      footerDispose = dispose;

      return {
        dispose,
        invalidate() {},
        render(width: number): string[] {
          let input = 0,
            output = 0,
            cost = 0,
            reasoning = 0;
          for (const e of ctx.sessionManager.getBranch()) {
            if (e.type === "message" && e.message.role === "assistant") {
              const m = e.message as AssistantMessage;
              input += m.usage.input;
              output += m.usage.output;
              cost += m.usage.cost.total;
              reasoning += m.usage.reasoningTokens ?? 0;
            }
          }

          const fmt = (n: number) => {
            if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
            if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
            return `${n}`;
          };

          // Separator
          const sep = " " + theme.fg("dim", "│") + " ";

          // Session context usage — model's context window
          const contextUsage = ctx.getContextUsage();
          const ctxLimit = contextUsage?.limit ?? ctx.model?.contextWindow ?? 0;
          const ctxTokens = contextUsage?.tokens ?? 0;
          let contextPct = "";
          if (ctxLimit > 0) {
            const pct = (ctxTokens / ctxLimit) * 100;
            const color = pct > 80 ? "error" : pct > 50 ? "warning" : "success";
            contextPct =
              theme.fg(color, `${pct.toFixed(1)}%`) + theme.fg("dim", "/" + fmt(ctxLimit));
          }

          const gitBranch = footerData.getGitBranch();

          // Colored stat labels — using valid theme token names only
          const arrowUp = theme.fg("success", "↑") + theme.fg("text", fmt(input));
          const arrowDown = theme.fg("error", "↓") + theme.fg("text", fmt(output));
          const reasoningStr =
            reasoning > 0 ? theme.fg("accent", "R") + theme.fg("text", fmt(reasoning)) : "";
          const costStr = theme.fg("warning", "$" + cost.toFixed(3));
          const speedStr = lastSpeed !== null ? theme.fg("mdLink", fmt(lastSpeed) + " t/s") : "";

          // Idle / cache-freshness: time since last assistant response
          // Cap at TTL so the timer freezes once cache is presumed cold.
          let idleStr = "";
          if (agentActive || assistantStartTime !== null) {
            idleStr = theme.fg("muted", "live");
          } else if (lastResponseAt !== null) {
            const ttlMs = getCacheTtlMs();
            const idleMs = Math.min(Date.now() - lastResponseAt, ttlMs);
            const ratio = idleMs / ttlMs;
            const color = ratio >= 1 ? "error" : ratio >= 0.5 ? "warning" : "success";
            idleStr = theme.fg(color, formatElapsed(idleMs));
          }

          // Live session thinking level (never hard-code a default — no startup event).
          const thinkingLevel = resolveFooterThinkingLevel(() => pi.getThinkingLevel());
          const levelColor = thinkingLevelColorToken(thinkingLevel);
          const levelDot = theme.fg(levelColor, "●");
          const modelStr = theme.fg("accent", ctx.model?.id || "no-model");
          const levelStr = theme.fg("muted", thinkingLevel);

          // Git branch — use success color
          const gitStr = gitBranch ? theme.fg("toolDiffAdded", " " + gitBranch) : "";

          // ===== LEFT: stats with │ separators between each =====
          const leftParts = [
            arrowUp,
            arrowDown,
            reasoningStr,
            costStr,
            contextPct,
            speedStr,
            idleStr,
          ].filter(Boolean);

          const left = leftParts.join(sep);

          // ===== RIGHT: model info =====
          const rightParts = [modelStr, levelDot + " " + levelStr, gitStr].filter(Boolean);

          const right = rightParts.join(" " + theme.fg("dim", "•") + " ");
          const midSep = right ? " " + theme.fg("dim", "│") + " " : "";

          // Pad left side so right side is right-aligned
          const leftContent = left + midSep;
          const padNeeded = Math.max(1, width - visibleWidth(leftContent) - visibleWidth(right));
          const pad = " ".repeat(padNeeded);

          return [truncateToWidth(leftContent + pad + right, width)];
        },
      };
    });
  });
}
