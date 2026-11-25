// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): rotated-label alignment.

import { roundF32 } from "../rust-extra.js";
import { asUsize, chars, f32, trimEnd } from "../rust.js";
import type { LineRange } from "./anchors.js";
import type { GridCtx } from "./grid-state.js";
import { charLen } from "./text-lines.js";

/** The nearest left- or right-snapped column near `rotPdfX` on lines within 4 of `lineIdx`: `[x_diff, column, is_center]`. */
function nearestSnappedColumn(
  ctx: GridCtx,
  block: LineRange,
  lineIdx: number,
  rotPdfX: number
): [number, number, boolean] | null {
  const { lines, meta, medianWidth } = ctx;
  const scanRange = 4;
  const lo = lineIdx >= block.start + scanRange ? lineIdx - scanRange : block.start;
  const hi = Math.min(lineIdx + scanRange + 1, block.end);

  let best: [number, number, boolean] | null = null;
  for (let adj = lo; adj < hi; adj++) {
    if (adj === lineIdx) continue;
    meta[adj].forEach((m, bi) => {
      if (bi >= lines[adj].length || m.snap === null) return;
      const isCenter = m.snap === "Center";
      const xDiff = Math.abs(f32(lines[adj][bi].item.x - rotPdfX));
      if (!(xDiff < f32(medianWidth * 3))) return;
      let dominated: boolean;
      if (best === null) dominated = true;
      // Prefer non-center over center; among same type prefer closer x
      else if (!isCenter && best[2]) dominated = true;
      else if (isCenter && !best[2]) dominated = false;
      else dominated = xDiff < best[0];
      if (dominated) best = [xDiff, m.projected_x, isCenter];
    });
  }
  return best;
}

/** `&s[..char_col]` and `&s[char_col..]` by character index. */
function splitAtChar(s: string, col: number): [string, string] {
  const cs = chars(s);
  return [cs.slice(0, col).join(""), cs.slice(col).join("")];
}

/** Shift center-snapped items on the lines next to a shifted rotated line so they keep their place beside it. */
function shiftAdjacentCenterItems(
  ctx: GridCtx,
  block: LineRange,
  lineIdx: number,
  rotatedItems: readonly number[],
  firstBi: number
): void {
  const { lines, meta, rawLines, medianWidth } = ctx;
  // Also shift center-snapped items on immediately adjacent lines whose PDF x
  // overlaps the rotated items' x range. These items share the same spatial
  // region but may have been pulled out of position by center-snap constraints.
  let rotXMin = Infinity;
  let rotXMax = -Infinity;
  for (const bi of rotatedItems) {
    const b = lines[lineIdx][bi].item;
    rotXMin = Math.min(rotXMin, b.x);
    rotXMax = Math.max(rotXMax, f32(b.x + b.width));
  }

  const immediateAdj: number[] = [];
  if (lineIdx >= 1 && lineIdx - 1 >= block.start) immediateAdj.push(lineIdx - 1);
  if (lineIdx + 1 < block.end) immediateAdj.push(lineIdx + 1);

  const correctedFirstCol = meta[lineIdx][firstBi].projected_x;
  const margin = f32(medianWidth * 2);

  for (const adj of immediateAdj) {
    for (let bi = 0; bi < lines[adj].length; bi++) {
      if (meta[adj][bi].snap !== "Center") continue;
      const b = lines[adj][bi].item;
      if (f32(b.x + b.width) < f32(rotXMin - margin) || b.x > f32(rotXMax + margin)) continue;
      const oldCol = meta[adj][bi].projected_x;
      // Compute where this item should start based on the PDF x offset from the
      // first rotated item.
      const xOffset = f32(b.x - lines[lineIdx][firstBi].item.x);
      const colOffset = asUsize(Math.max(roundF32(f32(xOffset / medianWidth)), 0));
      const targetCol = correctedFirstCol + colOffset;
      if (targetCol > oldCol) {
        const [head, post] = splitAtChar(rawLines[adj], oldCol);
        let rebuilt = trimEnd(head);
        if (targetCol > charLen(rebuilt)) rebuilt += " ".repeat(targetCol - charLen(rebuilt));
        const start = charLen(rebuilt);
        rebuilt += trimEnd(post);
        rawLines[adj] = rebuilt;
        meta[adj][bi].projected_x = start;
      }
    }
  }
}

/**
 * Fixup: align rotated floating items with snapped items on adjacent lines.
 * Rotated labels (e.g. pin names) are excluded from anchors and render at
 * their natural x / median_width position. If a neighboring line has snapped
 * content at a similar PDF x but a different column, shift the rotated items
 * to match, keeping relative spacing intact.
 */
export function alignRotatedFloatingItems(ctx: GridCtx, blocks: readonly LineRange[]): void {
  const { lines, meta, rawLines } = ctx;
  for (const block of blocks) {
    for (let lineIdx = block.start; lineIdx < block.end; lineIdx++) {
      // Collect rotated floating items on this line
      const rotatedItems: number[] = [];
      for (let bi = 0; bi < meta[lineIdx].length; bi++) {
        if (
          bi < lines[lineIdx].length &&
          lines[lineIdx][bi].rotated &&
          meta[lineIdx][bi].snap === null
        ) {
          rotatedItems.push(bi);
        }
      }
      if (rotatedItems.length === 0) continue;

      // Find the first rotated item's PDF x and rendered column
      const firstBi = rotatedItems[0];
      const rotPdfX = lines[lineIdx][firstBi].item.x;
      const rotCol = meta[lineIdx][firstBi].projected_x;

      // Scan nearby lines (up to 4 away) for left/right-snapped items at a similar
      // PDF x. Prefer non-center snaps since center-snapped items can be pulled out
      // of position by unrelated anchor groups.
      const best = nearestSnappedColumn(ctx, block, lineIdx, rotPdfX);
      if (best === null || !(best[1] < rotCol)) continue;

      const shift = rotCol - best[1];
      // Rebuild the line: shift all rotated items left
      const firstCol = meta[lineIdx][firstBi].projected_x;
      let newLine = trimEnd(splitAtChar(rawLines[lineIdx], firstCol)[0]);

      for (const bi of rotatedItems) {
        const oldCol = meta[lineIdx][bi].projected_x;
        const newCol = Math.max(oldCol - shift, 0);
        const curLen = charLen(newLine);
        if (newCol > curLen) newLine += " ".repeat(newCol - curLen);
        const start = charLen(newLine);
        newLine += lines[lineIdx][bi].item.text;
        meta[lineIdx][bi].projected_x = start;
      }
      rawLines[lineIdx] = newLine;

      shiftAdjacentCenterItems(ctx, block, lineIdx, rotatedItems, firstBi);
    }
  }
}
