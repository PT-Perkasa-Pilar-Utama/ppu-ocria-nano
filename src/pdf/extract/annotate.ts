// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): assign_links, assign_strikethrough, assign_underline.

import { f32, remEuclid, totalCmp, trim } from "../../ocria/rust.js";
import type { GraphicPrimitive } from "../../ocria/types/geometry.js";
import type { TextItem } from "../../ocria/types/text-item.js";
import type { PdfLink } from "../pdfium/page-links.js";

/** A link rect taller than this many times the height of the text it covers is a multi-line union box with no per-line quad points. */
const MULTILINE_DROP_FACTOR = f32(1.8);

/**
 * Assign hyperlink URIs to text items whose bbox center falls inside a link annotation's
 * rectangle (both in viewport space); the first matching link wins. A multi-line annotation given
 * as a single union box has no recoverable anchor, so it is dropped rather than wrap a whole
 * sentence in a misleading link.
 */
export function assignLinks(items: TextItem[], links: readonly PdfLink[]): void {
  if (links.length === 0) return;
  for (const link of links) {
    const r = link.rect;
    const covered: number[] = [];
    items.forEach((it, i) => {
      const cx = f32(it.x + f32(it.width / 2));
      const cy = f32(it.y + f32(it.height / 2));
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) covered.push(i);
    });
    if (covered.length === 0) continue;
    const heights = covered.map((i) => items[i].height).sort(totalCmp);
    const medianH = heights[Math.floor(heights.length / 2)];
    if (medianH > 0 && f32(r.bottom - r.top) > f32(MULTILINE_DROP_FACTOR * medianH)) continue;
    for (const i of covered) {
      if (items[i].link == null) items[i].link = link.uri;
    }
  }
}

/** Max thickness (pt) for a stroke or rect to count as a strikethrough line. */
const STRIKE_MAX_THICKNESS_PT = 2;
/** A strike line must horizontally cover at least this fraction of the item. */
const STRIKE_MIN_COVER_FRACTION = f32(0.6);

type Seg = [xmin: number, xmax: number, yCenter: number];

/** Reduce graphics to horizontal segments, as `strike` (any thin line) or `underline` (long thin line) wants them. */
function horizontalSegments(graphics: readonly GraphicPrimitive[], underline: boolean): Seg[] {
  const segs: Seg[] = [];
  for (const g of graphics) {
    if ("Stroke" in g) {
      const { x1, y1, x2, y2, width } = g.Stroke;
      const dy = Math.abs(f32(y1 - y2));
      const dx = Math.abs(f32(x1 - x2));
      const long = underline ? dx > f32(4 * Math.max(dy, f32(0.1))) : dx > dy;
      if (dy <= STRIKE_MAX_THICKNESS_PT && width <= STRIKE_MAX_THICKNESS_PT && long) {
        segs.push([Math.min(x1, x2), Math.max(x1, x2), f32(f32(y1 + y2) * f32(0.5))]);
      }
    } else {
      // A thin, wide filled rect acts as a line.
      const b = g.Rect.bbox;
      const long = underline ? b.width > f32(4 * Math.max(b.height, f32(0.1))) : b.width > b.height;
      if (b.height <= STRIKE_MAX_THICKNESS_PT && long) {
        segs.push([b.x, f32(b.x + b.width), f32(b.y + f32(b.height * f32(0.5)))]);
      }
    }
  }
  return segs;
}

/**
 * Mark text items whose vertical middle band is crossed by a thin horizontal line (a
 * strikethrough, drawn as a stroke or a thin filled rect). Underlines (near the baseline) and
 * overlines (near the top) are excluded by the band check; the per-item width-coverage gate keeps
 * long dividers from tagging incidental text they cross.
 */
export function assignStrikethrough(
  items: TextItem[],
  graphics: readonly GraphicPrimitive[]
): void {
  const segs = horizontalSegments(graphics, false);
  if (segs.length === 0) return;
  for (const item of items) {
    // A fraction bar runs through the middle of its math item.
    if (item.math || item.width <= 0 || item.height <= 0 || trim(item.text) === "") continue;
    // Viewport space is top-left origin, so `y` is the top edge: the middle band sits below the top and above the baseline.
    const bandTop = f32(item.y + f32(item.height * f32(0.2)));
    const bandBot = f32(item.y + f32(item.height * f32(0.65)));
    const ix0 = item.x;
    const ix1 = f32(item.x + item.width);
    for (const [sx0, sx1, sy] of segs) {
      if (sy < bandTop || sy > bandBot) continue;
      const overlap = Math.max(f32(Math.min(ix1, sx1) - Math.max(ix0, sx0)), 0);
      if (overlap >= f32(item.width * STRIKE_MIN_COVER_FRACTION)) {
        item.strike = true;
        break;
      }
    }
  }
}

/**
 * Mark text items underlined by a thin horizontal line just below their baseline. An underline is
 * judged per line: the text sitting on it must cover most of its length, so table borders and rules
 * (which run on past the text above them) underline nothing, while one underline under several
 * word items marks them all.
 */
export function assignUnderline(items: TextItem[], graphics: readonly GraphicPrimitive[]): void {
  for (const [sx0, sx1, sy] of horizontalSegments(graphics, true)) {
    const len = f32(sx1 - sx0);
    if (len < 2) continue;
    // Items whose baseline region the line runs under: below the lower fifth of the box, at most a
    // quarter of the box height (2 pt floor) beneath it.
    const on: number[] = [];
    items.forEach((it, i) => {
      if (
        !it.math &&
        it.width > 0 &&
        it.height > 0 &&
        f32(remEuclid(it.rotation, 360)) < 1 &&
        trim(it.text) !== "" &&
        sy >= f32(it.y + f32(it.height * f32(0.8))) &&
        sy <= f32(f32(it.y + it.height) + Math.max(f32(it.height * f32(0.25)), 2)) &&
        it.x < sx1 &&
        f32(it.x + it.width) > sx0
      ) {
        on.push(i);
      }
    });
    if (on.length === 0) continue;
    // Covered length of the line (union of the items' clipped extents).
    const spans = on
      .map((i): [number, number] => [
        Math.max(items[i].x, sx0),
        Math.min(f32(items[i].x + items[i].width), sx1),
      ])
      .sort((a, b) => totalCmp(a[0], b[0]));
    let covered = 0;
    let reach = -Infinity;
    for (const [a0, b] of spans) {
      const a = Math.max(a0, reach);
      if (b > a) covered = f32(covered + f32(b - a));
      reach = Math.max(reach, b);
    }
    if (covered < f32(len * f32(0.7))) continue;
    for (const i of on) {
      const it = items[i];
      const overlap = Math.max(f32(Math.min(f32(it.x + it.width), sx1) - Math.max(it.x, sx0)), 0);
      if (overlap >= f32(it.width * f32(0.5))) it.underline = true;
    }
  }
}
