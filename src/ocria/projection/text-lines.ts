// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): rendered-line string helpers.

import { utf8Len } from "../rust-extra.js";
import { charCount, chars, f32, isWhitespace, trim, trimEnd, trimStart } from "../rust.js";
import type { BoxMeta } from "./flowing.js";

export const FLOATING_SPACES = 2;
export const COLUMN_SPACES = 4;

/** Visual (character) length of a string, not byte length. Use this for column calculations. */
export function charLen(s: string): number {
  return charCount(s);
}

export function trimEndLen(s: string): number {
  return charLen(trimEnd(s));
}

/** Spaces to leave after a line's text before the next item, given the item's spacing hint. */
export function lineSpaceEnd(rawLine: string, shouldSpace: number): number {
  let spaceEnd = 0;
  if (!rawLine.endsWith(" ")) spaceEnd = shouldSpace;
  if (shouldSpace > 1) {
    const trailingSpaces = Math.max(charLen(rawLine) - trimEndLen(rawLine), 0);
    if (trailingSpaces < shouldSpace) spaceEnd = shouldSpace - trailingSpaces;
  }
  return spaceEnd;
}

/** Whether every item before `idx` on the line has been rendered. */
export function canRenderBbox(metaLine: readonly BoxMeta[], idx: number): boolean {
  for (let i = 0; i < Math.min(idx, metaLine.length); i++) {
    if (!metaLine[i].rendered) return false;
  }
  return true;
}

/** Replace each run of at least `minRun` spaces with `replaceWith` spaces. */
export function compressWideSpaces(line: string, minRun: number, replaceWith: number): string {
  // ASCII spaces are UTF-8 boundaries, and a space is never half of a surrogate pair,
  // so scanning UTF-16 units keeps the other text untouched, as the Rust byte scan does.
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] === " ") {
      const start = i;
      while (i < line.length && line[i] === " ") i++;
      const runLen = i - start;
      out += " ".repeat(runLen >= minRun ? replaceWith : runLen);
    } else {
      const start = i;
      while (i < line.length && line[i] !== " ") i++;
      out += line.slice(start, i);
    }
  }
  return out;
}

/** Compress the column gaps of a block that is mostly whitespace (a sparse layout). */
export function fixSparseBlocks(rawLines: string[], start: number, end: number): void {
  let total = 0;
  let whitespace = 0;
  const hi = Math.min(end, rawLines.length);

  for (let i = start; i < hi; i++) {
    rawLines[i] = trimEnd(rawLines[i]);
    if (rawLines[i] === "") continue;
    total += utf8Len(rawLines[i]);
    for (const c of chars(rawLines[i])) if (isWhitespace(c)) whitespace++;
  }

  if (total >= 500 && f32(f32(whitespace) / f32(total)) > f32(0.8)) {
    for (let i = start; i < hi; i++) {
      if (rawLines[i] === "") continue;
      rawLines[i] = compressWideSpaces(rawLines[i], COLUMN_SPACES, FLOATING_SPACES);
    }
  }
}

/** `&s[n..]` for a UTF-8 byte offset `n`; Rust panics when `n` splits a character. */
function sliceFromByte(s: string, n: number): string {
  let bytes = 0;
  let idx = 0;
  for (const c of s) {
    if (bytes === n) return s.slice(idx);
    if (bytes > n) break;
    bytes += utf8Len(c);
    idx += c.length;
  }
  if (bytes === n) return s.slice(idx);
  throw new RangeError(`byte index ${n} is not a character boundary`);
}

/**
 * Post-rendering text cleanup: remove the top margin (leading empty lines),
 * the bottom margin (trailing empty lines) and the left margin (consistent
 * leading whitespace), and replace null characters with spaces.
 */
export function cleanRenderedText(input: string): string {
  const lines = input.split("\0").join(" ").split("\n");

  // Find bounds of content and minimum left indentation
  let minX: number | null = null;
  let minY: number | null = null;
  let maxY: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (trim(line) === "") continue;
    const leading = utf8Len(line) - utf8Len(trimStart(line));
    minX = minX === null ? leading : Math.min(minX, leading);
    if (minY === null) minY = i;
    maxY = i;
  }

  if (minX === null || minY === null || maxY === null) return "";
  const left: number = minX;
  return lines
    .slice(minY, maxY + 1)
    .map((line) => (utf8Len(line) > left ? sliceFromByte(line, left) : trimEnd(line)))
    .join("\n");
}
