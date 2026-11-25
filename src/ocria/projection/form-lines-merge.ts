// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): form_lines item merging.

import { isRtlChar } from "../bidi.js";
import { isAsciiDigit } from "../rust-extra.js";
import { canonicalRotation, joinInReadingOrder } from "./rotation.js";
import { chars, f32, isAlphabetic, isWhitespace, trim } from "../rust.js";
import { recordStylePiece, sameEmphasis } from "./script-style.js";
import { isMonoItem } from "./style.js";
import type { ProjectedTextItem } from "./types.js";

/** Whether the line's text can be joined from the page's x order (no right-to-left text). */
export function usesNativeGaps(items: readonly ProjectedTextItem[]): boolean {
  // Keep bidirectional ordering and punctuation on the established grid path.
  return !items.some((p) => chars(p.item.text).some(isRtlChar));
}

const WORD_GAP_ALIGNMENT_TOLERANCE = f32(0.1);
// Sheared boxes can hide small word spaces. Only subpixel residuals bridge
// those gaps, while upright text keeps the existing 0.1 pt merge allowance.
const GLYPH_GAP_HEIGHT_RATIO = f32(0.001);
const GLYPH_OVERLAP_HEIGHT_RATIO = f32(0.04);
const MERGE_Y_TOLERANCE = f32(0.1);
const MERGE_H_TOLERANCE = f32(0.1);

function gapHeight(a: ProjectedTextItem, b: ProjectedTextItem): number {
  const height = (p: ProjectedTextItem): number => p.item.font_height ?? p.orig_height;
  return Math.max(Math.min(height(a), height(b)), 0);
}

function isLatinRun(p: ProjectedTextItem): boolean {
  if (
    p.rotated ||
    p.item.confidence != null ||
    p.item.font_is_buggy ||
    p.item.has_unicode_map_error ||
    p.item.sup ||
    p.item.sub ||
    p.item.script_geom != null
  ) {
    return false;
  }
  return chars(p.item.text).every((c) => {
    if (!isAlphabetic(c)) return true;
    // SAFETY: `chars()` yields one code point per entry.
    const u = c.codePointAt(0) as number;
    return u <= 0x024f || (u >= 0x1e00 && u <= 0x1eff) || (u >= 0xfb00 && u <= 0xfb06);
  });
}

/**
 * Measure aligned native Latin runs before whole-point width rounding.
 * OCR, scripts and unreliable font mappings retain their grid checks.
 */
export function nativeGap(a: ProjectedTextItem, b: ProjectedTextItem): number | null {
  if (
    !isLatinRun(a) ||
    !isLatinRun(b) ||
    (a.item.font_size ?? null) !== (b.item.font_size ?? null) ||
    (a.item.font_height ?? null) !== (b.item.font_height ?? null) ||
    Math.abs(f32(a.orig_y - b.orig_y)) > WORD_GAP_ALIGNMENT_TOLERANCE ||
    Math.abs(f32(a.orig_height - b.orig_height)) > WORD_GAP_ALIGNMENT_TOLERANCE
  ) {
    return null;
  }
  const gap = f32(b.orig_x - f32(a.orig_x + a.orig_width));
  // Monospace and sheared boxes can overlap across genuine word spaces.
  if (
    gap < 0 &&
    (isMonoItem(a.item) ||
      isMonoItem(b.item) ||
      canonicalRotation(a.item.rotation) !== 0 ||
      canonicalRotation(b.item.rotation) !== 0)
  ) {
    return null;
  }
  const floor = -Math.min(f32(gapHeight(a, b) * GLYPH_OVERLAP_HEIGHT_RATIO), 0.5);
  return gap >= floor ? gap : null;
}

function canMerge(
  prev: ProjectedTextItem,
  cur: ProjectedTextItem,
  useNativeGaps: boolean
): boolean {
  // A script run shares its host's line band. Keep it separate until script flagging
  // can preserve it as a styled piece, even when its grid gap is zero.
  if (prev.item.script_geom != null || cur.item.script_geom != null) return false;
  if (
    Math.abs(f32(cur.item.y - prev.item.y)) <= MERGE_Y_TOLERANCE &&
    Math.abs(f32(cur.item.height - prev.item.height)) <= MERGE_H_TOLERANCE
  ) {
    // This early merge keeps one style. Preserve its grid behavior across style changes.
    const measured =
      useNativeGaps && sameEmphasis(prev.item, cur.item) ? nativeGap(prev, cur) : null;
    const deltaX = measured ?? f32(cur.item.x - f32(prev.item.x + prev.item.width));
    const rotated =
      canonicalRotation(prev.item.rotation) !== 0 || canonicalRotation(cur.item.rotation) !== 0;
    const maxGap =
      measured !== null && rotated
        ? Math.min(f32(gapHeight(prev, cur) * GLYPH_GAP_HEIGHT_RATIO), f32(0.1))
        : f32(0.1);
    return (deltaX >= -0.5 && deltaX < 0) || (deltaX >= 0 && deltaX < maxGap);
  }
  return false;
}

/** Fold the original (pre-projection) box of `cur` into `prev`. */
export function mergeOrigBbox(prev: ProjectedTextItem, cur: ProjectedTextItem): void {
  const x1 = Math.min(prev.orig_x, cur.orig_x);
  const y1 = Math.min(prev.orig_y, cur.orig_y);
  const x2 = Math.max(f32(prev.orig_x + prev.orig_width), f32(cur.orig_x + cur.orig_width));
  const y2 = Math.max(f32(prev.orig_y + prev.orig_height), f32(cur.orig_y + cur.orig_height));
  prev.orig_x = x1;
  prev.orig_y = y1;
  prev.orig_width = f32(x2 - x1);
  prev.orig_height = f32(y2 - y1);
}

// Every joiner must leave the merged item with `next`'s trailing-space
// state; a stale flag would add a space later. The line pass joins
// through here; the bbox pass appends in stream order.
function appendText(prev: ProjectedTextItem, next: ProjectedTextItem, sep: string): void {
  prev.item.text = joinInReadingOrder(prev.item.text, next.item.text, sep);
  prev.item.followed_by_space = next.item.followed_by_space;
}

/** Merge continuous bbox items in a single linear pass. */
export function mergeContinuousItems(
  items: readonly ProjectedTextItem[],
  useNativeGaps: boolean
): ProjectedTextItem[] {
  const merged: ProjectedTextItem[] = [];
  for (const cur of items) {
    const prev = merged[merged.length - 1];
    if (!prev || !canMerge(prev, cur, useNativeGaps)) {
      merged.push(cur);
      continue;
    }
    const x1 = Math.min(prev.item.x, cur.item.x);
    const y1 = Math.min(prev.item.y, cur.item.y);
    const x2 = Math.max(f32(prev.item.x + prev.item.width), f32(cur.item.x + cur.item.width));
    const y2 = Math.max(f32(prev.item.y + prev.item.height), f32(cur.item.y + cur.item.height));
    if (prev.item.followed_by_space && !prev.item.text.endsWith(" ")) prev.item.text += " ";
    prev.item.text += cur.item.text;
    prev.item.followed_by_space = cur.item.followed_by_space;
    for (const w of cur.item.words) prev.item.words.push(w);
    cur.item.words = [];
    prev.item.x = x1;
    prev.item.y = y1;
    prev.item.width = f32(x2 - x1);
    prev.item.height = f32(y2 - y1);
    mergeOrigBbox(prev, cur);
  }
  return merged;
}

const MERGE_THRESHOLD = 1.0;

const TABLE_NUMBER_TRAILING = new Set(["*", "†", "‡"]);

/**
 * Strip trailing statistical-significance markers ("0.77**", "0.31 *") so
 * decorated correlation/p-value cells still count as numbers. Without this,
 * the `both_are_numbers` guard misfires and two adjacent stat cells get merged
 * into one, destroying the table's column tracks.
 */
export function looksLikeTableNumber(text: string): boolean {
  const cs = chars(trim(text));
  let end = cs.length;
  while (end > 0 && (TABLE_NUMBER_TRAILING.has(cs[end - 1]) || isWhitespace(cs[end - 1]))) end--;
  if (end < 2) return false;

  let i = 0;
  if (cs[i] === "$") i++;
  if (cs[i] === "-") i++;

  let hasDigit = false;
  let hasDecimal = false;
  for (; i < end; i++) {
    const c = cs[i];
    if (isAsciiDigit(c)) {
      hasDigit = true;
    } else if (c === ",") {
      continue;
    } else if (c === ".") {
      if (hasDecimal) return false;
      hasDecimal = true;
    } else if (c === "%") {
      return hasDigit && cs[end - 1] === "%";
    } else {
      return false;
    }
  }
  return hasDigit;
}

function lastChar(s: string): string | undefined {
  const cs = chars(s);
  return cs[cs.length - 1];
}

/** "15" followed by ".6": PDFium sometimes emits the fraction as its own x-contiguous run. */
function isDecimalContinuation(
  prev: ProjectedTextItem,
  item: ProjectedTextItem,
  yCompatible: boolean,
  deltaX: number
): boolean {
  if (!yCompatible || !(deltaX >= -2 && deltaX <= 1)) return false;
  const last = lastChar(prev.item.text);
  if (last === undefined || !isAsciiDigit(last)) return false;
  const cs = chars(item.item.text);
  return cs[0] === "." && cs[1] !== undefined && isAsciiDigit(cs[1]);
}

/** Fold `item` into `prev`: its span, text, words and original box. */
function absorb(prev: ProjectedTextItem, item: ProjectedTextItem, sep: string): void {
  prev.item.width = f32(f32(item.item.x + item.item.width) - prev.item.x);
  appendText(prev, item, sep);
  for (const w of item.item.words) prev.item.words.push(w);
  item.item.words = [];
  mergeOrigBbox(prev, item);
}

/** Merge "words" on one line: adjacent items that touch or nearly touch become one. */
export function mergeWordsInLine(
  line: readonly ProjectedTextItem[],
  styleRuns: boolean,
  useNativeGaps: boolean
): ProjectedTextItem[] {
  const mergedLine: ProjectedTextItem[] = [];
  for (const item of line) {
    const prev = mergedLine[mergedLine.length - 1];
    if (prev) {
      const bothAreNumbers =
        looksLikeTableNumber(prev.item.text) && looksLikeTableNumber(item.item.text);
      const deltaX = f32(f32(item.item.x - prev.item.x) - prev.item.width);
      // Don't merge items with noticeably different y positions (>1.5px).
      // Items on the same baseline typically differ by <0.5px.
      const yCompatible = Math.abs(f32(item.item.y - prev.item.y)) <= 1.5;

      // Decimal-fragment continuation: PDFium sometimes emits the fractional part
      // of a number ("15.6", "200.4") as a separate, x-contiguous run beginning
      // with the decimal point (".6"). `both_are_numbers` below would keep them
      // apart, leaving "15 .6" in the rendered cell and injecting a spurious column
      // track between them. A real pair of adjacent table numbers always has a
      // visible inter-cell gap, never a digit butted directly against a
      // leading-decimal run, so this is safe to join silently.
      if (isDecimalContinuation(prev, item, yCompatible, deltaX)) {
        // Markdown renders the pieces, so a numeric suffix must join both views.
        if (
          styleRuns &&
          (prev.item.style_pieces.length > 0 || !sameEmphasis(prev.item, item.item))
        ) {
          recordStylePiece(prev.item, item.item, "");
        }
        absorb(prev, item, "");
        continue;
      }

      // Word-boundary guard: when prev ends with an alphabetic character and item
      // starts with one, a positive delta_x is very likely a missing-space gap
      // (PDFium omitted the space glyph between two words), not a deliberate silent
      // join. Silent-merging here fuses "of the" into "ofthe". Skip the silent path
      // so the items stay separate and the line builder inserts a space based on
      // `gap > space_threshold`. Punctuation joins (`Standards`+`.`, `width`+`)`)
      // and overlapping/negative-gap merges still go through.
      const gap = (useNativeGaps ? nativeGap(prev, item) : null) ?? deltaX;
      const prevLast = lastChar(prev.item.text);
      const itemFirst = chars(item.item.text)[0];
      const alphaAlphaGap =
        gap > 0 &&
        prevLast !== undefined &&
        isAlphabetic(prevLast) &&
        itemFirst !== undefined &&
        isAlphabetic(itemFirst);
      // Items merge whatever their emphasis, so lines, tables and blocks see the same
      // items in every output; for markdown a merge across an emphasis change keeps
      // the pieces, so each renders in its own style (`record_style_piece`).
      const keepPieces =
        styleRuns && (prev.item.style_pieces.length > 0 || !sameEmphasis(prev.item, item.item));
      if (yCompatible && !bothAreNumbers && !alphaAlphaGap && deltaX <= MERGE_THRESHOLD) {
        const sep = prev.item.followed_by_space ? " " : "";
        if (keepPieces) recordStylePiece(prev.item, item.item, sep);
        absorb(prev, item, sep);
        continue;
      }

      const prevLen = Math.max(chars(prev.item.text).length, 1);
      const avgCharWidth = f32(prev.item.width / prevLen);
      if (yCompatible && !bothAreNumbers && deltaX < avgCharWidth) {
        if (keepPieces) recordStylePiece(prev.item, item.item, " ");
        absorb(prev, item, " ");
        continue;
      }
    }
    mergedLine.push(item);
  }
  return mergedLine;
}
