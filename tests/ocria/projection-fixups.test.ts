// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Branches of the grid projection that neither the goldens nor the Rust unit
// tests reach: the rotated-label alignment, the per-line flowing sweeps, the
// right-column unsnap, the force-unsnapped render wait, RTL joins and the
// byte-offset margin cut. Expected values are worked out from the Rust code.

import { describe, expect, test } from "bun:test";

import { ForwardAnchors, anchorKey } from "../../src/ocria/projection/anchors.js";
import { detectAndRenderFlowingLines, newBoxMeta } from "../../src/ocria/projection/flowing.js";
import type { BoxMeta } from "../../src/ocria/projection/flowing.js";
import { looksLikeTableNumber } from "../../src/ocria/projection/form-lines-merge.js";
import { renderBlock } from "../../src/ocria/projection/grid-render.js";
import { alignRotatedFloatingItems } from "../../src/ocria/projection/grid-rotated.js";
import { unsnapRightColumnLeftItems } from "../../src/ocria/projection/grid-snaps.js";
import type { GridCtx } from "../../src/ocria/projection/grid-state.js";
import { newProjectedItem } from "../../src/ocria/projection/projected-item.js";
import {
  handleRotationReadingOrder,
  joinInReadingOrder,
} from "../../src/ocria/projection/rotation.js";
import { cleanRenderedText } from "../../src/ocria/projection/text-lines.js";
import type { AnchorMap, ProjectedTextItem } from "../../src/ocria/projection/types.js";
import { f32 } from "../../src/ocria/rust.js";
import { textItem } from "../../src/ocria/types/text-item.js";

function itemAt(text: string, x: number, y: number, w: number, h: number): ProjectedTextItem {
  return newProjectedItem(textItem({ text, x: f32(x), y: f32(y), width: f32(w), height: f32(h) }));
}

/** A grid context over `lines`, with empty raw lines unless given. */
function ctxOf(
  lines: ProjectedTextItem[][],
  rawLines: string[] = lines.map(() => ""),
  pageWidth = 612
): GridCtx {
  return {
    lines,
    meta: lines.map((l) => l.map(newBoxMeta)),
    rawLines,
    medianWidth: 10,
    pageWidth,
    pageHeight: 792,
    forwardLeft: new ForwardAnchors(),
    forwardRight: new ForwardAnchors(),
    forwardCenter: new ForwardAnchors(),
    forwardFloating: new ForwardAnchors(),
  };
}

describe("alignRotatedFloatingItems", () => {
  test("shifts a rotated label to its snapped neighbour and pulls a centered neighbour along", () => {
    const lines = [
      [itemAt("snapped", 100, 10, 40, 10)],
      [itemAt("pin", 102, 20, 12, 10)],
      [itemAt("ctr", 130, 30, 20, 10)],
    ];
    lines[1][0].rotated = true;
    const ctx = ctxOf(lines, ["  snapped", `${" ".repeat(10)}pin`, "   ctr"]);
    ctx.meta[0][0].snap = "Left";
    ctx.meta[0][0].projected_x = 2;
    ctx.meta[1][0].projected_x = 10;
    ctx.meta[2][0].snap = "Center";
    ctx.meta[2][0].projected_x = 3;

    alignRotatedFloatingItems(ctx, [{ start: 0, end: 3 }]);

    // The label moves from column 10 to the neighbour's column 2 (shift 8).
    expect(ctx.rawLines[1]).toBe("  pin");
    expect(ctx.meta[1][0].projected_x).toBe(2);
    // The centered item sits 28 pt right of the label: round(28 / 10) = 3 columns, so column 5.
    expect(ctx.rawLines[2]).toBe("     ctr");
    expect(ctx.meta[2][0].projected_x).toBe(5);
    expect(ctx.rawLines[0]).toBe("  snapped");
  });

  test("leaves the label when no neighbour is left of it", () => {
    const lines = [[itemAt("snapped", 100, 10, 40, 10)], [itemAt("pin", 102, 20, 12, 10)]];
    lines[1][0].rotated = true;
    const ctx = ctxOf(lines, ["          snapped", "  pin"]);
    ctx.meta[0][0].snap = "Left";
    ctx.meta[0][0].projected_x = 10;
    ctx.meta[1][0].projected_x = 2;
    alignRotatedFloatingItems(ctx, [{ start: 0, end: 2 }]);
    expect(ctx.rawLines).toEqual(["          snapped", "  pin"]);
  });

  test("prefers a non-center neighbour over a nearer centered one", () => {
    const lines = [
      [itemAt("ctr", 102, 10, 10, 10)],
      [itemAt("pin", 102, 20, 12, 10)],
      [itemAt("left", 110, 30, 10, 10)],
    ];
    lines[1][0].rotated = true;
    const ctx = ctxOf(lines, ["      ctr", `${" ".repeat(8)}pin`, "    left"]);
    ctx.meta[0][0].snap = "Center";
    ctx.meta[0][0].projected_x = 6;
    ctx.meta[1][0].projected_x = 8;
    ctx.meta[2][0].snap = "Left";
    ctx.meta[2][0].projected_x = 4;
    alignRotatedFloatingItems(ctx, [{ start: 0, end: 3 }]);
    // Column 4 (the left-snapped item) wins over column 6, so the shift is 4.
    expect(ctx.meta[1][0].projected_x).toBe(4);
    expect(ctx.rawLines[1]).toBe("    pin");
  });
});

describe("detectAndRenderFlowingLines", () => {
  const row = (xs: number[]): ProjectedTextItem[] => xs.map((x) => itemAt("w", x, 10, 100, 10));

  test("sweeps flowing status down and up from a wide line", () => {
    const lines = [row([50, 160]), row([50, 160, 270, 380]), row([50, 160]), row([50, 160])];
    const raw = lines.map(() => "");
    const meta: BoxMeta[][] = lines.map((l) => l.map(newBoxMeta));
    detectAndRenderFlowingLines(lines, { start: 0, end: 4 }, raw, meta, 10, 600);
    expect(raw).toEqual(["w w", "w w w w", "w w", "w w"]);
    expect(meta.flat().every((m) => m.rendered)).toBe(true);
  });

  test("a line whose items snap to different columns is not flowing", () => {
    const lines = [row([50, 160, 270, 380]), row([50, 160, 270, 380])];
    const raw = lines.map(() => "");
    const meta: BoxMeta[][] = lines.map((l) => l.map(newBoxMeta));
    meta[1][0].snap = "Left";
    meta[1][1].snap = "Right";
    detectAndRenderFlowingLines(lines, { start: 0, end: 2 }, raw, meta, 10, 600);
    expect(raw).toEqual(["w w w w", ""]);
  });
});

describe("right-column unsnap and render wait", () => {
  test("a left-only item in a mostly right-snapped right column floats and is rendered last", () => {
    const lines = [0, 1, 2, 3].map((i) => [itemAt(`r${i}`, 300, 10 + 20 * i, 100, 10)]);
    const ctx = ctxOf(lines, ["", "", "", ""]);
    const key = anchorKey(300);
    const members: AnchorMap = new Map([[key, lines.map((_, i): [number, number] => [i, 0])]]);
    ctx.meta.forEach((m, i) => {
      m[0].left_anchor = key;
      m[0].snap = i < 3 ? "Right" : "Left";
      m[0].right_anchor = i < 3 ? 99 : null;
    });
    unsnapRightColumnLeftItems(ctx, { start: 0, end: 4 }, members);
    expect(ctx.meta[3][0]).toMatchObject({ snap: null, left_anchor: null, force_unsnapped: true });
    expect(ctx.meta[0][0].snap).toBe("Right");

    // The floating item waits for the snap pass, then renders.
    const left: AnchorMap = new Map([[anchorKey(50), [[0, 0]]]]);
    const lines2 = [[itemAt("A", 50, 10, 10, 10)], [itemAt("B", 300, 30, 10, 10)]];
    const ctx2 = ctxOf(lines2, ["", ""]);
    ctx2.meta[0][0].left_anchor = anchorKey(50);
    ctx2.meta[0][0].snap = "Left";
    ctx2.meta[1][0].force_unsnapped = true;
    renderBlock(ctx2, { start: 0, end: 2 }, { left, right: new Map(), center: new Map() });
    // The grid column is round(50 / 10) = 5, capped at COLUMN_SPACES = 4.
    expect(ctx2.rawLines[0]).toBe("    A");
    expect(ctx2.rawLines[1].trim()).toBe("B");
    expect(ctx2.meta[1][0].rendered).toBe(true);
  });

  test("an item whose snap has no anchor group is still rendered", () => {
    const ctx = ctxOf([[itemAt("lost", 50, 10, 30, 10)]]);
    ctx.meta[0][0].snap = "Left";
    ctx.meta[0][0].left_anchor = 5;
    renderBlock(
      ctx,
      { start: 0, end: 1 },
      { left: new Map(), right: new Map(), center: new Map() }
    );
    expect(ctx.rawLines).toEqual(["lost"]);
  });
});

describe("rotation and text edge cases", () => {
  test("joinInReadingOrder puts a right-to-left word before the one it follows on the page", () => {
    expect(joinInReadingOrder("שלום", "עולם", " ")).toBe("עולם שלום");
    expect(joinInReadingOrder("ab", "cd", " ")).toBe("ab cd");
    expect(joinInReadingOrder("ab ", "cd", " ")).toBe("ab cd");
    expect(joinInReadingOrder("ab", "cd", "")).toBe("abcd");
  });

  test("an inline rotated group absorbs the offset an earlier stacked group left on it", () => {
    const rot = (
      text: string,
      x: number,
      y: number,
      w: number,
      h: number,
      rotation: number
    ): ProjectedTextItem => {
      const p = itemAt(text, x, y, w, h);
      p.item.rotation = rotation;
      return p;
    };
    // Group 1 spans over 40% of the page height, so it stacks as its own block. That pushes the
    // body text down 95 pt and gives the later rotated group a `d` of 95; the label then sits
    // beside the pushed body text, so it stays inline and drops the offset.
    const items = [
      rot("side", 10, 0, 5, 50, 270),
      itemAt("body", 500, 20, 100, 10),
      rot("label", 500, 110, 5, 6, 90),
    ];
    handleRotationReadingOrder(items, 100);
    const label = items.find((p) => p.item.text === "label");
    expect(label).toMatchObject({ rotated: true, d: 0 });
    expect(label?.item.rotation).toBe(0);
    // The inline placement discards the offset and uses the group's common row.
    // Common row: the group's vertical midpoint (110 + 3) less half its average width (2.5).
    expect(label?.item.y).toBe(110.5);
  });

  test("looksLikeTableNumber accepts decorated numbers and rejects a second decimal point", () => {
    for (const ok of ["0.77**", "$1,200.50", "-3", "45%", "0.31 *"]) {
      expect(looksLikeTableNumber(ok)).toBe(true);
    }
    for (const no of ["1.2.3", "7", "abc", "12%3", "%"])
      expect(looksLikeTableNumber(no)).toBe(false);
  });

  test("cleanRenderedText cuts the left margin by bytes and rejects a cut inside a character", () => {
    expect(cleanRenderedText("\n  a\n    b\n\n")).toBe("a\n  b");
    expect(cleanRenderedText("   \n")).toBe("");
    expect(cleanRenderedText("a\0b")).toBe("a b");
    // U+3000 is white space of 3 bytes; a 2-byte cut lands inside it, where Rust panics.
    expect(() => cleanRenderedText("  a\n　b")).toThrow(RangeError);
  });
});
