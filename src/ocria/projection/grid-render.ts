// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): the block render loop.

import { roundF32 } from "../rust-extra.js";
import { asInt, clamp, f32 } from "../rust.js";
import type { ForwardAnchors, LineRange } from "./anchors.js";
import { anchorKey, anchorToX, updateForwardAnchorRightBound } from "./anchors.js";
import type { BlockAnchors, GridCtx } from "./grid-state.js";
import type { Snap } from "../types/geometry.js";
import { COLUMN_SPACES, canRenderBbox, charLen, lineSpaceEnd, trimEndLen } from "./text-lines.js";
import { charCount, trimEnd } from "../rust.js";

/** The snap positions still to render in a block, ascending, plus the floating x keys. */
type SnapLists = { left: number[]; right: number[]; center: number[]; floating: number[] };

/** `column = round(x / median_width)`, kept inside `0..=COLUMN_SPACES`. */
function columnOf(x: number, medianWidth: number): number {
  return clamp(asInt(roundF32(f32(x / medianWidth))), 0, COLUMN_SPACES);
}

const sortedKeys = (m: ReadonlyMap<number, unknown>): number[] =>
  [...m.keys()].sort((a, b) => a - b);

/** Build the block-scoped snap lists. */
function buildSnapLists(ctx: GridCtx, block: LineRange, anchors: BlockAnchors): SnapLists {
  const floating = new Set<number>();
  for (let li = block.start; li < block.end; li++) {
    ctx.lines[li].forEach((bbox, bi) => {
      if (ctx.meta[li][bi].snap === null && !ctx.meta[li][bi].rendered) {
        floating.add(anchorKey(bbox.item.x));
      }
    });
  }
  return {
    left: sortedKeys(anchors.left),
    right: sortedKeys(anchors.right),
    center: sortedKeys(anchors.center),
    floating: [...floating].sort((a, b) => a - b),
  };
}

/** Record a rendered item and widen the forward anchors behind its right edge. */
function recordRendered(
  ctx: GridCtx,
  snaps: SnapLists,
  li: number,
  bi: number,
  right: number
): void {
  const nextShouldSpace = bi + 1 < ctx.lines[li].length ? ctx.meta[li][bi + 1].should_space : 0;
  const rightBound = anchorKey(right);
  const targetLen = charLen(ctx.rawLines[li]) + nextShouldSpace;
  updateForwardAnchorRightBound(snaps.left, ctx.forwardLeft, rightBound, targetLen);
  updateForwardAnchorRightBound(snaps.right, ctx.forwardRight, rightBound, targetLen);
  updateForwardAnchorRightBound(snaps.floating, ctx.forwardFloating, rightBound, targetLen);
}

const noSnapsLeft = (s: SnapLists): boolean =>
  s.left.length === 0 && s.right.length === 0 && s.center.length === 0;

/** Render floating and unsnapped items first. Returns whether anything was rendered. */
function renderFloating(ctx: GridCtx, block: LineRange, snaps: SnapLists): boolean {
  const { lines, meta, rawLines, medianWidth } = ctx;
  let changed = false;
  for (let li = block.start; li < block.end; li++) {
    for (let bi = 0; bi < lines[li].length; bi++) {
      if (meta[li][bi].rendered) continue;

      if (!meta[li][bi].force_unsnapped) {
        if (meta[li][bi].snap !== null) continue;

        const item = lines[li][bi].item;
        const xKey = anchorKey(item.x);
        const centerKey = anchorKey(f32(item.x + f32(item.width * 0.5)));
        if (
          (snaps.left.length > 0 && snaps.left[0] < xKey) ||
          (snaps.right.length > 0 && snaps.right[0] < xKey) ||
          (snaps.center.length > 0 && snaps.center[0] < centerKey)
        ) {
          continue;
        }
      } else if (!noSnapsLeft(snaps)) {
        // Force-unsnapped items (e.g. short right-column lines) must wait until ALL
        // snaps are processed so that forward anchors from their column neighbors
        // are established.
        continue;
      }

      if (!canRenderBbox(meta[li], bi)) break;

      const { x: bboxX, width: bboxW, text: bboxText } = lines[li][bi].item;
      let targetX = columnOf(bboxX, medianWidth);

      const lastSnapLeft = ctx.forwardLeft.maxUpTo(anchorKey(bboxX));
      const lineMax = Math.max(lastSnapLeft, trimEndLen(rawLines[li]) + meta[li][bi].should_space);
      if (targetX < lineMax) targetX = lineMax;

      if (!meta[li][bi].force_unsnapped) {
        const floatingAnchor = ctx.forwardFloating.get(anchorKey(bboxX));
        if (floatingAnchor !== undefined && targetX < floatingAnchor) {
          const adjusted = Math.min(floatingAnchor, targetX + 4);
          if (adjusted > targetX) targetX = adjusted;
        }
      }

      rawLines[li] = trimEnd(rawLines[li]);
      const beforeLen = charLen(rawLines[li]);
      if (targetX > beforeLen) rawLines[li] += " ".repeat(targetX - beforeLen);
      const startX = charLen(rawLines[li]);
      rawLines[li] += bboxText;

      meta[li][bi].rendered = true;
      meta[li][bi].projected_x = startX;
      lines[li][bi].rendered = true;
      lines[li][bi].num_spaces = Math.max(startX - beforeLen, 0);
      changed = true;

      recordRendered(ctx, snaps, li, bi, f32(bboxX + bboxW));
    }
  }
  return changed;
}

/** The snap list to process next: the smallest first key, ties going left, then right. */
function nextSnapKind(s: SnapLists): Snap | null {
  const l = s.left[0];
  const r = s.right[0];
  const c = s.center[0];
  const has = (v: number | undefined): v is number => v !== undefined;
  if (!has(l) && !has(r) && !has(c)) return null;
  if (has(l) && !has(r) && !has(c)) return "Left";
  if (!has(l) && has(r) && !has(c)) return "Right";
  if (!has(l) && !has(r) && has(c)) return "Center";
  if (has(l) && has(r) && !has(c)) return l <= r ? "Left" : "Right";
  if (has(l) && !has(r) && has(c)) return l <= c ? "Left" : "Center";
  if (!has(l) && has(r) && has(c)) return r <= c ? "Right" : "Center";
  if (l <= r && l <= c) return "Left";
  if (r <= l && r <= c) return "Right";
  return "Center";
}

function snapList(s: SnapLists, kind: Snap): number[] {
  if (kind === "Left") return s.left;
  if (kind === "Right") return s.right;
  return s.center;
}

function forwardOf(ctx: GridCtx, kind: Snap): ForwardAnchors {
  if (kind === "Left") return ctx.forwardLeft;
  if (kind === "Right") return ctx.forwardRight;
  return ctx.forwardCenter;
}

/** Items of the block whose anchor of this kind is `anchor` and that snap to it. */
function turnItemsOf(
  ctx: GridCtx,
  block: LineRange,
  kind: Snap,
  anchor: number
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let li = block.start; li < block.end; li++) {
    const n = ctx.lines[li].length;
    ctx.meta[li].slice(0, n).forEach((m, bi) => {
      if (m.rendered) return;
      let matches = false;
      if (kind === "Left") {
        matches = m.left_anchor === anchor && m.snap !== "Right" && m.snap !== "Center";
      } else if (kind === "Right") {
        matches = m.right_anchor === anchor && m.snap === "Right";
      } else {
        matches = m.center_anchor === anchor && m.snap === "Center";
      }
      if (matches) out.push([li, bi]);
    });
  }
  return out;
}

/** The column every item of a snap turn must reach so that none of them overlaps text already on its line. */
function turnLineMax(ctx: GridCtx, kind: Snap, turn: ReadonlyArray<[number, number]>): number {
  const { lines, meta, rawLines } = ctx;
  let best = 0;
  for (const [li, bi] of turn) {
    const raw = rawLines[li];
    const text = lines[li][bi].item.text;
    let v: number;
    if (kind === "Left") {
      v = charLen(raw) + lineSpaceEnd(raw, meta[li][bi].should_space) + 1;
    } else if (kind === "Right") {
      const lastSnapLeft = ctx.forwardLeft.maxUpTo(anchorKey(lines[li][bi].item.x));
      const leftBound = Math.max(lastSnapLeft, trimEndLen(raw) + meta[li][bi].should_space);
      v = leftBound + charCount(text);
    } else {
      v =
        charLen(raw) +
        Math.floor(charCount(text) / 2) +
        lineSpaceEnd(raw, meta[li][bi].should_space);
    }
    if (v > best) best = v;
  }
  return best;
}

/** Write one snapped item into its line at `targetX` for its snap kind. */
function renderSnapped(ctx: GridCtx, kind: Snap, li: number, bi: number, targetX: number): void {
  const { rawLines, meta, lines } = ctx;
  const text = lines[li][bi].item.text;
  let before: number;
  if (kind === "Left") {
    before = charLen(rawLines[li]);
    if (targetX > before) rawLines[li] += " ".repeat(targetX - before);
  } else if (kind === "Right") {
    rawLines[li] = trimEnd(rawLines[li]);
    const textLen = charCount(text);
    before = charLen(rawLines[li]);
    const trimLen = trimEndLen(rawLines[li]);
    if (targetX > trimLen + textLen) {
      rawLines[li] += " ".repeat(targetX - charLen(rawLines[li]) - textLen);
    }
  } else {
    const textHalf = Math.floor(charCount(text) / 2);
    before = charLen(rawLines[li]);
    if (targetX > charLen(rawLines[li]) + textHalf) {
      rawLines[li] += " ".repeat(targetX - charLen(rawLines[li]) - textHalf);
    }
  }
  const startX = charLen(rawLines[li]);
  rawLines[li] += text;
  meta[li][bi].projected_x = startX;
  lines[li][bi].num_spaces = Math.max(startX - before, 0);
}

/** Render a block: floating items first, then each snap column in left-to-right order. */
export function renderBlock(ctx: GridCtx, block: LineRange, anchors: BlockAnchors): void {
  const { lines, meta, rawLines, medianWidth } = ctx;
  const snaps = buildSnapLists(ctx, block, anchors);

  let hasChanged = true;
  while (hasChanged || !noSnapsLeft(snaps)) {
    hasChanged = false;

    if (renderFloating(ctx, block, snaps)) hasChanged = true;

    const kind = nextSnapKind(snaps);
    if (kind === null) continue;
    const list = snapList(snaps, kind);
    const currentAnchor = list[0];

    const turn = turnItemsOf(ctx, block, kind, currentAnchor);
    if (turn.length === 0) {
      list.shift();
      continue;
    }

    hasChanged = true;

    let targetX = columnOf(anchorToX(currentAnchor), medianWidth);
    const lineMax = turnLineMax(ctx, kind, turn);
    if (targetX < lineMax) targetX = lineMax;

    const forward = forwardOf(ctx, kind);
    const known = forward.get(currentAnchor);
    if (known !== undefined) targetX = Math.max(targetX, known);
    forward.set(currentAnchor, targetX);

    for (const [li, bi] of turn) {
      const { x: bboxX, width: bboxW } = lines[li][bi].item;
      renderSnapped(ctx, kind, li, bi, targetX);
      meta[li][bi].rendered = true;
      lines[li][bi].rendered = true;
      recordRendered(ctx, snaps, li, bi, f32(bboxX + bboxW));
    }
    list.shift();
  }

  // Fallback: render anything still not rendered in this block
  for (let li = block.start; li < block.end; li++) {
    for (let bi = 0; bi < lines[li].length; bi++) {
      if (meta[li][bi].rendered) continue;
      if (rawLines[li] !== "" && !rawLines[li].endsWith(" ")) rawLines[li] += " ";
      const startX = charLen(rawLines[li]);
      rawLines[li] += lines[li][bi].item.text;
      meta[li][bi].rendered = true;
      meta[li][bi].projected_x = startX;
      lines[li][bi].rendered = true;
    }
  }
}
