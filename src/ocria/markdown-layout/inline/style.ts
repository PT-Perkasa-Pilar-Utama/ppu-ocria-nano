// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/inline.rs (crates-v2.21.2, Apache-2.0): span style.

import { isBoldItem, isItalicItem, isMonoItem, isStrikeItem } from "../../projection/style.js";
import type { TextItem } from "../../types/text-item.js";

/** Per-span style flags used by the inline-emphasis renderer. */
export type SpanStyle = {
  bold: boolean;
  italic: boolean;
  mono: boolean;
  strike: boolean;
  underline: boolean;
  sup: boolean;
  sub: boolean;
};

/** `SpanStyle::from_item`. */
export function spanStyleFromItem(item: TextItem): SpanStyle {
  return {
    bold: isBoldItem(item),
    italic: isItalicItem(item),
    mono: isMonoItem(item),
    strike: isStrikeItem(item),
    underline: item.underline,
    sup: item.sup,
    sub: item.sub,
  };
}

/** `SpanStyle::is_plain`. */
export function spanStyleIsPlain(s: SpanStyle): boolean {
  return !s.bold && !s.italic && !s.mono && !s.strike && !s.underline && !s.sup && !s.sub;
}

/** `SpanStyle`'s derived `PartialEq`. */
export function spanStyleEq(a: SpanStyle, b: SpanStyle): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.mono === b.mono &&
    a.strike === b.strike &&
    a.underline === b.underline &&
    a.sup === b.sup &&
    a.sub === b.sub
  );
}
