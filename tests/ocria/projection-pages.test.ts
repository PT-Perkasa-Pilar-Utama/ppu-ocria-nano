// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The `#[cfg(test)]` tests of liteparse projection.rs that go through
// `project_pages_to_grid`, plus the rotation tests.

import { describe, expect, test } from "bun:test";

import { projectPagesToGrid } from "../../src/ocria/projection/index.js";
import { newProjectedItem } from "../../src/ocria/projection/projected-item.js";
import {
  canonicalRotation,
  handleRotationReadingOrder,
} from "../../src/ocria/projection/rotation.js";
import type { ProjSignals } from "../../src/ocria/projection/signals.js";
import type { ProjectedTextItem } from "../../src/ocria/projection/types.js";
import { f32, totalCmp } from "../../src/ocria/rust.js";
import type { Page } from "../../src/ocria/types/page.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import type { TextItem } from "../../src/ocria/types/text-item.js";

function pageOf(textItems: TextItem[]): Page {
  return {
    page_number: 1,
    page_width: 612,
    page_height: 792,
    text_items: textItems,
    graphics: [],
    struct_nodes: [],
    image_refs: [],
  };
}

/** A text item whose numbers are f32 literals, as in the Rust tests. */
function ti(text: string, x: number, y: number, width: number, height: number): TextItem {
  return textItem({ text, x: f32(x), y: f32(y), width: f32(width), height: f32(height) });
}

function itemAt(text: string, x: number, y: number, w: number, h: number): ProjectedTextItem {
  return newProjectedItem(ti(text, x, y, w, h));
}

describe("project_pages_to_grid", () => {
  test("handles a page with no text items", () => {
    const parsed = projectPagesToGrid([pageOf([])]);
    expect(parsed.length).toBe(1);
    expect(parsed[0].text).toBe("");
    expect(parsed[0].text_items).toEqual([]);
  });

  test("unions the original bbox when word items merge", () => {
    const y = 50.25;
    const parsed = projectPagesToGrid([
      pageOf([ti("A", 10, y, 10, 8), ti("B", 24, f32(y + f32(0.01)), 8, 7.5)]),
    ]);
    const item = parsed[0].text_items.find((i) => i.text === "A B");
    expect(item).toBeDefined();
    expect(Math.abs((item?.x ?? 0) - 10)).toBeLessThan(0.001);
    expect(Math.abs((item?.y ?? 0) - y)).toBeLessThan(0.001);
    expect(Math.abs((item?.width ?? 0) - 22)).toBeLessThan(0.001);
    expect(Math.abs((item?.height ?? 0) - 8)).toBeLessThan(0.001);
  });

  test("concatenates word boxes when items merge", () => {
    // Regression for #361: two items that merge into one must carry both
    // items' per-word sub-boxes.
    const y = 50.25;
    const a = ti("A", 10, y, 10, 8);
    a.words = [{ text: "A", x: 10, y: f32(y), width: 10, height: 8 }];
    const y2 = f32(y + f32(0.01));
    const b = ti("B", 24, y2, 8, 7.5);
    b.words = [{ text: "B", x: 24, y: y2, width: 8, height: 7.5 }];
    const parsed = projectPagesToGrid([pageOf([a, b])]);
    const item = parsed[0].text_items.find((i) => i.text === "A B");
    expect(item?.words.map((w) => w.text)).toEqual(["A", "B"]);
  });

  test("unions the original bbox when continuous items merge", () => {
    const parsed = projectPagesToGrid([
      pageOf([ti("ab", 40, 100, 10.2, 9), ti("cd", 50.2, 100, 12.3, 9)]),
    ]);
    const item = parsed[0].text_items.find((i) => i.text === "abcd");
    expect(item).toBeDefined();
    expect(Math.abs((item?.x ?? 0) - 40)).toBeLessThan(0.001);
    expect(Math.abs((item?.y ?? 0) - 100)).toBeLessThan(0.001);
    expect(Math.abs((item?.width ?? 0) - 22.5)).toBeLessThan(0.01);
    expect(Math.abs((item?.height ?? 0) - 9)).toBeLessThan(0.01);
  });

  test("joins glyph residuals and preserves word gaps", () => {
    let x = 40;
    const items: TextItem[] = [];
    for (const [text, width, gap] of [
      ["F", 4.26848, 0.006],
      ["inancials", 28.2, 1.95],
      ["Sector", 20.4, 0],
    ] as const) {
      items.push(ti(text, x, 100, width, 6.9975));
      x = f32(x + f32(f32(width) + f32(gap)));
    }
    const parsed = projectPagesToGrid([pageOf(items)]);
    expect(parsed[0].text.split(/\s+/)).toEqual(["Financials", "Sector"]);
  });

  test("lines index the returned text items", () => {
    const items: TextItem[] = [];
    for (let row = 0; row < 5; row++) {
      const y = f32(100 + row * 14);
      for (const [text, x] of [
        [`left${row}`, 50],
        [`right${row}`, 350],
      ] as const) {
        items.push(ti(text, x, y, 200, 10));
      }
    }
    const page = projectPagesToGrid([pageOf(items)])[0];
    const seen: number[] = [];
    for (const line of page.projected_lines) {
      expect(line.spans.length).toBe(line.span_item_indices.length);
      line.spans.forEach((span, k) => {
        const i = line.span_item_indices[k];
        expect(page.text_items[i].text).toBe(span.text);
        seen.push(i);
      });
    }
    seen.sort((a, b) => a - b);
    expect(seen).toEqual(page.text_items.map((_, i) => i));
  });

  test("a page with rotated text records projected item frames", () => {
    const rotated = ti("up", 100, 100, 10, 50);
    rotated.rotation = 90;
    const parsed = projectPagesToGrid([pageOf([ti("body", 10, 10, 40, 10), rotated])]);
    expect(parsed[0].projected_item_frames.length).toBe(2);
    // The frame pairs the projected box with the original one; text_items keep the original box.
    expect(parsed[0].text_items.find((i) => i.text === "up")?.rotation).toBe(90);
  });

  test("collects signals only when asked", () => {
    const page = pageOf([ti("hello", 10, 10, 40, 10), ti("world", 60, 10, 40, 10)]);
    const signals = new Map<number, ProjSignals>();
    projectPagesToGrid([page], signals);
    expect([...signals.keys()]).toEqual([1]);
    expect(signals.get(1)?.items.map((i) => i.text)).toEqual(["hello", "world"]);
    expect(signals.get(1)?.width).toBe(612);
  });
});

describe("rotation reading order", () => {
  test("tied rotated groups follow spatial then input order", () => {
    // Both rotations have top and bottom clusters at the same x.
    // Clusters at the same y retain the order of their first input item.
    const items: ProjectedTextItem[] = [];
    for (const [text, y, rotation] of [
      ["bottom-first", 300, 90],
      ["top-first", 20, 270],
      ["top-second", 20, 90],
      ["bottom-second", 300, 270],
    ] as const) {
      const item = itemAt(text, 500, y, 5, 50);
      item.item.rotation = rotation;
      items.push(item);
    }
    handleRotationReadingOrder(items, 100);
    items.sort((a, b) => totalCmp(a.item.y, b.item.y));
    expect(items.map((p) => p.item.text)).toEqual([
      "top-first",
      "top-second",
      "bottom-first",
      "bottom-second",
    ]);
  });

  test("restacked rotated groups do not compound canvas offsets", () => {
    // Restacked 90 degree labels alternating with off-axis markers (map exports) must
    // grow the canvas linearly, not double per label.
    const pageHeight = 4000;
    const pairs = 30;
    const items = [itemAt("heading", 100, 40, 200, 12)];
    for (let i = 0; i < pairs; i++) {
      const x = f32(200 + f32(60 * i));
      const y = f32(150 + f32(100 * i));
      const marker = itemAt("m", f32(x - 30), y, 6, 6);
      marker.item.rotation = f32(30 + i);
      items.push(marker);
      const label = itemAt("label", x, y, 10, 22);
      label.item.rotation = 90;
      items.push(label);
    }
    handleRotationReadingOrder(items, pageHeight);
    const bottom = items.reduce((m, p) => Math.max(m, f32(p.item.y + p.item.height)), -Infinity);
    const linearBound = pairs * 3 * (pageHeight + 2000);
    expect(Number.isFinite(bottom) && bottom < linearBound).toBe(true);
  });

  test("a rotated group beside body text stays inline on one row", () => {
    const items = [
      itemAt("body", 100, 100, 200, 10),
      itemAt("p1", 120, 95, 6, 30),
      itemAt("p2", 160, 100, 6, 30),
    ];
    items[1].item.rotation = 90;
    items[2].item.rotation = 90;
    handleRotationReadingOrder(items, 792);
    const labels = items.filter((p) => p.item.text.startsWith("p"));
    expect(labels.every((p) => p.rotated && p.item.rotation === 0)).toBe(true);
    expect(labels[0].item.y).toBe(labels[1].item.y);
    // The group is laid out sideways, so the box height becomes the average width.
    expect(labels[0].item.height).toBe(6);
  });

  test("a 180 degree group is normalized without moving", () => {
    const items = [itemAt("down", 100, 100, 50, 10), itemAt("up", 10, 10, 50, 10)];
    items[0].item.rotation = 180;
    handleRotationReadingOrder(items, 792);
    const down = items.find((p) => p.item.text === "down");
    expect(down?.item.rotation).toBe(0);
    expect(down?.rotated).toBe(true);
    expect(down?.item.x).toBe(100);
  });

  test("a page without rotation is left alone", () => {
    const items = [itemAt("b", 50, 50, 10, 10), itemAt("a", 10, 10, 10, 10)];
    handleRotationReadingOrder(items, 792);
    expect(items.map((p) => p.item.text)).toEqual(["b", "a"]);
  });
});

describe("canonical_rotation", () => {
  test("snaps cardinals and near-cardinals", () => {
    // Exact cardinals are unchanged.
    expect([0, 90, 180, 270].map(canonicalRotation)).toEqual([0, 90, 180, 270]);
    // Small offsets within the 2 degree tolerance snap to the nearest cardinal.
    expect(canonicalRotation(1)).toBe(0);
    expect(canonicalRotation(f32(88.5))).toBe(90);
    expect(canonicalRotation(271)).toBe(270);
  });

  test("snaps near 360 to zero", () => {
    // Rotations just under 360 degrees are ~upright and must snap to 0, not be
    // treated as ~270 (regression: linear distance picked 270 for 359).
    for (const r of [358, 359, f32(359.5), 360, -1]) expect(canonicalRotation(r)).toBe(0);
  });

  test("passes through non-cardinal angles", () => {
    // Beyond the 2 degree snap tolerance the rounded raw angle is returned,
    // including angles near (but not within tolerance of) 360.
    expect(canonicalRotation(45)).toBe(45);
    expect(canonicalRotation(357)).toBe(357);
  });
});
