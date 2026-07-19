import assert from "node:assert/strict"
import { test } from "node:test"
import type { Component } from "@earendil-works/pi-tui"
import {
  adoptClusterSiblings,
  isProbeComponent,
  PROBE_BRAND,
} from "../src/index.ts"

function component(label: string, brandProbe = false): Component {
  const value: Component = {
    render: () => [label],
    invalidate: () => {},
  }
  if (brandProbe) Reflect.set(value, PROBE_BRAND, true)
  return value
}

test("isProbeComponent detects the probe brand", () => {
  const probe = component("probe", true)
  const other = component("other")
  assert.equal(isProbeComponent(probe), true)
  assert.equal(isProbeComponent(other), false)
})

test("adoption skips probe immediately above the editor", () => {
  const status = component("status")
  const above = component("above")
  const probe = component("probe", true)
  const editor = component("editor")
  const below = component("below")
  const footer = component("footer")
  const children = [status, above, probe, editor, below, footer]

  const adopted = adoptClusterSiblings(children, 3)

  assert.equal(adopted.status, status)
  assert.equal(adopted.aboveWidget, above)
  assert.equal(adopted.editor, editor)
  assert.equal(adopted.belowWidget, below)
  assert.equal(adopted.footer, footer)
  assert.ok(!Object.values(adopted).includes(probe))
})

test("adoption fills status/above/editor/below/footer in full layout", () => {
  const status = component("status")
  const above = component("above")
  const editor = component("editor")
  const below = component("below")
  const footer = component("footer")

  const adopted = adoptClusterSiblings(
    [status, above, editor, below, footer],
    2,
  )

  assert.deepEqual(
    [
      adopted.status,
      adopted.aboveWidget,
      adopted.editor,
      adopted.belowWidget,
      adopted.footer,
    ],
    [status, above, editor, below, footer],
  )
})

test("adoption leaves missing optional slots as null", () => {
  const editor = component("editor")
  const below = component("below")

  const adopted = adoptClusterSiblings([editor, below], 0)

  assert.equal(adopted.status, null)
  assert.equal(adopted.aboveWidget, null)
  assert.equal(adopted.editor, editor)
  assert.equal(adopted.belowWidget, below)
  assert.equal(adopted.footer, null)
})

test("adoption leaves unrelated leading children alone", () => {
  const unrelated = component("unrelated")
  const status = component("status")
  const above = component("above")
  const editor = component("editor")

  const adopted = adoptClusterSiblings(
    [unrelated, status, above, editor],
    3,
  )

  assert.equal(adopted.status, status)
  assert.equal(adopted.aboveWidget, above)
  assert.equal(adopted.editor, editor)
  assert.notEqual(adopted.status, unrelated)
  assert.notEqual(adopted.aboveWidget, unrelated)
})

test("adoption skips probe below the editor when present", () => {
  const editor = component("editor")
  const probe = component("probe", true)
  const below = component("below")
  const footer = component("footer")

  const adopted = adoptClusterSiblings([editor, probe, below, footer], 0)

  assert.equal(adopted.belowWidget, below)
  assert.equal(adopted.footer, footer)
  assert.ok(!Object.values(adopted).includes(probe))
})
