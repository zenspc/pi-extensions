/**
 * Custom TUI welcome header: pi logo, key tips, and loaded resources.
 * Replaces the stock header and hides the default resource panel sections.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { VERSION, keyText } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Spacer,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  captureIsComplete,
  getSectionHeading,
  isSectionId,
  parseResourceSections,
} from "./welcome-header-helpers.mjs";

const GAP = 4;
const MIN_TIPS_WIDTH = 28;
const SIDE_PAD = 1;
const COLLAPSED_ITEM_LINES = 3;
const RESOURCE_POLL_MS = 50;
const MAX_RESOURCE_RETRIES = 3;
const RESOURCE_PANEL_INDEX = 1;
const RESOURCE_PAIRS = [
  ["Context", "Prompts"],
  ["Skills", "Extensions"],
  ["Themes", undefined],
] as const;

const PI_LARGE = [
  "████████████████████████",
  "████████████████████████",
  "████                ████",
  "      ████    ████",
  "      ████    ████",
  "      ████    ████",
  "      ████    ████",
  "      ████    ████",
  "      ████    ████",
  "      ████    ████",
];

const PI_COMPACT = [
  "████████████",
  "████████████",
  "███      ███",
  "   ██  ██",
  "   ██  ██",
  "   ██  ██",
  "   ██  ██",
];

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

function isCollapsible(
  value: unknown,
): value is { getCollapsedText: () => string } {
  return (
    isRecord(value) &&
    typeof value.getCollapsedText === "function"
  );
}

function padVisible(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function iconWidth(icon: readonly string[]): number {
  return Math.max(0, ...icon.map((line) => visibleWidth(line)));
}

function paintIcon(icon: readonly string[], theme: Theme): string[] {
  return icon.map((line) => theme.bold(theme.fg("accent", line)));
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

function pickIcon(contentWidth: number, tipsWidth: number): readonly string[] {
  const largeNeeds = iconWidth(PI_LARGE) + GAP + tipsWidth;
  return contentWidth >= largeNeeds ? PI_LARGE : PI_COMPACT;
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
}): string[] {
  const { title, items, theme, expanded, columnWidth } = options;
  if (items.length === 0 || columnWidth <= 0) return [];

  const lines = [
    truncateToWidth(theme.fg("mdHeading", `[${title}]`), columnWidth, "…"),
  ];
  const visible = expanded ? items : items.slice(0, COLLAPSED_ITEM_LINES);
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

function sectionOverflows(
  sections: Array<{ items: string[] }>,
  expanded: boolean,
): boolean {
  if (expanded) return false;
  return sections.some((section) => section.items.length > COLLAPSED_ITEM_LINES);
}

export function renderResourceGrid(options: {
  resources: WelcomeResources;
  theme: Theme;
  expanded: boolean;
  width: number;
}): string[] {
  const { resources, theme, expanded, width } = options;
  const sections = resourceEntries(resources);
  if (sections.length === 0 || width <= 0) return [];

  const hintKey = expandHint();
  const twoColumn = width >= MIN_TIPS_WIDTH * 2 + GAP && sections.length >= 2;
  const columnWidth = twoColumn
    ? Math.floor((width - GAP) / 2)
    : width;

  const renderSection = (
    section: { title: SectionId; items: string[] },
    sectionWidth: number,
  ) =>
    renderResourceSection({
      title: section.title,
      items: section.items,
      theme,
      expanded,
      columnWidth: sectionWidth,
    });

  const lines: string[] = [];
  const append = (block: string[]) => {
    if (lines.length > 0) lines.push("");
    lines.push(...block);
  };

  if (twoColumn) {
    for (const [left, right] of pairResourceSections(sections)) {
      if (right) {
        append(
          joinFixedColumns(
            renderSection(left, columnWidth),
            renderSection(right, columnWidth),
            columnWidth,
            GAP,
          ),
        );
      } else {
        append(renderSection(left, width));
      }
    }
  } else {
    for (const section of sections) append(renderSection(section, width));
  }

  if (sectionOverflows(sections, expanded)) {
    lines.push(
      "",
      theme.fg("dim", `${hintKey}  show all`),
    );
  } else if (
    expanded &&
    sections.some((section) => section.items.length > COLLAPSED_ITEM_LINES)
  ) {
    lines.push(
      "",
      theme.fg("dim", `${hintKey}  show less`),
    );
  }

  return lines;
}

function renderBrand(options: {
  contentWidth: number;
  theme: Theme;
  modelLabel?: string;
}): string[] {
  const { contentWidth, theme, modelLabel } = options;
  const tips = renderTips(theme, modelLabel);
  const tipsWidth = Math.max(
    MIN_TIPS_WIDTH,
    ...tips.map((line) => visibleWidth(line)),
  );
  const icon = pickIcon(contentWidth, tipsWidth);
  const painted = paintIcon(icon, theme);
  const sideBySideWidth = iconWidth(icon) + GAP + tipsWidth;
  return contentWidth >= sideBySideWidth
    ? joinColumns(painted, tips, GAP)
    : [...painted, "", ...tips];
}

export function renderWelcome({
  width,
  theme,
  modelLabel,
  resources,
  expanded = false,
}: WelcomeOptions): string[] {
  if (width <= 0) return [];

  const sidePad = Math.min(SIDE_PAD, Math.max(0, Math.floor((width - 1) / 2)));
  const contentWidth = Math.max(1, width - sidePad * 2);
  const body = renderBrand({ contentWidth, theme, modelLabel });
  if (hasResources(resources)) {
    body.push(
      "",
      theme.fg("dim", "─".repeat(contentWidth)),
      ...renderResourceGrid({
        resources,
        theme,
        expanded,
        width: contentWidth,
      }),
    );
  }

  const prefix = " ".repeat(sidePad);
  return ["", ...body, ""].map((line) =>
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

function inspectResourceTexts(panel: ResourcePanel): {
  texts: string[];
  knownChildren: Component[];
} {
  const texts: string[] = [];
  const knownChildren: Component[] = [];
  for (const child of panel.children) {
    if (!isCollapsible(child)) continue;
    const text = child.getCollapsedText();
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
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly modelLabel: string | undefined;

  constructor(tui: TUI, theme: Theme, modelLabel: string | undefined) {
    this.tui = tui;
    this.theme = theme;
    this.modelLabel = modelLabel;
    this.timer = setTimeout(() => this.capture(0), 0);
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
  }

  render(width: number): string[] {
    return renderWelcome({
      width,
      theme: this.theme,
      modelLabel: this.modelLabel,
      resources: this.resources,
      expanded: this.expanded,
    });
  }

  invalidate(): void {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.panel) restoreKnownChildren(this.panel, this.hidden);
    this.hidden = [];
  }

  private capture(attempt: number): void {
    if (this.disposed) return;

    const panel = findResourcePanel(this.tui);
    if (panel) {
      const { texts, knownChildren } = inspectResourceTexts(panel);
      const resources = parseResourceSections(texts);
      const complete = captureIsComplete(resources);
      if (
        hasResources(resources) &&
        (complete || attempt >= MAX_RESOURCE_RETRIES)
      ) {
        this.panel = panel;
        this.hidden = hideKnownChildren(panel, knownChildren);
        this.resources = resources;
        this.tui.requestRender();
      }
    }

    if (attempt >= MAX_RESOURCE_RETRIES) {
      this.timer = undefined;
      return;
    }

    this.timer = setTimeout(
      () => this.capture(attempt + 1),
      RESOURCE_POLL_MS,
    );
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
