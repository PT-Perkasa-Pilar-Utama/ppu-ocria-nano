// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): project_to_grid.

// Upstream records per-item signals in a thread-local `PROJ_DUMP` when signal
// collection is on. This port takes an explicit `dump` array instead: pass one
// to record, omit it to skip. The `LITEPARSE_DEBUG` stderr output is not ported.

import { roundF32 } from "../rust-extra.js";
import type { Page } from "../types/page.js";
import { chars, f32, trimEnd } from "../rust.js";
import {
  ForwardAnchors,
  anchorKey,
  deltaMinFilter,
  extractBlockAnchors,
  interceptFilter,
  mergeNearbyAnchorGroups,
  pairKey,
  tryAlignFloating,
} from "./anchors.js";
import {
  detectAndRenderFlowingLines,
  isFlowingTextBlock,
  newBoxMeta,
  renderFlowingBlock,
  segmentBlocks,
} from "./flowing.js";
import { formLines } from "./form-lines.js";
import { cleanProjectedItems } from "./gutter.js";
import { alignRotatedFloatingItems } from "./grid-rotated.js";
import { renderBlock } from "./grid-render.js";
import {
  assignAnchors,
  computeSpacingHints,
  resolveSnaps,
  unsnapJustifiedRightItems,
  unsnapRightColumnLeftItems,
} from "./grid-snaps.js";
import type { BlockAnchors, GridCtx, ProjDumpItem } from "./grid-state.js";
import { handleRotationReadingOrder } from "./rotation.js";
import { cleanRenderedText, fixSparseBlocks } from "./text-lines.js";
import { computeMedianTextboxSize } from "./textbox-metrics.js";
import type { AnchorMap, ProjectedTextItem } from "./types.js";
import type { LineRange } from "./anchors.js";

const isDotsOnly = (text: string): boolean =>
  chars(text).every((c) => c === "." || c === "·" || c === "•");

/** Filter out items that are purely dots (a dot leader flood), then round sizes to whole points. */
function prepareBoxes(boxes: ProjectedTextItem[]): ProjectedTextItem[] {
  const dotCount = boxes.filter((b) => isDotsOnly(b.item.text)).length;
  const kept =
    dotCount > 100 && dotCount > boxes.length * 0.05
      ? boxes.filter((b) => !isDotsOnly(b.item.text))
      : boxes;
  for (const b of kept) {
    b.item.width = roundF32(b.item.width);
    b.item.height = roundF32(b.item.height);
  }
  return kept;
}

const anchoredPairs = (m: AnchorMap): Set<number> => {
  const out = new Set<number>();
  for (const members of m.values()) for (const [li, bi] of members) out.add(pairKey(li, bi));
  return out;
};

/** The block's anchor groups after merging, isolation filtering, floating alignment and singleton removal. */
function blockAnchors(ctx: GridCtx, block: LineRange): BlockAnchors {
  const { lines } = ctx;
  const [left, right, center] = extractBlockAnchors(lines, block);
  mergeNearbyAnchorGroups(left);
  mergeNearbyAnchorGroups(right);
  mergeNearbyAnchorGroups(center);

  // Isolation filtering: remove vertically isolated anchor members
  deltaMinFilter(left, lines, ctx.pageHeight, f32(0.25));
  deltaMinFilter(right, lines, ctx.pageHeight, f32(0.17));
  deltaMinFilter(center, lines, ctx.pageHeight, f32(0.05));

  // Intercept filtering: remove anchors crossed by other text
  interceptFilter(left, lines);
  interceptFilter(right, lines);
  interceptFilter(center, lines);

  // Align floating items to nearby anchors. Use type-specific skip sets so
  // items with e.g. only a left anchor can still be aligned to a right anchor.
  tryAlignFloating(
    left,
    lines,
    block,
    anchoredPairs(left),
    4,
    (it) => it.x,
    (it) => anchorKey(it.x)
  );
  tryAlignFloating(
    right,
    lines,
    block,
    anchoredPairs(right),
    4,
    (it) => f32(it.x + it.width),
    (it) => anchorKey(f32(it.x + it.width))
  );
  const centerX = (it: { x: number; width: number }): number => f32(it.x + f32(it.width * 0.5));
  tryAlignFloating(center, lines, block, anchoredPairs(center), 4, centerX, (it) =>
    anchorKey(centerX(it))
  );

  // Remove singletons
  for (const m of [left, right, center]) {
    for (const [k, v] of m) if (v.length < 2) m.delete(k);
  }
  return { left, right, center };
}

/** Lay out one block of lines into `ctx.rawLines`. */
function projectBlock(ctx: GridCtx, block: LineRange, blockIdx: number): void {
  const { lines, meta } = ctx;
  for (let li = block.start; li < Math.min(block.end, meta.length); li++) {
    for (const m of meta[li]) m.block_idx = blockIdx;
  }
  const anchors = blockAnchors(ctx, block);

  if (
    isFlowingTextBlock(
      lines,
      block,
      anchors.left,
      anchors.right,
      anchors.center,
      ctx.pageWidth,
      ctx.medianWidth
    )
  ) {
    for (let li = block.start; li < Math.min(block.end, meta.length); li++) {
      for (const m of meta[li]) m.flowing = true;
    }
    renderFlowingBlock(lines, block, ctx.rawLines, meta, ctx.medianWidth);
    return;
  }

  assignAnchors(meta, anchors);
  resolveSnaps(meta, block, anchors);
  unsnapJustifiedRightItems(ctx, block, anchors.right);
  unsnapRightColumnLeftItems(ctx, block, anchors.left);

  // Per-line flowing detection (within structured blocks)
  detectAndRenderFlowingLines(lines, block, ctx.rawLines, meta, ctx.medianWidth, ctx.pageWidth);

  computeSpacingHints(ctx, block);
  renderBlock(ctx, block, anchors);
}

const SNAP_LETTER = { Left: "L", Right: "R", Center: "C" } as const;

/** Copy the rendered state back onto the items, flatten in line order, and record signals. */
function flattenLines(ctx: GridCtx, dump: ProjDumpItem[] | undefined): ProjectedTextItem[] {
  const flattened: ProjectedTextItem[] = [];
  ctx.lines.forEach((line, lineIdx) => {
    line.forEach((item, boxIdx) => {
      const m = ctx.meta[lineIdx][boxIdx];
      dump?.push({
        t: item.item.text,
        x: item.orig_x,
        y: item.orig_y,
        w: item.orig_width,
        h: item.orig_height,
        line: lineIdx,
        block: m.block_idx,
        flow: m.flowing,
        snap: m.snap === null ? "" : SNAP_LETTER[m.snap],
        lc: m.left_count,
        rc: m.right_count,
        cc: m.center_count,
        px: m.projected_x,
        faint: item.item.ocr_faint,
      });
      item.force_unsnapped = m.force_unsnapped;
      item.num_spaces = m.should_space;
      if (m.snap !== null) {
        item.snap = m.snap;
        item.anchor = m.snap;
      }
      flattened.push(item);
    });
  });
  return flattened;
}

/**
 * Project a page's text items onto a character grid. Returns the items (with
 * their projected state) and the page text. `dump` receives one record per
 * item when given (the signals the table model reads).
 */
export function projectToGrid(
  page: Page,
  projectionBoxes: ProjectedTextItem[],
  styleRuns: boolean,
  dump?: ProjDumpItem[]
): [ProjectedTextItem[], string] {
  if (projectionBoxes.length === 0) return [[], ""];

  const boxes = prepareBoxes(projectionBoxes);

  // Compute median distances
  const [medianWidth, medianHeight] = computeMedianTextboxSize(boxes);

  // Handle reading order rotations
  handleRotationReadingOrder(boxes, page.page_height);

  // Form lines of boxes
  const lines = formLines(
    boxes,
    medianWidth,
    medianHeight,
    page.page_width,
    page.page_height,
    styleRuns
  );
  if (lines.length === 0) return [[], ""];

  const blocks = segmentBlocks(lines);
  const ctx: GridCtx = {
    lines,
    meta: lines.map((line) => line.map(newBoxMeta)),
    rawLines: lines.map(() => ""),
    medianWidth,
    pageWidth: page.page_width,
    pageHeight: page.page_height,
    forwardLeft: new ForwardAnchors(),
    forwardRight: new ForwardAnchors(),
    forwardCenter: new ForwardAnchors(),
    forwardFloating: new ForwardAnchors(),
  };

  blocks.forEach((block, blockIdx) => projectBlock(ctx, block, blockIdx));

  alignRotatedFloatingItems(ctx, blocks);

  // Fix sparse blocks (per block)
  for (const block of blocks) fixSparseBlocks(ctx.rawLines, block.start, block.end);

  const flattened = cleanProjectedItems(flattenLines(ctx, dump), page.page_width, page.page_height);
  const text = cleanRenderedText(ctx.rawLines.map(trimEnd).join("\n"));
  return [flattened, text];
}
