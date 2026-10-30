import assert from "node:assert/strict"
import { mock, test } from "node:test"
import type { Component } from "@earendil-works/pi-tui"
import {
  findEditorContainer,
  installFixedEditor,
  teardownFixedEditor,
} from "../src/index.ts"

function makeEditorChild(): Component & {
  getText: () => string
  setText: (value: string) => void
  handleInput: (data: string) => void
} {
  return {
    render: () => ["editor"],
    invalidate: () => {},
    getText: () => "",
    setText: () => {},
    handleInput: () => {},
  }
}

function makeContainer(children: Component[]): Component & {
  children: Component[]
} {
  return {
    children,
    render: () => children.flatMap((child) => child.render(80)),
    invalidate: () => {},
  }
}

function makeTerminal(rawRows = 24) {
  const writes: string[] = []
  const terminal = {
    columns: 80,
    rows: rawRows,
    write(data: string) {
      writes.push(data)
    },
  }
  return { terminal, writes }
}

function makeTui(options: {
  terminal: { columns: number; rows: number; write: (data: string) => void }
  children: Component[]
  withRenderHooks?: boolean
}) {
  const originalRender = (width: number) =>
    Array.from({ length: 6 }, (_, i) => `root ${i} w=${width}`)
  const originalDoRender = () => {}
  let renderCalls = 0

  const tui = {
    children: options.children,
    terminal: options.terminal,
    focusedComponent: null as Component | null,
    requestRender: () => {
      renderCalls += 1
    },
    render: options.withRenderHooks === false ? undefined : originalRender,
    doRender: options.withRenderHooks === false ? undefined : originalDoRender,
    addInputListener: (
      _listener: (data: string) => { consume?: boolean } | undefined,
    ) => {
      return () => {}
    },
    hasOverlay: () => false,
  }

  return { tui, originalRender, originalDoRender, getRenderCalls: () => renderCalls }
}

function layoutWithEditor() {
  const editorChild = makeEditorChild()
  const status = makeContainer([])
  const above = makeContainer([])
  const editor = makeContainer([editorChild])
  const below = makeContainer([])
  const footer = makeContainer([])
  return {
    children: [status, above, editor, below, footer],
    editor,
    editorChild,
  }
}

test("findEditorContainer locates the editor by getText/setText/handleInput", () => {
  const { children, editor } = layoutWithEditor()
  const match = findEditorContainer({
    children,
    requestRender: () => {},
  })
  assert.ok(match)
  assert.equal(match.container, editor)
  assert.equal(match.index, 2)
})

test("install patches terminal.rows and terminal.write; teardown restores them", () => {
  teardownFixedEditor()
  const { terminal } = makeTerminal(20)
  const originalWrite = terminal.write
  const originalRowsDescriptor = Object.getOwnPropertyDescriptor(terminal, "rows")
  const { children } = layoutWithEditor()
  const { tui, originalRender, originalDoRender } = makeTui({
    terminal,
    children,
  })

  const exitBefore = process.listeners("exit").length

  try {
    assert.equal(
      installFixedEditor({
        tui,
        onCopySelection: () => {},
      }),
      true,
    )

    assert.notEqual(terminal.write, originalWrite)
    const installedRows = Object.getOwnPropertyDescriptor(terminal, "rows")
    assert.equal(typeof installedRows?.get, "function")
    assert.notEqual(tui.render, originalRender)
    assert.notEqual(tui.doRender, originalDoRender)
    assert.ok(process.listeners("exit").length >= exitBefore)
  } finally {
    teardownFixedEditor({ resetExtendedKeyboardModes: true })
  }

  assert.equal(terminal.write, originalWrite)
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(terminal, "rows"),
    originalRowsDescriptor,
  )
  assert.equal(tui.render, originalRender)
  assert.equal(tui.doRender, originalDoRender)
  assert.equal(process.listeners("exit").length, exitBefore)
})

test("re-install after teardown succeeds", () => {
  teardownFixedEditor()
  const { terminal } = makeTerminal()
  const { children } = layoutWithEditor()
  try {
    const first = makeTui({ terminal, children })
    assert.equal(installFixedEditor({ tui: first.tui }), true)
    teardownFixedEditor({ resetExtendedKeyboardModes: true })

    const second = makeTui({ terminal, children })
    assert.equal(installFixedEditor({ tui: second.tui }), true)
  } finally {
    teardownFixedEditor({ resetExtendedKeyboardModes: true })
  }
})

test("install without editor calls onUnsupported and does not throw", () => {
  teardownFixedEditor()
  const { terminal } = makeTerminal()
  const empty = makeContainer([])
  const { tui } = makeTui({ terminal, children: [empty] })
  let unsupported = 0

  assert.equal(
    installFixedEditor({
      tui,
      onUnsupported: () => {
        unsupported += 1
      },
    }),
    false,
  )
  assert.equal(unsupported, 1)
})

test("teardown mid-timer clears mouse/clipboard restore timers", () => {
  teardownFixedEditor()
  mock.timers.enable({ apis: ["setTimeout"] })
  try {
    const { terminal } = makeTerminal()
    const { children } = layoutWithEditor()
    const { tui } = makeTui({ terminal, children })
    const copies: string[] = []

    assert.equal(
      installFixedEditor({
        tui,
        onCopySelection: (text) => {
          copies.push(text)
        },
      }),
      true,
    )

    teardownFixedEditor({ resetExtendedKeyboardModes: true })
    mock.timers.tick(10_000)
    assert.equal(copies.length, 0)
  } finally {
    teardownFixedEditor()
    mock.timers.reset()
  }
})
