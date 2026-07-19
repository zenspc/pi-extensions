import assert from "node:assert/strict"
import { mock, test } from "node:test"
import { type Component, type Terminal, TUI } from "@earendil-works/pi-tui"
import {
  buildFixedClusterPaint,
  emergencyTerminalModeReset,
  planClipboardRestore,
  resetScrollRegion,
  setScrollRegion,
  TerminalSplitCompositor,
  type TerminalLike,
} from "../src/terminal-split.ts"

test("renders terminal scroll region escape sequences", () => {
  assert.equal(setScrollRegion(1, 20), "\x1b[1;20r")
  assert.equal(resetScrollRegion(), "\x1b[r")
})

test("paints the fixed cluster at the bottom of the terminal", () => {
  const output = buildFixedClusterPaint(
    { lines: ["editor", "footer"], cursor: null },
    10,
    80,
    false,
  )

  assert.ok(output.includes("\x1b[9;1H"))
  assert.ok(output.includes("editor"))
  assert.ok(output.includes("\x1b[10;1H"))
  assert.ok(output.includes("footer"))
})

test("emergency reset restores terminal modes", () => {
  const output = emergencyTerminalModeReset()

  assert.ok(output.includes("\x1b[r"))
  assert.ok(output.includes("\x1b[?1006l"))
  assert.ok(output.includes("\x1b[?1049l"))
})

test("scrolls synchronously and deletes Kitty images that leave the viewport", () => {
  const writes: string[] = []
  let scheduledRenders = 0
  const terminal: Terminal = {
    columns: 80,
    rows: 6,
    kittyProtocolActive: false,
    start: () => {},
    stop: () => {},
    drainInput: async () => {},
    write: (data) => writes.push(data),
    moveBy: () => {},
    hideCursor: () => {},
    showCursor: () => {},
    clearLine: () => {},
    clearFromCursor: () => {},
    clearScreen: () => {},
    setTitle: () => {},
    setProgress: () => {},
  }
  const imageId = 42
  const image = `\x1b_Ga=T,f=100,q=2,C=1,c=10,r=2,i=${imageId};AAAA\x1b\\`
  const rootLines = [
    image,
    "",
    "line 2",
    "line 3",
    "line 4",
    "line 5",
    "line 6",
    "line 7",
  ]
  const root: Component = {
    render: () => rootLines,
    invalidate: () => {},
  }
  const tui = new TUI(terminal)
  tui.addChild(root)
  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["editor", "footer"], cursor: null }),
  })
  const handleInput = Reflect.get(tui, "handleInput")
  assert.equal(typeof handleInput, "function")

  compositor.install()
  try {
    Reflect.get(tui, "doRender").call(tui)
    tui.requestRender = () => {
      scheduledRenders += 1
    }
    writes.length = 0

    handleInput.call(tui, "\x1b[5~")
    assert.notEqual(writes.length, 0)
    assert.equal(scheduledRenders, 0)
    writes.length = 0

    handleInput.call(tui, "\x1b[6~")

    assert.match(
      writes.join(""),
      new RegExp(`\\x1b_Ga=d,d=I,i=${imageId},q=2\\x1b\\\\`),
    )
  } finally {
    compositor.dispose({ resetExtendedKeyboardModes: true })
  }
})

test("plain enter scrolls the transcript back to the bottom", () => {
  let inputListener:
    | ((data: string) => { consume?: boolean } | undefined)
    | null = null
  let renderRequests = 0
  const rootLines = Array.from({ length: 10 }, (_, index) => `line ${index}`)
  const terminal: TerminalLike = {
    columns: 80,
    rows: 6,
    write: () => {},
  }
  const tui = {
    children: [],
    render: () => rootLines,
    requestRender: () => {
      renderRequests += 1
    },
    addInputListener: (
      listener: (data: string) => { consume?: boolean } | undefined,
    ) => {
      inputListener = listener
      return () => {
        inputListener = null
      }
    },
    hasOverlay: () => false,
  }
  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["editor", "footer"], cursor: null }),
  })

  compositor.install()
  try {
    assert.ok(inputListener)
    assert.equal(inputListener("\x1b[5~")?.consume, true)
    assert.deepEqual(tui.render(), ["line 0", "line 1", "line 2", "line 3"])
    renderRequests = 0

    assert.equal(inputListener("\r"), undefined)

    assert.deepEqual(tui.render(), ["line 6", "line 7", "line 8", "line 9"])
    assert.equal(renderRequests, 1)
  } finally {
    compositor.dispose({ resetExtendedKeyboardModes: true })
  }
})

test("does not patch tui.compositeLineAt (tabs handled by pi-tui)", () => {
  const calls: Array<{ base: string; overlay: string }> = []
  const originalCompositeLineAt = (
    baseLine: string,
    overlayLine: string,
    _startCol: number,
    _overlayWidth: number,
    _totalWidth: number,
  ) => {
    calls.push({ base: baseLine, overlay: overlayLine })
    return baseLine
  }
  const terminal: TerminalLike = {
    columns: 80,
    rows: 10,
    write: () => {},
  }
  const tui = {
    children: [],
    compositeLineAt: originalCompositeLineAt,
    hasOverlay: () => false,
  }
  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["editor"], cursor: null }),
  })

  compositor.install()
  try {
    assert.equal(tui.compositeLineAt, originalCompositeLineAt)
    tui.compositeLineAt("base\tline", "over\tlay", 0, 4, 80)
    assert.deepEqual(calls, [{ base: "base\tline", overlay: "over\tlay" }])
  } finally {
    compositor.dispose({ resetExtendedKeyboardModes: true })
  }
})

test("terminal.rows memoizes cluster height between identical reads", () => {
  let clusterRenders = 0
  const terminal: TerminalLike = {
    columns: 80,
    rows: 10,
    write: () => {},
  }
  const tui = {
    children: [],
    hasOverlay: () => false,
  }
  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => {
      clusterRenders += 1
      return { lines: ["editor", "footer"], cursor: null }
    },
  })

  compositor.install()
  try {
    const first = terminal.rows
    const afterFirst = clusterRenders
    assert.ok(afterFirst >= 1)
    assert.equal(terminal.rows, first)
    assert.equal(clusterRenders, afterFirst)

    // hideRenderable invalidates the memo
    const hidden: Component = {
      render: () => ["x"],
      invalidate: () => {},
    }
    compositor.hideRenderable(hidden)
    assert.equal(terminal.rows, first)
    assert.ok(clusterRenders > afterFirst)
  } finally {
    compositor.dispose({ resetExtendedKeyboardModes: true })
  }
})

test("clipboard restore plan is immediate plus one delayed copy", () => {
  assert.deepEqual(planClipboardRestore({ selectedText: "hello", pauseMs: 1200 }), {
    immediate: true,
    delayedAfterMs: 1200,
  })
})

test("right-click copy schedules at most one delayed clipboard restore", () => {
  mock.timers.enable({ apis: ["setTimeout"], now: 0 })
  try {
    const copies: string[] = []
    let inputListener:
      | ((data: string) => { consume?: boolean } | undefined)
      | null = null
    const rootLines = ["alpha beta gamma"]
    const terminal: TerminalLike = {
      columns: 40,
      rows: 6,
      write: () => {},
    }
    const tui = {
      children: [],
      render: () => rootLines,
      requestRender: () => {},
      addInputListener: (
        listener: (data: string) => { consume?: boolean } | undefined,
      ) => {
        inputListener = listener
        return () => {
          inputListener = null
        }
      },
      hasOverlay: () => false,
    }
    const compositor = new TerminalSplitCompositor({
      tui,
      terminal,
      onCopySelection: (text) => {
        copies.push(text)
      },
      renderCluster: () => ({ lines: ["editor", "footer"], cursor: null }),
    })

    compositor.install()
    try {
      assert.ok(inputListener)
      // Force a root-window so selection line 0 exists.
      tui.render(40)

      // Double-click line to select whole line, then right-click inside it.
      inputListener("\x1b[<0;1;1M")
      inputListener("\x1b[<0;1;1m")
      inputListener("\x1b[<0;1;1M")
      inputListener("\x1b[<0;1;1m")
      assert.ok(copies.length >= 1)
      const selected = copies.at(-1) ?? ""
      assert.ok(selected.length > 0)
      copies.length = 0

      inputListener("\x1b[<2;2;1M")
      assert.deepEqual(copies, [selected])

      mock.timers.tick(1199)
      assert.deepEqual(copies, [selected])
      mock.timers.tick(1)
      assert.deepEqual(copies, [selected, selected])

      mock.timers.tick(10_000)
      assert.deepEqual(copies, [selected, selected])
    } finally {
      compositor.dispose({ resetExtendedKeyboardModes: true })
    }
  } finally {
    mock.timers.reset()
  }
})
