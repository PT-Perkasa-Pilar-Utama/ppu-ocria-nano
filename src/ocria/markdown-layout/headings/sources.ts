// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/headings.rs (crates-v2.21.2, Apache-2.0): struct-tree and outline heading sources.

import { charCount, f32, isWhitespace, trim } from "../../rust.js";
import type { OutlineTarget, StructNode } from "../../types/document.js";
import type { ProjectedLine } from "../../types/page.js";
import { MIN_ROW_HEIGHT_PT } from "../constants.js";
import { MAX_HEADING_LEVELS } from "./constants.js";

/**
 * Parse a struct-tree role string like "H1" or "H3" into a heading level.
 * Returns null for non-heading roles (P, L, Figure, Table, ...).
 */
export function parseHeadingRole(role: string): number | null {
  const trimmed = trim(role);
  if (!trimmed.startsWith("H") && !trimmed.startsWith("h")) return null;
  const digits = trimmed.slice(1);
  // u8::from_str accepts an optional '+' sign and ASCII digits, up to 255.
  const m = /^\+?([0-9]+)$/.exec(digits);
  if (m === null) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 6 ? n : null;
}

/**
 * Highest-priority heading source: a struct-tree node `H1`..`H6` directly
 * tagging this line via its `mcid`. Available only for tagged PDFs.
 */
export function structHeadingLevel(line: ProjectedLine, structNodes: StructNode[]): number | null {
  const mcid = line.mcid;
  if (mcid == null) return null;
  for (const node of structNodes) {
    if (!node.mcids.includes(mcid)) continue;
    const level = parseHeadingRole(node.role);
    if (level !== null) return level;
  }
  return null;
}

/**
 * Lowercase + collapse whitespace, for forgiving outline-title vs line-text
 * comparison. Outline titles often have trailing numbering or punctuation
 * not present on the rendered line (and vice versa).
 */
export function normalizeOutlineText(s: string): string {
  let out = "";
  let prevSpace = true;
  for (const c of s) {
    if (isWhitespace(c)) {
      if (!prevSpace) {
        out += " ";
        prevSpace = true;
      }
    } else {
      out += c.toLowerCase();
      prevSpace = false;
    }
  }
  return out.endsWith(" ") ? out.slice(0, -1) : out;
}

/**
 * Second-priority heading source: a document outline (bookmark) entry that
 * points at this page near this line's y coordinate, with a title that
 * prefix-matches the line text. Used on untagged PDFs that ship a TOC.
 */
export function outlineHeadingLevel(
  line: ProjectedLine,
  pageHeight: number,
  outline: OutlineTarget[],
  lineText: string
): number | null {
  if (outline.length === 0) return null;
  const normalizedLine = normalizeOutlineText(lineText);
  if (normalizedLine === "") return null;
  const rowH = Math.max(line.bbox.height, MIN_ROW_HEIGHT_PT);
  const yTolerance = f32(rowH * f32(1.5));
  for (const entry of outline) {
    const normalizedTitle = normalizeOutlineText(entry.title);
    if (normalizedTitle === "") continue;
    // Spatial check is *strict* only when the entry actually carries a
    // usable y (in-page). Many bookmarks point at "top of page" with a
    // Y outside the MediaBox or no Y at all — in that case we still
    // accept any line on the page that prefix-matches the title.
    if (entry.y_pdf != null) {
      const yView = f32(pageHeight - entry.y_pdf);
      const inPage = !(yView < 0 || yView > pageHeight);
      if (inPage && !(Math.abs(f32(yView - line.bbox.y)) <= yTolerance)) continue;
    }
    // Short outline titles ("Nutrition") would otherwise false-match any
    // paragraph that happens to start with them. Require the matched line
    // to be heading-shaped: not much longer than the title itself.
    const lineLen = charCount(normalizedLine);
    const titleLen = charCount(normalizedTitle);
    const maxLineLen = Math.max(titleLen * 3, 120);
    // Multiple sentences → almost certainly prose, not a heading line.
    const sentenceBreaks = normalizedLine.split(". ").length - 1;
    if (lineLen > maxLineLen || sentenceBreaks >= 2) continue;
    // Run-in label guard: a single ". " sentence break is OK on a heading
    // only when the line is roughly title-shaped. When the line carries
    // substantial body text past the title, it's a paragraph leading with a
    // bold run-in label, not a section heading.
    if (sentenceBreaks >= 1 && lineLen > titleLen + 15) continue;
    if (normalizedLine.startsWith(normalizedTitle) || normalizedTitle.startsWith(normalizedLine)) {
      return Math.min(entry.level, MAX_HEADING_LEVELS);
    }
  }
  return null;
}
