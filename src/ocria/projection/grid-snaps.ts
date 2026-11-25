// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): snap resolution and spacing hints.

import { charCount, f32, totalCmp } from "../rust.js";
import type { LineRange } from "./anchors.js";
import { anchorKey } from "./anchors.js";
import type { BoxMeta } from "./flowing.js";
import { lineHasColumnGap } from "./flowing.js";
import type { BlockAnchors, GridCtx } from "./grid-state.js";
import { COLUMN_SPACES, FLOATING_SPACES } from "./text-lines.js";
import type { AnchorMap } from "./types.js";

/** Point each item at the anchor groups it belongs to. */
export function assignAnchors(meta: BoxMeta[][], anchors: BlockAnchors): void {
  // Each item sits in at most one group per anchor kind, so the visiting order of the
  // Rust HashMap does not reach the output.
  for (const [anchor, members] of anchors.left) {
    for (const [li, bi] of members) meta[li][bi].left_anchor = anchor;
  }
  for (const [anchor, members] of anchors.right) {
    for (const [li, bi] of members) meta[li][bi].right_anchor = anchor;
  }
  for (const [anchor, members] of anchors.center) {
    for (const [li, bi] of members) meta[li][bi].center_anchor = anchor;
  }
}

const groupSize = (map: AnchorMap, key: number | null): number =>
  key === null ? 0 : (map.get(key)?.length ?? 0);

/** Resolve snap kind (strongest anchor wins; tie-break: left > right > center). */
export function resolveSnaps(meta: BoxMeta[][], block: LineRange, anchors: BlockAnchors): void {
  for (let li = block.start; li < Math.min(block.end, meta.length); li++) {
    for (const m of meta[li]) {
      const leftCount = groupSize(anchors.left, m.left_anchor);
      const rightCount = groupSize(anchors.right, m.right_anchor);
      const centerCount = groupSize(anchors.center, m.center_anchor);
      m.left_count = leftCount;
      m.right_count = rightCount;
      m.center_count = centerCount;

      if (leftCount === 0 && rightCount === 0 && centerCount === 0) continue;

      // Prefer left alignment when left and right counts are close.
      // In justified text, the right margin often collects slightly more
      // members than the left (due to indented paragraphs breaking the
      // left margin but keeping the right). A left-bias prevents justified
      // body text from right-snapping, which causes ragged left margins.
      const leftBiased = leftCount > 0 && rightCount > 0 && leftCount >= rightCount * 0.8;

      if ((leftCount >= rightCount || leftBiased) && leftCount >= centerCount) m.snap = "Left";
      else if (rightCount >= leftCount && rightCount >= centerCount) m.snap = "Right";
      else m.snap = "Center";
    }
  }
}

/**
 * Fixup pass: in justified text columns, most items share both a left and
 * right anchor. Items that lost their left anchor (e.g., indented first lines)
 * get right-snapped, but they should render at their natural position. If a
 * right anchor's members are overwhelmingly also left-anchored, right-only
 * members are likely justified body text and should be unsnapped (rendered
 * floating at natural x).
 *
 * Additional guard: the item's left x must be near the left x of the
 * left-anchored members (within a quarter page width). This prevents unsnapping
 * items in a different column that happen to share a right margin.
 */
export function unsnapJustifiedRightItems(
  ctx: GridCtx,
  block: LineRange,
  anchorRight: AnchorMap
): void {
  const { lines, meta } = ctx;
  // For each right anchor: (total, has_left, median_left_x of left-anchored members)
  const info = new Map<number, [number, number, number]>();
  for (const [key, members] of anchorRight) {
    const leftXs: number[] = [];
    let hasLeft = 0;
    for (const [li, bi] of members) {
      if (meta[li][bi].left_anchor !== null) {
        hasLeft++;
        leftXs.push(lines[li][bi].item.x);
      }
    }
    leftXs.sort(totalCmp);
    const medianX = leftXs.length === 0 ? 0 : leftXs[Math.floor(leftXs.length / 2)];
    info.set(key, [members.length, hasLeft, medianX]);
  }

  for (let li = block.start; li < block.end; li++) {
    meta[li].forEach((m, bi) => {
      if (m.snap !== "Right") return;
      // Only fix items with no left anchor
      if (m.left_anchor !== null) return;
      if (m.right_anchor === null) return;
      const [total, hasLeft, medianLeftX] = info.get(m.right_anchor) ?? [0, 0, 0];
      // Require overwhelming majority (90%+) of members to have left anchors
      if (total < 10 || hasLeft / total < 0.9) return;
      // Check that the item is near the same column as the left-anchored members
      const xDistance = Math.abs(f32(lines[li][bi].item.x - medianLeftX));
      if (xDistance > f32(ctx.pageWidth * 0.25)) return;
      m.snap = null;
      m.right_anchor = null;
    });
  }
}

/**
 * Symmetric fixup: in multi-column layouts, short right-column lines may only
 * have a left anchor (no right anchor) because their right edge doesn't align
 * with full-width lines. Meanwhile, the full-width lines in the same left
 * anchor group get right-snapped. The short lines get left-snapped and placed
 * too far left.
 *
 * Detection: if a left anchor has many right-snapped members AND the anchor
 * position is past the page midpoint (indicating right column), unsnap the
 * remaining left-only members so they float and inherit correct positioning
 * from forward anchors.
 */
export function unsnapRightColumnLeftItems(
  ctx: GridCtx,
  block: LineRange,
  anchorLeft: AnchorMap
): void {
  const { meta } = ctx;
  const pageMidKey = anchorKey(f32(ctx.pageWidth * f32(0.4)));

  const info = new Map<number, [number, number]>();
  for (const [key, members] of anchorLeft) {
    let rightSnapped = 0;
    for (const [li, bi] of members) if (meta[li][bi].snap === "Right") rightSnapped++;
    info.set(key, [members.length, rightSnapped]);
  }

  for (let li = block.start; li < block.end; li++) {
    for (const m of meta[li]) {
      if (m.snap !== "Left") continue;
      // Only fix items with no right anchor (short lines)
      if (m.right_anchor !== null) continue;
      if (m.left_anchor === null) continue;
      // Only apply to items past the page midpoint (right column)
      if (m.left_anchor < pageMidKey) continue;
      const [total, rightSnapped] = info.get(m.left_anchor) ?? [0, 0];
      // Require a meaningful group where most members are right-snapped
      if (total < 4 || rightSnapped / total < 0.5) continue;
      m.snap = null;
      m.left_anchor = null;
      m.force_unsnapped = true;
    }
  }
}

/** Compute spacing hints (skip already-rendered flowing items). */
export function computeSpacingHints(ctx: GridCtx, block: LineRange): void {
  const { lines, meta, medianWidth, pageWidth } = ctx;
  for (let li = block.start; li < block.end; li++) {
    for (let bi = 0; bi < lines[li].length; bi++) {
      if (meta[li][bi].rendered) continue;
      if (bi === 0 || meta[li][bi - 1].rendered) {
        meta[li][bi].should_space = 0;
        continue;
      }
      const prev = lines[li][bi - 1].item;
      const cur = lines[li][bi].item;
      const xDelta = f32(cur.x - f32(prev.x + prev.width));

      let shouldSpace = 0;
      if (xDelta > 2) {
        shouldSpace = 1;
        const prevLen = Math.max(charCount(prev.text), 1);
        const prevCharWidth = Math.max(f32(prev.width / prevLen), f32(0.1));
        if (xDelta > f32(prevCharWidth * 2)) {
          const columnGapThreshold = f32(pageWidth * f32(0.1));
          // Also detect column gaps using the relative gap method:
          // if this line has a gap that's an outlier compared to other gaps,
          // it's a column separator even if below the absolute threshold.
          const hasRelativeColumnGap = lineHasColumnGap(lines[li], medianWidth, pageWidth);
          const sameColumn =
            xDelta < columnGapThreshold && !(hasRelativeColumnGap && xDelta > f32(medianWidth * 2));
          const curSnap = meta[li][bi].snap;
          const prevSnap = meta[li][bi - 1].snap;
          const bothSnapped = curSnap !== null && prevSnap !== null;
          const forceUnsnapped = meta[li][bi].force_unsnapped;

          if (
            (!forceUnsnapped && xDelta > f32(prevCharWidth * 8)) ||
            curSnap === "Left" ||
            prevSnap === "Right" ||
            bothSnapped
          ) {
            shouldSpace = sameColumn ? FLOATING_SPACES : COLUMN_SPACES;
          } else {
            shouldSpace = sameColumn ? 1 : FLOATING_SPACES;
          }
        }
      }
      meta[li][bi].should_space = shouldSpace;
    }
  }
}
