/**
 * Custom TUI welcome header: pi logo, key tips, and loaded resources.
 * Replaces the stock header and hides the default resource panel sections.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { VERSION, keyText } from "@earendil-works/pi-coding-agent";
import {
  backgroundAnsi,
  type Component,
  foregroundAnsi,
  isAppleTerminalSession,
  rgbColor,
  Spacer,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  getSectionHeading,
  isSectionId,
  parseResourceSections,
} from "./welcome-header-helpers.mjs";

const GAP = 4;
const MIN_TIPS_WIDTH = 28;
const SIDE_PAD = 1;
const COLLAPSED_ITEM_LINES = 3;
const RESOURCE_PANEL_INDEX = 1;
const RESOURCE_PAIRS = [
  ["Context", "Prompts"],
  ["Skills", "Extensions"],
  ["Themes", undefined],
] as const;

const CORAL = rgbColor(228, 138, 122);
const BLUE = rgbColor(79, 142, 179);
const YELLOW = rgbColor(234, 182, 93);
const RESET = "\x1b[0m";

type SectionId = "Context" | "Skills" | "Prompts" | "Extensions" | "Themes";

export type WelcomeResources = {
  context: string[];
  skills: string[];
  prompts: string[];
  extensions: string[];
  themes: string[];
};

type WelcomeOptions = {
  width: number;
  theme: Theme;
  modelLabel?: string;
  resources?: WelcomeResources;
  expanded?: boolean;
  maxHeight?: number;
};

type ResourcePanel = {
  children: Component[];
  addChild: (component: Component) => void;
  removeChild: (component: Component) => void;
  invalidate: () => void;
};

type HiddenChild = {
  component: Component;
  originalIndex: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isResourcePanel(value: unknown): value is ResourcePanel {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.children) &&
    typeof value.addChild === "function" &&
    typeof value.removeChild === "function" &&
    typeof value.invalidate === "function"
  );
}

function collapsedResourceText(value: unknown, expanded: boolean): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.getCollapsedText === "function") return value.getCollapsedText();
  // Pi 1.4 replaced getCollapsedText() with a theme-aware builder.
  if (typeof value.build !== "function" || typeof value.setExpanded !== "function") return undefined;
  value.setExpanded(false);
  try {
    return value.build();
  } finally {
    value.setExpanded(expanded);
  }
}

function padVisible(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function iconWidth(icon: readonly string[]): number {
  return Math.max(0, ...icon.map((line) => visibleWidth(line)));
}

function renderLogo(theme: Theme, scale: number): string[] {
  const mode = theme.getColorMode();
  const fg = (color: typeof CORAL) => foregroundAnsi(color, mode);
  if (isAppleTerminalSession()) {
    return [`${fg(CORAL)}P${RESET}${fg(YELLOW)}i${RESET}`];
  }
  // Pi's four pixel rows, scaled before pairing into terminal half-block cells.
  const pixels = [
    [CORAL, CORAL, CORAL, undefined],
    [BLUE, undefined, CORAL, undefined],
    [BLUE, BLUE, undefined, YELLOW],
    [BLUE, undefined, undefined, YELLOW],
  ];
  const lines: string[] = [];
  for (let y = 0; y < pixels.length * scale; y += 2) {
    const top = pixels[Math.floor(y / scale)];
    const bottom = pixels[Math.floor((y + 1) / scale)];
    lines.push(top.map((upper, x) => {
      const lower = bottom[x];
      if (!upper && !lower) return " ".repeat(scale);
      const color = upper && lower
        ? fg(upper) + backgroundAnsi(lower, mode)
        : fg((upper ?? lower)!);
      return color + (upper ? "▀" : "▄").repeat(scale) + RESET;
    }).join(""));
  }
  return lines;
}

function joinColumns(left: string[], right: string[], gap: number): string[] {
  const leftColWidth = Math.max(0, ...left.map((line) => visibleWidth(line)));
  const height = Math.max(left.length, right.length);
  const lines: string[] = [];
  for (let row = 0; row < height; row += 1) {
    const leftLine = left[row] ?? "";
    const rightLine = right[row] ?? "";
    if (!rightLine) {
      lines.push(leftLine);
      continue;
    }
    lines.push(padVisible(leftLine, leftColWidth) + " ".repeat(gap) + rightLine);
  }
  return lines;
}

function joinFixedColumns(
  left: string[],
  right: string[],
  columnWidth: number,
  gap: number,
): string[] {
  const height = Math.max(left.length, right.length);
  const lines: string[] = [];
  for (let row = 0; row < height; row += 1) {
    const leftLine = padVisible(
      truncateToWidth(left[row] ?? "", columnWidth, ""),
      columnWidth,
    );
    const rightLine = truncateToWidth(right[row] ?? "", columnWidth, "");
    lines.push(leftLine + " ".repeat(gap) + rightLine);
  }
  return lines;
}

function tipKeys(): Array<[string, string]> {
  const interrupt = keyText("app.interrupt") || "ctrl+c";
  const clear = keyText("app.clear") || "ctrl+c";
  const model = keyText("app.model.select") || "ctrl+l";
  const thinking = keyText("app.thinking.cycle") || "shift+tab";
  const expand = keyText("app.tools.expand") || "ctrl+o";
  return [
    [interrupt, "interrupt"],
    [`${clear} twice`, "exit"],
    ["/", "commands"],
    ["!", "bash"],
    [model, "model"],
    [thinking, "thinking"],
    [expand, "expand tools"],
  ];
}

function renderTips(theme: Theme, modelLabel: string | undefined): string[] {
  const version = theme.fg("dim", `v${VERSION}`);
  const themeName = theme.name ? theme.fg("dim", `  ·  ${theme.name}`) : "";
  const lines = [`${theme.bold(theme.fg("accent", "pi"))}  ${version}${themeName}`];
  if (modelLabel) {
    lines.push(theme.fg("muted", modelLabel));
  }
  lines.push("");

  const tips = tipKeys();
  const keyCol = Math.max(...tips.map(([keys]) => visibleWidth(keys)));
  for (const [keys, description] of tips) {
    lines.push(
      theme.fg("accent", keys.padEnd(keyCol)) +
        "  " +
        theme.fg("muted", description),
    );
  }
  return lines;
}

function hasResources(
  resources: WelcomeResources | undefined,
): resources is WelcomeResources {
  if (!resources) return false;
  return (
    resources.context.length +
      resources.skills.length +
      resources.prompts.length +
      resources.extensions.length +
      resources.themes.length >
    0
  );
}

function expandHint(): string {
  return keyText("app.tools.expand") || "ctrl+o";
}

export function renderResourceSection(options: {
  title: string;
  items: string[];
  theme: Theme;
  expanded: boolean;
  columnWidth: number;
  itemLimit?: number;
}): string[] {
  const { title, items, theme, expanded, columnWidth, itemLimit = COLLAPSED_ITEM_LINES } = options;
  if (items.length === 0 || columnWidth <= 0) return [];

  if (!expanded && itemLimit === 0) {
    return [truncateToWidth(theme.fg("mdHeading", `[${title}] +${items.length} more`), columnWidth, "…")];
  }
  const lines = [
    truncateToWidth(theme.fg("mdHeading", `[${title}]`), columnWidth, "…"),
  ];
  const visible = expanded ? items : items.slice(0, itemLimit);
  for (const item of visible) {
    lines.push(
      truncateToWidth(theme.fg("dim", `  ${item}`), columnWidth, "…"),
    );
  }
  const hidden = items.length - visible.length;
  if (hidden > 0) {
    lines.push(
      truncateToWidth(theme.fg("muted", `  +${hidden} more`), columnWidth, "…"),
    );
  }
  return lines;
}

function resourceEntries(
  resources: WelcomeResources,
): Array<{ title: SectionId; items: string[] }> {
  return [
    { title: "Context", items: resources.context },
    { title: "Skills", items: resources.skills },
    { title: "Prompts", items: resources.prompts },
    { title: "Extensions", items: resources.extensions },
    { title: "Themes", items: resources.themes },
  ].filter((section) => section.items.length > 0);
}

function pairResourceSections(
  sections: Array<{ title: SectionId; items: string[] }>,
): Array<
  [
    { title: SectionId; items: string[] },
    { title: SectionId; items: string[] } | undefined,
  ]
> {
  const byTitle = new Map(sections.map((section) => [section.title, section]));
  const used = new Set<SectionId>();
  const pairs: Array<
    [
      { title: SectionId; items: string[] },
      { title: SectionId; items: string[] } | undefined,
    ]
  > = [];

  for (const [leftId, rightId] of RESOURCE_PAIRS) {
    const left = byTitle.get(leftId);
    const right = rightId ? byTitle.get(rightId) : undefined;
    if (!left && !right) continue;
    if (left) used.add(leftId);
    if (right && rightId) used.add(rightId);
    if (left && right) pairs.push([left, right]);
    else pairs.push([left ?? right!, undefined]);
  }

  for (const section of sections) {
    if (!used.has(section.title)) pairs.push([section, undefined]);
  }
  return pairs;
}

export function renderResourceGrid(options: {
  resources: WelcomeResources;
  theme: Theme;
  expanded: boolean;
  width: number;
  maxHeight?: number;
}): string[] {
  const { resources, theme, expanded, width, maxHeight = Infinity } = options;
  const sections = resourceEntries(resources);
  if (sections.length === 0 || width <= 0 || maxHeight <= 0) return [];

  const twoColumn = width >= MIN_TIPS_WIDTH * 2 + GAP && sections.length >= 2;
  const columnWidth = twoColumn ? Math.floor((width - GAP) / 2) : width;
  const pairs = twoColumn
    ? pairResourceSections(sections)
    : sections.map((section) => [section, undefined] as const);

  for (let itemLimit = COLLAPSED_ITEM_LINES; itemLimit >= 0; itemLimit -= 1) {
    const renderSection = (section: { title: SectionId; items: string[] }, sectionWidth: number) =>
      renderResourceSection({ ...section, theme, expanded, itemLimit, columnWidth: sectionWidth });
    const lines: string[] = [];
    for (const [left, right] of pairs) {
      if (lines.length > 0 && itemLimit > 0) lines.push("");
      lines.push(...(right
        ? joinFixedColumns(renderSection(left, columnWidth), renderSection(right, columnWidth), columnWidth, GAP)
        : renderSection(left, width)));
    }
    const hidden = sections.some((section) => section.items.length > itemLimit);
    if (expanded || hidden) {
      lines.push("", theme.fg("dim", `${expandHint()}  show ${expanded ? "less" : "all"}`));
    }
    if (expanded || lines.length <= maxHeight) return lines;
  }

  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  return maxHeight >= 2
    ? [theme.fg("muted", `[Resources] +${total} more`), theme.fg("dim", `${expandHint()}  show all`)]
    : [theme.fg("dim", `${expandHint()} show all (${total})`)];
}

function renderBrand(options: {
  contentWidth: number;
  theme: Theme;
  modelLabel?: string;
  maxHeight: number;
}): string[] {
  const { contentWidth, theme, modelLabel, maxHeight } = options;
  if (maxHeight <= 0) return [];
  const tips = renderTips(theme, modelLabel);
  const tipsWidth = Math.max(
    MIN_TIPS_WIDTH,
    ...tips.map((line) => visibleWidth(line)),
  );
  const scale = contentWidth >= 20 + GAP + tipsWidth ? 5 : 3;
  const logo = renderLogo(theme, scale);
  const sideBySideWidth = iconWidth(logo) + GAP + tipsWidth;
  const full = contentWidth >= sideBySideWidth
    ? joinColumns(logo, tips, GAP)
    : [...logo, "", ...tips];
  if (full.length <= maxHeight) return full;

  const shortTips = tips.slice(0, modelLabel ? 2 : 1);
  const shortWidth = Math.max(...shortTips.map((line) => visibleWidth(line)));
  for (const smallScale of [3, 1]) {
    const smallLogo = renderLogo(theme, smallScale);
    const compact = contentWidth >= iconWidth(smallLogo) + GAP + shortWidth
      ? joinColumns(smallLogo, shortTips, GAP)
      : [...smallLogo, "", ...shortTips];
    if (compact.length <= maxHeight) return compact;
  }
  return shortTips.slice(0, maxHeight);
}

export function renderWelcome({
  width,
  theme,
  modelLabel,
  resources,
  expanded = false,
  maxHeight = Infinity,
}: WelcomeOptions): string[] {
  const height = expanded ? Infinity : Math.max(0, Math.floor(maxHeight));
  if (width <= 0 || height <= 0) return [];

  const sidePad = Math.min(SIDE_PAD, Math.max(0, Math.floor((width - 1) / 2)));
  const contentWidth = Math.max(1, width - sidePad * 2);
  const padding = height >= 6 ? [""] : [];
  const available = height - padding.length * 2;
  const resourceSpace = hasResources(resources) ? Math.min(2, available) : 0;
  const separator = resourceSpace > 0 && available >= 6
    ? ["", theme.fg("dim", "─".repeat(contentWidth))]
    : [];
  const body = renderBrand({
    contentWidth, theme, modelLabel,
    maxHeight: Math.max(0, available - resourceSpace - separator.length),
  });
  if (hasResources(resources)) {
    body.push(...separator, ...renderResourceGrid({
      resources, theme, expanded, width: contentWidth,
      maxHeight: available - body.length - separator.length,
    }));
  }

  const prefix = " ".repeat(sidePad);
  return [...padding, ...body, ...padding].map((line) =>
    padVisible(truncateToWidth(prefix + line, width, ""), width),
  );
}

function findResourcePanel(tui: TUI): ResourcePanel | undefined {
  const documentContainer = tui.children[0];
  if (isResourcePanel(documentContainer)) {
    const header = documentContainer.children[0];
    const panel = documentContainer.children[1];
    const chat = documentContainer.children[2];
    if (
      isResourcePanel(header) &&
      isResourcePanel(panel) &&
      isResourcePanel(chat)
    ) {
      return panel;
    }
  }

  const fallback = tui.children[RESOURCE_PANEL_INDEX];
  if (isResourcePanel(tui.children[0]) && isResourcePanel(fallback)) {
    return fallback;
  }
  return undefined;
}

function inspectResourceTexts(panel: ResourcePanel, expanded: boolean): {
  texts: string[];
  knownChildren: Component[];
} {
  const texts: string[] = [];
  const knownChildren: Component[] = [];
  for (const child of panel.children) {
    const text = collapsedResourceText(child, expanded);
    if (!text) continue;
    const heading = getSectionHeading(text);
    if (!heading || !isSectionId(heading)) continue;
    knownChildren.push(child);
    texts.push(text);
  }
  return { texts, knownChildren };
}

function hideKnownChildren(
  panel: ResourcePanel,
  knownChildren: Component[],
): HiddenChild[] {
  const current = [...panel.children];
  const known = new Set(knownChildren);
  const removed: HiddenChild[] = [];
  for (let index = 0; index < current.length; index += 1) {
    const child = current[index];
    if (!child) continue;
    const previous = current[index - 1];
    const next = current[index + 1];
    const remove =
      known.has(child) ||
      (child instanceof Spacer &&
        Boolean(
          (previous && known.has(previous)) || (next && known.has(next)),
        ));
    if (!remove) continue;
    removed.push({ component: child, originalIndex: index });
  }
  for (const { component } of removed) panel.removeChild(component);
  return removed;
}

function restoreKnownChildren(
  panel: ResourcePanel,
  hidden: HiddenChild[],
): void {
  for (const { component, originalIndex } of hidden) {
    if (panel.children.includes(component)) continue;
    const index = Math.min(originalIndex, panel.children.length);
    panel.children.splice(index, 0, component);
  }
}

class WelcomeHeader implements Component {
  private expanded = false;
  private resources: WelcomeResources | undefined;
  private hidden: HiddenChild[] = [];
  private panel: ResourcePanel | undefined;
  private disposed = false;
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly modelLabel: string | undefined;

  constructor(tui: TUI, theme: Theme, modelLabel: string | undefined) {
    this.tui = tui;
    this.theme = theme;
    this.modelLabel = modelLabel;
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
  }

  render(width: number): string[] {
    this.capture();
    return renderWelcome({
      width,
      theme: this.theme,
      modelLabel: this.modelLabel,
      resources: this.resources,
      expanded: this.expanded,
      maxHeight: this.availableHeight(width),
    });
  }

  private availableHeight(width: number): number {
    const first = this.tui.children[0];
    const header = isResourcePanel(first) ? first.children[0] : undefined;
    const nested = isResourcePanel(header) && header.children.includes(this);
    const headerContainer = nested ? header : first;
    const siblings = [
      ...this.tui.children.slice(1),
      ...(nested && isResourcePanel(first) ? first.children.slice(1) : []),
      ...(isResourcePanel(headerContainer) ? headerContainer.children.filter((child) => child !== this) : []),
    ];
    // Leave the editor, footer, header spacers, and diagnostics their actual rendered height.
    const occupied = siblings.reduce((sum, child) => sum + child.render(width).length, 0);
    return Math.max(0, this.tui.terminal.rows - occupied);
  }

  invalidate(): void {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.panel) restoreKnownChildren(this.panel, this.hidden);
    this.hidden = [];
  }

  private capture(): void {
    if (this.disposed) return;
    const panel = findResourcePanel(this.tui);
    if (!panel) return;
    const { texts, knownChildren } = inspectResourceTexts(panel, this.expanded);
    const resources = parseResourceSections(texts);
    if (!hasResources(resources)) return;
    // Capture during rendering so late discovery and /reload do not depend on a startup timer.
    this.panel = panel;
    this.hidden = hideKnownChildren(panel, knownChildren);
    this.resources = resources;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const modelLabel = ctx.model
      ? `${ctx.model.provider}/${ctx.model.id}`
      : undefined;
    ctx.ui.setHeader(
      (tui, theme) => new WelcomeHeader(tui, theme, modelLabel),
    );
  });
}
