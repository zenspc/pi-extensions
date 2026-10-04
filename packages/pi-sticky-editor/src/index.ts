import {
  copyToClipboard,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import type { Component } from "@earendil-works/pi-tui"
import { visibleWidth } from "@earendil-works/pi-tui"
import { renderFixedEditorCluster } from "./cluster.ts"
import {
  emergencyTerminalModeReset,
  TerminalSplitCompositor,
  type TerminalLike,
} from "./terminal-split.ts"

const WIDGET_KEY = "pi-fixed-editor-probe"
const WARNING_MESSAGE = "pi-fixed-editor: unsupported Pi TUI layout"

/** Brand set on the install probe so sibling adoption never hides it. */
export const PROBE_BRAND = Symbol.for("pi-sticky-editor.probe")

interface ContainerLike extends Component {
  children: Component[]
}

interface TuiLike {
  children: Component[]
  terminal?: TerminalLike
  focusedComponent?: Component | null
  requestRender: (force?: boolean) => void
  getShowHardwareCursor?: () => boolean
}

interface ContainerMatch {
  container: ContainerLike
  index: number
}

export interface AdoptedClusterSiblings {
  status: Component | null
  aboveWidget: Component | null
  editor: Component
  belowWidget: Component | null
  footer: Component | null
}

let compositor: TerminalSplitCompositor | null = null
let isInstalled = false
let didWarnUnsupported = false
let fixedStatusContainer: Component | null = null
let fixedWidgetContainerAbove: Component | null = null
let fixedEditorContainer: Component | null = null
let fixedWidgetContainerBelow: Component | null = null
let fixedFooterContainer: Component | null = null

class ProbeComponent implements Component {
  private readonly install: () => void
  private hasQueuedInstall = false

  constructor(onInstall: () => void) {
    this.install = onInstall
    Reflect.set(this, PROBE_BRAND, true)
  }

  render(): string[] {
    if (!this.hasQueuedInstall) {
      this.hasQueuedInstall = true
      queueMicrotask(this.install)
    }
    return []
  }

  invalidate(): void {
    this.hasQueuedInstall = false
  }
}

function isContainerLike(value: unknown): value is ContainerLike {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray(Reflect.get(value, "children")) &&
    typeof Reflect.get(value, "render") === "function"
  )
}

function isRenderable(value: unknown): value is Component {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "render") === "function" &&
    typeof Reflect.get(value, "invalidate") === "function"
  )
}

export function isProbeComponent(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, PROBE_BRAND) === true
  )
}

function getTuiChildren(tui: TuiLike): Component[] {
  return Array.isArray(tui.children) ? tui.children : []
}

function findContainerWithChild(
  tui: TuiLike,
  child: Component,
): ContainerMatch | null {
  const children = getTuiChildren(tui)
  const index = children.findIndex(
    (candidate) =>
      isContainerLike(candidate) && candidate.children.includes(child),
  )
  if (index === -1) return null

  const container = children[index]
  return isContainerLike(container) ? { container, index } : null
}

export function findEditorContainer(tui: TuiLike): ContainerMatch | null {
  const focusedComponent = Reflect.get(tui, "focusedComponent")
  if (isRenderable(focusedComponent)) {
    const match = findContainerWithChild(tui, focusedComponent)
    if (match) return match
  }

  const children = getTuiChildren(tui)
  const index = children.findIndex((candidate) => {
    if (!isContainerLike(candidate)) return false
    return candidate.children.some((child) => {
      return (
        typeof Reflect.get(child, "getText") === "function" &&
        typeof Reflect.get(child, "setText") === "function" &&
        typeof Reflect.get(child, "handleInput") === "function"
      )
    })
  })

  if (index === -1) return null
  const container = children[index]
  return isContainerLike(container) ? { container, index } : null
}

/**
 * Adopt status / above / below / footer siblings around the editor.
 * Walks contiguous neighbors, skipping the install probe brand.
 * Order relative to editor: status, aboveWidget, editor, belowWidget, footer.
 */
export function adoptClusterSiblings(
  children: readonly Component[],
  editorIndex: number,
): AdoptedClusterSiblings {
  const editor = children[editorIndex]
  if (!editor) {
    throw new Error(
      "[pi-sticky-editor] adoptClusterSiblings: editor index out of range",
    )
  }

  let aboveWidget: Component | null = null
  let status: Component | null = null
  let aboveSlots = 0
  for (let i = editorIndex - 1; i >= 0 && aboveSlots < 2; i--) {
    const candidate = children[i]
    if (!candidate || isProbeComponent(candidate)) continue
    if (aboveSlots === 0) aboveWidget = candidate
    else status = candidate
    aboveSlots += 1
  }

  let belowWidget: Component | null = null
  let footer: Component | null = null
  let belowSlots = 0
  for (let i = editorIndex + 1; i < children.length && belowSlots < 2; i++) {
    const candidate = children[i]
    if (!candidate || isProbeComponent(candidate)) continue
    if (belowSlots === 0) belowWidget = candidate
    else footer = candidate
    belowSlots += 1
  }

  return { status, aboveWidget, editor, belowWidget, footer }
}

function renderHidden(
  activeCompositor: TerminalSplitCompositor,
  component: Component | null,
  width: number,
): string[] {
  if (!component) return []
  return activeCompositor
    .renderHidden(component, width)
    .filter((line) => visibleWidth(line) > 0)
}

function resetContainers(): void {
  fixedStatusContainer = null
  fixedWidgetContainerAbove = null
  fixedEditorContainer = null
  fixedWidgetContainerBelow = null
  fixedFooterContainer = null
}

export function teardownFixedEditor(options?: {
  resetExtendedKeyboardModes?: boolean
}): void {
  const hadCompositor = compositor !== null
  compositor?.dispose(options)
  if (!hadCompositor && options?.resetExtendedKeyboardModes) {
    try {
      process.stdout.write(emergencyTerminalModeReset())
    } catch {
      // Exit cleanup cannot surface useful terminal write failures.
    }
  }
  compositor = null
  isInstalled = false
  resetContainers()
}

function warnUnsupported(onUnsupported?: () => void): void {
  onUnsupported?.()
}

export interface InstallFixedEditorOptions {
  tui: TuiLike
  onCopySelection?: (text: string) => void
  onUnsupported?: () => void
}

/**
 * Install the sticky-editor compositor against a live TUI.
 * Returns true when patches were applied.
 */
export function installFixedEditor(
  options: InstallFixedEditorOptions,
): boolean {
  if (isInstalled || compositor) return false

  const { tui } = options
  const terminal = tui.terminal
  if (!terminal || typeof terminal.write !== "function") {
    warnUnsupported(options.onUnsupported)
    return false
  }

  const editorMatch = findEditorContainer(tui)
  if (!editorMatch) {
    warnUnsupported(options.onUnsupported)
    return false
  }

  const siblings = adoptClusterSiblings(getTuiChildren(tui), editorMatch.index)
  fixedStatusContainer = siblings.status
  fixedWidgetContainerAbove = siblings.aboveWidget
  fixedEditorContainer = siblings.editor
  fixedWidgetContainerBelow = siblings.belowWidget
  fixedFooterContainer = siblings.footer

  let nextCompositor: TerminalSplitCompositor
  try {
    nextCompositor = new TerminalSplitCompositor({
      tui,
      terminal,
      onCopySelection: options.onCopySelection,
      getShowHardwareCursor: () =>
        typeof tui.getShowHardwareCursor === "function" &&
        tui.getShowHardwareCursor(),
      renderCluster: (width, terminalRows) =>
        renderFixedEditorCluster({
          width,
          terminalRows,
          statusLines: renderHidden(
            nextCompositor,
            fixedStatusContainer,
            width,
          ),
          aboveWidgetLines: renderHidden(
            nextCompositor,
            fixedWidgetContainerAbove,
            width,
          ),
          editorLines: renderHidden(
            nextCompositor,
            fixedEditorContainer,
            width,
          ),
          belowWidgetLines: renderHidden(
            nextCompositor,
            fixedWidgetContainerBelow,
            width,
          ),
          footerLines: renderHidden(
            nextCompositor,
            fixedFooterContainer,
            width,
          ),
        }),
    })

    compositor = nextCompositor
    // Hide only adopted cluster nodes + editor - never the probe.
    if (fixedStatusContainer) nextCompositor.hideRenderable(fixedStatusContainer)
    if (fixedWidgetContainerAbove)
      nextCompositor.hideRenderable(fixedWidgetContainerAbove)
    if (fixedEditorContainer) nextCompositor.hideRenderable(fixedEditorContainer)
    if (fixedWidgetContainerBelow)
      nextCompositor.hideRenderable(fixedWidgetContainerBelow)
    if (fixedFooterContainer) nextCompositor.hideRenderable(fixedFooterContainer)

    nextCompositor.install()
    isInstalled = true
    tui.requestRender(true)
    return true
  } catch {
    teardownFixedEditor({ resetExtendedKeyboardModes: true })
    warnUnsupported(options.onUnsupported)
    return false
  }
}

function install(ctx: ExtensionContext, tui: TuiLike): void {
  if (ctx.mode !== "tui") return

  installFixedEditor({
    tui,
    onCopySelection: (text) => {
      void copyToClipboard(text)
    },
    onUnsupported: () => {
      if (didWarnUnsupported || ctx.mode !== "tui") return
      didWarnUnsupported = true
      ctx.ui.notify(WARNING_MESSAGE, "warning")
    },
  })
}

export default function fixedEditor(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    didWarnUnsupported = false
    if (ctx.mode !== "tui") return

    ctx.ui.setWidget(
      WIDGET_KEY,
      (tui) => {
        const tuiLike = tui as unknown as TuiLike
        return new ProbeComponent(() => install(ctx, tuiLike))
      },
      { placement: "aboveEditor" },
    )
  })

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") {
      ctx.ui.setWidget(WIDGET_KEY, undefined)
    }
    teardownFixedEditor({ resetExtendedKeyboardModes: true })
  })
}
