import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  addAssistantUsage,
  emptyFooterUsageTotals,
  latestCacheHitRate,
  resolveFooterThinkingLevel,
  sumAssistantUsageFromBranch,
  thinkingLevelColorToken,
  trimLeftParts,
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

// Same control-char + multi-space collapse as the built-in footer, so
// extension statuses render identically to Pi's own footer line.
function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
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
    // Latest-response cache hit rate (percent), for the CH stat
    let lastCacheHitRate: number | null = null;
    let assistantStartTime: number | null = null;

    // Time since last assistant response (prompt-cache freshness heuristic)
    let lastResponseAt: number | null = null;
    let agentActive = false;
    let requestRender: (() => void) | null = null;
    // After one render at/after TTL, stop ticking until the next response.
    let idleFrozen = false;
    let usageTotals = emptyFooterUsageTotals();
    let idleTick: ReturnType<typeof setInterval> | null = null;

    const stopIdleTick = () => {
      if (idleTick !== null) {
        clearInterval(idleTick);
        idleTick = null;
      }
    };

    const startIdleTick = () => {
      if (idleTick !== null) return;
      idleTick = setInterval(() => {
        if (lastResponseAt === null || agentActive || assistantStartTime !== null) {
          return;
        }
        // Render once at TTL, then freeze and stop the interval.
        if (Date.now() - lastResponseAt >= getCacheTtlMs()) {
          idleFrozen = true;
          requestRender?.();
          stopIdleTick();
          return;
        }
        requestRender?.();
      }, 1000);
    };

    // thinking_level_select only fires on actual changes, not session start.
    // Always read live level via pi.getThinkingLevel() in render; this just repaints.
    pi.on("thinking_level_select", async () => {
      requestRender?.();
    });

    // Model switches do not fire agent/message events. Repaint so the model
    // id and provider shown in the footer update immediately after /model.
    pi.on("model_select", async () => {
      requestRender?.();
    });

    // Seed from existing session history when resuming
    const branch = ctx.sessionManager.getBranch();
    usageTotals = sumAssistantUsageFromBranch(branch);
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry.type === "message" && entry.message.role === "assistant") {
        lastResponseAt = parseEntryTimestamp(entry.timestamp);
        lastCacheHitRate = latestCacheHitRate(entry.message);
        break;
      }
    }
    // Resume past TTL: freeze idle display. Within-TTL start is deferred to
    // setFooter once requestRender is wired.
    if (lastResponseAt !== null && Date.now() - lastResponseAt >= getCacheTtlMs()) {
      idleFrozen = true;
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
        lastCacheHitRate = latestCacheHitRate(m);
        idleFrozen = false;
        usageTotals = addAssistantUsage(usageTotals, m);
        startIdleTick();
        requestRender?.();
      }
    });

    let footerDispose: (() => void) | null = null;

    pi.on("session_shutdown", async () => {
      footerDispose?.();
      footerDispose = null;
      requestRender = null;
      stopIdleTick();
    });

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubBranch = footerData.onBranchChange(() => {
        usageTotals = sumAssistantUsageFromBranch(ctx.sessionManager.getBranch());
        tui.requestRender();
      });

      // Resume case: prior assistant activity still within TTL.
      if (
        lastResponseAt !== null &&
        !idleFrozen &&
        Date.now() - lastResponseAt < getCacheTtlMs()
      ) {
        startIdleTick();
      }

      const dispose = () => {
        stopIdleTick();
        unsubBranch();
        requestRender = null;
      };
      footerDispose = dispose;

      return {
        dispose,
        invalidate() {},
        render(width: number): string[] {
          const { input, output, cost, reasoning, cacheRead, cacheWrite } = usageTotals;

          const fmt = (n: number) => {
            if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
            if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
            return `${n}`;
          };

          // Separator
          const sep = " " + theme.fg("dim", "│") + " ";

          // Session context usage: canonical ContextUsage fields. tokens/percent
          // are null right after compaction until the next LLM response; render
          // that as "?" like the built-in footer. Use nullish (== null) checks:
          // getContextUsage() can return undefined, and a crash in render() is
          // not acceptable on this hot path.
          const contextUsage = ctx.getContextUsage();
          const ctxLimit = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const ctxPct = contextUsage?.percent; // number | null | undefined
          let contextStr = "";
          if (ctxLimit > 0) {
            const pctStr = ctxPct == null ? "?" : ctxPct.toFixed(1);
            // percent drives the color; unknown (post-compaction) -> neutral/dim
            const color =
              ctxPct == null ? "dim" :
              ctxPct > 80 ? "error" :
              ctxPct > 50 ? "warning" : "success";
            contextStr =
              theme.fg(color, pctStr + "%") + theme.fg("dim", "/" + fmt(ctxLimit));
          }

          const gitBranch = footerData.getGitBranch();

          // Colored stat labels — using valid theme token names only
          const arrowUp = theme.fg("success", "↑") + theme.fg("text", fmt(input));
          const arrowDown = theme.fg("error", "↓") + theme.fg("text", fmt(output));
          const cacheReadStr =
            cacheRead > 0 ? theme.fg("mdLink", "R") + theme.fg("text", fmt(cacheRead)) : "";
          const cacheWriteStr =
            cacheWrite > 0 ? theme.fg("mdLink", "W") + theme.fg("text", fmt(cacheWrite)) : "";
          // CH only when the session has cache activity, like the built-in footer
          // (footer.js: totalCacheRead>0 || totalCacheWrite>0, and a computable
          // latest hit rate). Without the gate, cache-less providers would show
          // a permanent CH0.0%.
          const hitRateStr =
            (cacheRead > 0 || cacheWrite > 0) && lastCacheHitRate !== null
              ? theme.fg("mdLink", "CH") + theme.fg("text", lastCacheHitRate.toFixed(1) + "%")
              : "";
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
          // Provider prefix when multiple providers are configured and it fits.
          let modelDisplay = modelStr;
          const providerCount = footerData.getAvailableProviderCount();
          const providerName = ctx.model?.provider;
          if (providerCount > 1 && providerName) {
            const withProvider = theme.fg("dim", `(${providerName}) `) + modelStr;
            if (visibleWidth(withProvider) <= width) {
              modelDisplay = withProvider;
            }
          }
          const levelStr = theme.fg("muted", thinkingLevel);

          // Git branch — use success color
          const gitStr = gitBranch ? theme.fg("toolDiffAdded", " " + gitBranch) : "";

          // ===== LEFT: stats with │ separators between each =====
          const leftParts = [
            arrowUp,
            arrowDown,
            cacheReadStr,
            cacheWriteStr,
            hitRateStr,
            reasoningStr,
            costStr,
            contextStr,
            speedStr,
            idleStr,
          ].filter(Boolean);

          const left = leftParts.join(sep);

          // ===== RIGHT: model info =====
          const rightParts = [modelDisplay, levelDot + " " + levelStr, gitStr].filter(Boolean);

          const right = rightParts.join(" " + theme.fg("dim", "•") + " ");
          const rightWidth = visibleWidth(right);
          const sepWidth = visibleWidth(sep);

          // The right side (model/level/git) is the identity anchor users scan
          // for on narrow panes, so it is never end-truncated. Budget the left
          // side so right + separator always fit: drop lowest-priority stats
          // from the end first, always keeping the ↑/↓ anchors.
          let leftToRender = left;
          const leftBudget = Math.max(0, width - rightWidth - sepWidth);
          if (rightWidth === 0) {
            leftToRender = truncateToWidth(left, width, "…");
          } else if (visibleWidth(left) > leftBudget) {
            const anchorCount = 2; // arrowUp, arrowDown always visible
            const trimmedParts = trimLeftParts(leftParts, sep, leftBudget, anchorCount);
            leftToRender = trimmedParts.join(sep);
            if (visibleWidth(leftToRender) > leftBudget) {
              leftToRender = truncateToWidth(leftToRender, leftBudget, "…");
            }
          }

          const leftWidth = visibleWidth(leftToRender);
          // The right side gets every column left over; end-truncate it only
          // when even an empty left cannot make room (right alone wider than
          // the pane). Mirrors the built-in footer, which truncates the right
          // side and never end-truncates the whole line.
          const rightRoom = Math.max(0, width - leftWidth - (rightWidth === 0 ? 0 : sepWidth));
          let rightToRender = right;
          if (rightWidth > rightRoom) {
            rightToRender = truncateToWidth(right, rightRoom, "…");
          }
          const rightToRenderWidth = visibleWidth(rightToRender);
          const pad =
            rightWidth === 0 ? "" : " ".repeat(Math.max(0, rightRoom - rightToRenderWidth));
          const statsLine =
            rightWidth === 0 ? leftToRender : leftToRender + sep + pad + rightToRender;

          const lines: string[] = [statsLine];

          // ===== EXTENSION STATUSES =====
          const extensionStatuses = footerData.getExtensionStatuses();
          if (extensionStatuses.size > 0) {
            const sortedStatuses = Array.from(extensionStatuses.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, text]) => sanitizeStatusText(text));
            const statusLine = sortedStatuses.join(" ");
            lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "…")));
          }

          return lines;
        },
      };
    });
  });
}
