// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0): OCR result filters (rule artifacts, native overlap, table-border cleaning).

import { chars, f32, isAlphanumeric, totalCmp, trim } from "../rust.js";
import type { TextItem } from "../types/text-item.js";
import { isAsciiDigit, trimEndChars, trimStartChars } from "../rust-extra.js";

/**
 * Maximum width/height ratio for a single-glyph OCR result to count as a
 * misread rule: real narrow glyphs ("1", "l", "I") in a tight OCR box sit
 * around 0.3-0.5 of their height; a table border is a hairline.
 */
const RULE_ARTIFACT_MAX_ASPECT = f32(0.35);

/** Single glyphs Tesseract-style engines read from a vertical rule or bracket border. */
const BAR_GLYPHS = "|Il1!ij[](){}/\\";

/**
 * An OCR result that is a misread of a rule/border or pure decoration, not
 * text: no letters or digits at all, or a single bar-like glyph in a box far
 * narrower than it is tall.
 */
export function isRuleArtifact(text: string, w: number, h: number): boolean {
  const trimmed = trim(text);
  const cs = chars(trimmed);
  if (trimmed === "" || !cs.some(isAlphanumeric)) return true;
  return (
    cs.length === 1 && BAR_GLYPHS.includes(cs[0]) && h > 0 && w < f32(RULE_ARTIFACT_MAX_ASPECT * h)
  );
}

/**
 * Least share of an OCR line's width that kept native text must cover, on a page whose
 * garbled fonts were dropped, for the line to count as already present.
 */
export const PARTIAL_NATIVE_COVERAGE: number = f32(0.5);

/**
 * Share of the box's width covered by native items on its line (vertical overlap of at
 * least half the shorter height), their horizontal extents merged.
 */
export function nativeWidthCoverage(
  items: readonly TextItem[],
  x: number,
  y: number,
  w: number,
  h: number
): number {
  if (w <= 0) return 1;
  const spans: Array<[number, number]> = [];
  for (const it of items) {
    const v = f32(Math.min(f32(y + h), f32(it.y + it.height)) - Math.max(y, it.y));
    if (!(v > f32(0.5 * Math.min(h, it.height)))) continue;
    const a = Math.max(it.x, x);
    const b = Math.min(f32(it.x + it.width), f32(x + w));
    if (b > a) spans.push([a, b]);
  }
  spans.sort((a, b) => totalCmp(a[0], b[0]));
  let covered = 0;
  let end = Number.NEGATIVE_INFINITY;
  for (const [a, b] of spans) {
    if (b > end) {
      covered = f32(covered + f32(b - Math.max(a, end)));
      end = b;
    }
  }
  return f32(covered / w);
}

/** Check if an OCR bounding box overlaps with any existing text item. */
export function overlapsExistingText(
  items: readonly TextItem[],
  ocrX: number,
  ocrY: number,
  ocrW: number,
  ocrH: number,
  tolerance: number
): boolean {
  for (const item of items) {
    const itemRight = f32(item.x + item.width);
    const itemBottom = f32(item.y + item.height);
    const overlapX =
      ocrX < f32(itemRight + tolerance) && f32(ocrX + ocrW) > f32(item.x - tolerance);
    const overlapY =
      ocrY < f32(itemBottom + tolerance) && f32(ocrY + ocrH) > f32(item.y - tolerance);
    if (overlapX && overlapY) return true;
  }
  return false;
}

const BORDER_CHARS = "|[](){}";
const NUMERIC_PUNCT = ",. %-+*/";

/**
 * Clean common OCR artifacts from table border misreads.
 * OCR often misreads vertical table border lines as bracket-like characters.
 */
export function cleanOcrTableArtifacts(text: string): string {
  const trimmed = trim(text);
  if (trimmed === "") return "";

  // Strip leading/trailing border artifact characters: | [ ] ( ) { }
  const withoutArtifacts = trim(trimEndChars(trimStartChars(trimmed, BORDER_CHARS), BORDER_CHARS));
  if (withoutArtifacts === "") return trimmed;

  // Only use cleaned version if core content looks numeric-ish.
  // This avoids incorrectly stripping brackets from content like "(note)".
  const isNumericIsh =
    chars(withoutArtifacts).every((c) => isAsciiDigit(c) || NUMERIC_PUNCT.includes(c)) ||
    withoutArtifacts === "N/A" ||
    withoutArtifacts === "Z" ||
    withoutArtifacts === "-";
  if (!isNumericIsh) return trimmed;

  // Parentheses directly around a number mark it negative, e.g. "(78,939)",
  // so keep that pair; only what lies outside it is a border misread.
  const at = trimmed.indexOf(withoutArtifacts);
  if (at >= 0) {
    const before = trimmed.slice(0, at);
    const after = trimmed.slice(at + withoutArtifacts.length);
    if (before.endsWith("(") && after.startsWith(")")) return `(${withoutArtifacts})`;
  }
  return withoutArtifacts;
}
