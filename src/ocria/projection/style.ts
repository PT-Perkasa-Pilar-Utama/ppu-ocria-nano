// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of the font-style predicates in liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0).

import type { TextItem } from "../types/text-item.js";

const PDF_FONT_FLAG_FIXED_PITCH = 1;
const PDF_FONT_FLAG_ITALIC = 64;
const PDF_FONT_FLAG_FORCE_BOLD = 262144;

/** Font-name substrings that indicate bold weight. */
const BOLD_NAME_HINTS = ["Bold", "Black", "Heavy", "Semibold", "Demibold"];
/** Font-name substrings that indicate italic / oblique slant. */
const ITALIC_NAME_HINTS = ["Italic", "Oblique"];
/** Font-name substrings that indicate a monospaced typeface. */
const MONO_NAME_HINTS = [
  "Courier",
  "Mono",
  "Consolas",
  "Menlo",
  "Source Code",
  "Inconsolata",
  "Hack",
  "Fira Code",
];

function nameContainsAny(name: string, hints: readonly string[]): boolean {
  return hints.some((h) => name.includes(h));
}

/** Bold from a font's flags (ForceBold), weight (600+) or name. */
export function fontIsBold(
  name: string | null | undefined,
  weight: number | null | undefined,
  flags: number | null | undefined
): boolean {
  return (
    (flags != null && (flags & PDF_FONT_FLAG_FORCE_BOLD) !== 0) ||
    (weight != null && weight >= 600) ||
    (name != null && nameContainsAny(name, BOLD_NAME_HINTS))
  );
}

/** Italic from a font's flags or name. */
export function fontIsItalic(
  name: string | null | undefined,
  flags: number | null | undefined
): boolean {
  return (
    (flags != null && (flags & PDF_FONT_FLAG_ITALIC) !== 0) ||
    (name != null && nameContainsAny(name, ITALIC_NAME_HINTS))
  );
}

export function isBoldItem(item: TextItem): boolean {
  if (item.style_pieces.length > 0) return item.style_pieces.every(isBoldItem);
  return fontIsBold(item.font_name, item.font_weight, item.font_flags);
}

export function isItalicItem(item: TextItem): boolean {
  if (item.style_pieces.length > 0) return item.style_pieces.every(isItalicItem);
  return fontIsItalic(item.font_name, item.font_flags);
}

export function isStrikeItem(item: TextItem): boolean {
  return item.strike;
}

export function isMonoItem(item: TextItem): boolean {
  if (item.font_flags != null && (item.font_flags & PDF_FONT_FLAG_FIXED_PITCH) !== 0) return true;
  return item.font_name != null && nameContainsAny(item.font_name, MONO_NAME_HINTS);
}
