// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): build_one_line.

import { isRtlPieces } from "../bidi.js";
import { roundF32 } from "../rust-extra.js";
import { asUsize, f32, totalCmp } from "../rust.js";
import type { Anchor, Rect } from "../types/geometry.js";
import type { ProjectedLine } from "../types/page.js";
import type { TextItem } from "../types/text-item.js";
import { cloneTextItem } from "./projected-item.js";
import { isBoldItem, isItalicItem, isMonoItem } from "./style.js";
import type { ProjectedTextItem } from "./types.js";

/** char-weight accumulator keyed by a rounded size: the first size seen under a key and its characters. */
type SizeWeights = Map<number, [number, number]>;

function addSize(weights: SizeWeights, key: number, value: number, n: number): void {
  const e = weights.get(key);
  if (e) e[1] += n;
  else weights.set(key, [value, n]);
}

/**
 * The value under the key with the most characters; equal weights go to the
 * larger key. Rust takes `max_by_key(|(k, (_, n))| (n, k))` over a HashMap, so
 * the key tie-break is what keeps the result stable across runs.
 */
function dominantSize(weights: SizeWeights): number | null {
  let bestKey = -1;
  let best: [number, number] | null = null;
  for (const [k, v] of weights) {
    if (best === null || v[1] > best[1] || (v[1] === best[1] && k > bestKey)) {
      bestKey = k;
      best = v;
    }
  }
  return best === null ? null : best[0];
}

/** Rust `&str` ordering: UTF-8 byte order, which is code point order (not UTF-16 unit order). */
function cmpStr(a: string, b: string): number {
  const ca = Array.from(a);
  const cb = Array.from(b);
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const d = (ca[i].codePointAt(0) ?? 0) - (cb[i].codePointAt(0) ?? 0);
    if (d !== 0) return d;
  }
  return ca.length - cb.length;
}

const ANCHOR_BY_KEY: readonly Anchor[] = ["Left", "Right", "Center", "Floating"];

const ANCHOR_KEY: Record<Anchor, number> = { Left: 0, Right: 1, Center: 2, Floating: 3 };

/** `(x * 100).round() as u32` */
const sizeKey = (v: number): number => asUsize(roundF32(f32(v * 100.0)));

/** Group `idxs` (indices into `items`) into one `ProjectedLine`. */
export function buildOneLine(
  items: readonly ProjectedTextItem[],
  idxs: readonly number[],
  regionPath: number[],
  figures: readonly Rect[],
  pageHasNativeText: boolean
): ProjectedLine {
  // Sort by x so concatenation reads left to right even if reading order had
  // rotated insertions. `spans` stays in this x-ascending order (the table
  // cell splitter and the inline emphasis renderer both read geometry off it)
  // while `text` below is joined in reading order, which for a right-to-left
  // line runs the other way across the page.
  const sorted = [...idxs];
  sorted.sort((a, b) => totalCmp(items[a].item.x, items[b].item.x));

  const pieceTexts: string[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  // Original-coordinate bbox (pre-rotation-displacement). `figures` are in
  // original page space, so figure-overlap must be tested here, not against
  // the projected `bbox` below (which can be displaced onto a virtual canvas
  // by `handle_rotation_reading_order`).
  let ominX = Infinity;
  let ominY = Infinity;
  let omaxX = -Infinity;
  let omaxY = -Infinity;

  const sizeWeights: SizeWeights = new Map();
  const heightWeights: SizeWeights = new Map();
  // Matrix-derived true on-page size (`Tf_size x text_matrix_scale`, computed
  // in extract.rs). For matrix-baked-size fonts this is the precise size the
  // raw `font_size` (about 1.0) hides; jitter-free, unlike bbox height.
  const fontHeightWeights: SizeWeights = new Map();
  const nameWeights = new Map<string, number>();
  let boldChars = 0;
  let italicChars = 0;
  let monoChars = 0;
  let totalChars = 0;
  // Chars contributed by OCR-sourced items. Their `font_size` is the OCR box
  // height, i.e. a bbox estimate with the same jitter as the baked-size
  // fallback below, so an OCR-dominated line is flagged
  // `font_size_is_estimated` and gets the wider heading margin. Without this,
  // chart labels OCR'd at 9.1-9.6pt next to a 9pt body open heading levels the
  // body then matches under the 0.6pt tolerance.
  let ocrChars = 0;
  const anchorWeights = new Map<number, number>();
  let mcid: number | null = null;
  const spans: TextItem[] = [];

  for (const i of sorted) {
    const proj = items[i];
    const it = proj.item;
    // `handle_rotation_reading_order` zeroes `item.rotation` after it reorders
    // cardinal-rotated text into reading order, so the span would otherwise
    // look horizontal to `is_rotated_line`. Restore the original rotation onto
    // the span clone (only consumed by markdown heading/TOC rotation guards)
    // so a sideways margin stamp doesn't pollute the heading-size map.
    const span = cloneTextItem(it);
    span.rotation = proj.orig_rotation;
    spans.push(span);

    // The markdown emitter re-collapses whitespace, so we just ensure there's
    // some separation between adjacent items.
    pieceTexts.push(it.text);

    minX = Math.min(minX, it.x);
    minY = Math.min(minY, it.y);
    maxX = Math.max(maxX, f32(it.x + it.width));
    maxY = Math.max(maxY, f32(it.y + it.height));

    ominX = Math.min(ominX, proj.orig_x);
    ominY = Math.min(ominY, proj.orig_y);
    omaxX = Math.max(omaxX, f32(proj.orig_x + proj.orig_width));
    omaxY = Math.max(omaxY, f32(proj.orig_y + proj.orig_height));

    const n = Math.max(Array.from(it.text).length, 1);
    totalChars += n;
    if (it.font_name === "OCR") ocrChars += n;

    if (it.font_size != null && it.font_size > 0.0) {
      addSize(sizeWeights, sizeKey(it.font_size), it.font_size, n);
    }
    addSize(heightWeights, sizeKey(Math.max(it.height, 0.0)), it.height, n);
    if (it.font_height != null && it.font_height > 1.5) {
      addSize(fontHeightWeights, sizeKey(it.font_height), it.font_height, n);
    }

    if (it.font_name != null)
      nameWeights.set(it.font_name, (nameWeights.get(it.font_name) ?? 0) + n);

    if (isBoldItem(it)) boldChars += n;
    if (isItalicItem(it)) italicChars += n;
    if (isMonoItem(it)) monoChars += n;

    const akey = ANCHOR_KEY[proj.anchor];
    anchorWeights.set(akey, (anchorWeights.get(akey) ?? 0) + n);

    if (mcid === null) mcid = it.mcid ?? null;
  }

  // Join the line in reading order. PDFium already hands back each item's
  // characters in logical order, so a right-to-left line only needs its items
  // walked right-to-left across the page; otherwise an invoice line
  // like "SAR 75.00" detaches every label from its value. Direction is decided
  // from the assembled line, so a neutral-only line (pure digits) stays LTR.
  const rtl = isRtlPieces(pieceTexts);
  if (rtl) pieceTexts.reverse();
  let text = "";
  for (const piece of pieceTexts) {
    if (text !== "" && !text.endsWith(" ")) text += " ";
    text += piece;
  }

  // Tie-breaks: upstream iterates HashMaps, whose order is random per process,
  // so every tie on char-weight is broken on the bucket key to stay stable.
  const dominantSizeFromFont = dominantSize(sizeWeights) ?? 0.0;
  // Fallback: when PDFium reports font_size <= 1.5 (size baked into the text
  // matrix), use char-weighted bbox height so the size-dependent grouping
  // (tables, paragraphs) keeps its well-tuned behavior.
  const ocrDominated = ocrChars * 2 > totalChars;
  let dominantFontSize: number;
  let fontSizeIsEstimated: boolean;
  if (dominantSizeFromFont > 1.5) {
    dominantFontSize = dominantSizeFromFont;
    fontSizeIsEstimated = ocrDominated;
  } else {
    dominantFontSize = dominantSize(heightWeights) ?? 0.0;
    fontSizeIsEstimated = true;
  }

  // Precise size for heading detection only: when the raw size is baked, the
  // matrix-derived `font_height` (Tf_size x text_matrix_scale) is the
  // jitter-free on-page size, far better than the bbox-height estimate above
  // for separating headings from body. Table/paragraph grouping deliberately
  // keeps the bbox-height value to avoid regressing table structure.
  const headingFontSize = dominantSizeFromFont > 1.5 ? null : dominantSize(fontHeightWeights);

  let dominantFontName: string | null = null;
  let bestNameCount = -1;
  for (const [name, n] of nameWeights) {
    if (
      dominantFontName === null ||
      n > bestNameCount ||
      (n === bestNameCount && cmpStr(name, dominantFontName) > 0)
    ) {
      dominantFontName = name;
      bestNameCount = n;
    }
  }

  const majority = (count: number): boolean => totalChars > 0 && count * 2 > totalChars;

  let dominantAnchorKey = 0;
  let bestAnchorCount = -1;
  for (const [k, n] of anchorWeights) {
    if (n > bestAnchorCount || (n === bestAnchorCount && k > dominantAnchorKey)) {
      dominantAnchorKey = k;
      bestAnchorCount = n;
    }
  }
  const anchor: Anchor = ANCHOR_BY_KEY[dominantAnchorKey] ?? "Left";

  const finite = Number.isFinite;
  const bbox: Rect = {
    x: finite(minX) ? minX : 0.0,
    y: finite(minY) ? minY : 0.0,
    width: finite(maxX) && finite(minX) ? Math.max(f32(maxX - minX), 0.0) : 0.0,
    height: finite(maxY) && finite(minY) ? Math.max(f32(maxY - minY), 0.0) : 0.0,
  };

  // Figure membership: 50% or more of the line's original-coordinate area
  // inside a detected figure that is also clearly taller than the line. The
  // height guard is what separates real chart pollution (axis labels, legends,
  // set inside tall plot regions) from a section heading sitting on a thin
  // colored background bar, which figure detection can mis-cluster as a figure
  // about 1 line tall. Only the former should lose heading candidacy.
  const lineH = Math.max(f32(omaxY - ominY), 0.0);
  let inFigure = false;
  if (omaxX > ominX && lineH > 0.0) {
    const lineArea = f32(f32(omaxX - ominX) * lineH);
    inFigure = figures.some((f) => {
      if (f.height < f32(lineH * 3.0)) return false;
      const ix = Math.max(f32(Math.min(omaxX, f32(f.x + f.width)) - Math.max(ominX, f.x)), 0.0);
      const iy = Math.max(f32(Math.min(omaxY, f32(f.y + f.height)) - Math.max(ominY, f.y)), 0.0);
      return lineArea > 0.0 && f32(f32(ix * iy) / lineArea) >= 0.5;
    });
  }
  inFigure = inFigure || (ocrDominated && pageHasNativeText);

  return {
    text,
    rtl,
    bbox: { ...bbox },
    anchor,
    // Real column detection is deferred upstream. `indent_x` mirrors bbox.x
    // for now; the markdown emitter relies on this for paragraph/list-indent
    // comparisons within a single column.
    indent_x: bbox.x,
    dominant_font_size: dominantFontSize,
    font_size_is_estimated: fontSizeIsEstimated,
    heading_font_size: headingFontSize,
    dominant_font_name: dominantFontName,
    all_bold: majority(boldChars),
    all_italic: majority(italicChars),
    all_mono: majority(monoChars),
    all_strike: false,
    spans,
    // `items` is flattened 1:1 into `ParsedPage::text_items`, so these are the
    // public item indices.
    span_item_indices: sorted,
    region_path: regionPath,
    mcid,
    in_figure: inFigure,
  };
}
