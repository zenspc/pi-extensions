import {
  CURSOR_MARKER,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui"

export interface FixedEditorClusterInput {
  width: number
  terminalRows: number
  statusLines?: string[]
  aboveWidgetLines?: string[]
  editorLines: string[]
  belowWidgetLines?: string[]
  footerLines?: string[]
}

export interface FixedEditorCursor {
  row: number
  col: number
}

export interface FixedEditorClusterRender {
  lines: string[]
  cursor: FixedEditorCursor | null
}

function normalizeLines(lines: string[] | undefined, width: number): string[] {
  if (!lines || width <= 0) return []

  return lines
    .filter((line) => line !== undefined && line !== null)
    .map((line) =>
      visibleWidth(line) > width
        ? truncateToWidth(line, width, "", true)
        : line,
    )
}

function takeTail(lines: string[], count: number): string[] {
  if (count <= 0) return []
  return lines.length <= count ? lines : lines.slice(lines.length - count)
}

function capEditorLines(lines: string[], count: number): string[] {
  if (count <= 0) return []
  if (lines.length <= count) return lines

  const cursorRow = lines.findIndex((line) => line.includes(CURSOR_MARKER))
  if (cursorRow !== -1) {
    const start = Math.max(
      0,
      Math.min(cursorRow - count + 1, lines.length - count),
    )
    return lines.slice(start, start + count)
  }

  return lines.slice(lines.length - count)
}

function extractCursor(lines: string[]): FixedEditorClusterRender {
  let cursor: FixedEditorCursor | null = null
  const cleaned = lines.map((line, row) => {
    const markerIndex = line.indexOf(CURSOR_MARKER)
    if (markerIndex === -1) return line

    cursor ??= {
      row,
      col: visibleWidth(line.slice(0, markerIndex)),
    }

    return (
      line.slice(0, markerIndex) +
      line.slice(markerIndex + CURSOR_MARKER.length)
    )
  })

  return { lines: cleaned, cursor }
}

export function renderFixedEditorCluster(
  input: FixedEditorClusterInput,
): FixedEditorClusterRender {
  const width = Math.max(1, input.width)
  const maxRows = Math.max(1, input.terminalRows - 1)

  const statusLines = normalizeLines(input.statusLines, width)
  const aboveWidgetLines = normalizeLines(input.aboveWidgetLines, width)
  const editorSource = normalizeLines(input.editorLines, width)
  const belowWidgetLines = normalizeLines(input.belowWidgetLines, width)
  const footerLines = normalizeLines(input.footerLines, width)

  const editorLines = capEditorLines(editorSource, maxRows)
  let remaining = maxRows - editorLines.length

  const footer = takeTail(footerLines, remaining)
  remaining -= footer.length

  const belowWidgets = takeTail(belowWidgetLines, remaining)
  remaining -= belowWidgets.length

  const aboveWidgets = takeTail(aboveWidgetLines, remaining)
  remaining -= aboveWidgets.length

  const status = takeTail(statusLines, remaining)

  return extractCursor([
    ...status,
    ...aboveWidgets,
    ...editorLines,
    ...belowWidgets,
    ...footer,
  ])
}
