// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/inline.rs (crates-v2.21.2, Apache-2.0): span wrapping.

import { escapeInline } from "./escape.js";
import type { SpanStyle } from "./style.js";

/**
 * Escape `text` for use as the body of a span with `style`. Backslash escapes
 * are inert inside code spans per CommonMark, so mono text is passed through
 * verbatim.
 */
export function styleBody(text: string, style: SpanStyle): string {
  return style.mono ? text : escapeInline(text);
}

/**
 * Wrap `inner` with the markdown markers for `style`. Mono wins over bold/italic:
 * inline code doesn't compose with emphasis in CommonMark, so when a span is
 * mono we drop the `**` / `*` wrap. Bold + italic is `***…***`.
 */
export function applyStyle(inner: string, style: SpanStyle): string {
  let styled: string;
  if (style.mono) {
    // The fence must be longer than the longest backtick run inside the
    // content (a matching-length interior run would close the span early),
    // with a space buffer so an edge backtick can't merge into the fence.
    // CommonMark strips one space from each end, so the content round-trips.
    let longest = 0;
    let run = 0;
    for (const c of inner) {
      run = c === "`" ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    if (longest === 0) {
      styled = `\`${inner}\``;
    } else {
      const fence = "`".repeat(longest + 1);
      styled = `${fence} ${inner} ${fence}`;
    }
  } else if (style.sup || style.sub) {
    // a footnote marker or index: the script tag alone (`<sup>**1**</sup>` reads as noise)
    styled = inner;
  } else if (style.bold && style.italic) {
    styled = `***${inner}***`;
  } else if (style.bold) {
    styled = `**${inner}**`;
  } else if (style.italic) {
    styled = `*${inner}*`;
  } else {
    styled = inner;
  }
  // Raised / lowered script: HTML `<sup>` / `<sub>` (no markdown syntax).
  if (style.sup) styled = `<sup>${styled}</sup>`;
  else if (style.sub) styled = `<sub>${styled}</sub>`;
  // Underline has no markdown syntax: HTML `<u>…</u>`, outside emphasis and code.
  if (style.underline) styled = `<u>${styled}</u>`;
  // Strikethrough (GFM `~~…~~`) wraps outermost so it composes with emphasis
  // and inline code (`~~**foo**~~`, `` ~~`bar`~~ ``).
  return style.strike ? `~~${styled}~~` : styled;
}

/**
 * Render `text` as a single styled markdown span: style-aware escaping
 * (`styleBody`) plus marker wrapping (`applyStyle`). Always use this pair
 * through here: calling `escapeInline` + `applyStyle` directly would
 * backslash-escape the body of a code span, which CommonMark renders literally.
 */
export function renderSpan(text: string, style: SpanStyle): string {
  return applyStyle(styleBody(text, style), style);
}

/**
 * Wrap `inner` in a markdown inline link to `url`. Uses the angle-bracket
 * destination form when the URL contains characters that would otherwise
 * terminate or break the `(url)` form (whitespace or parentheses).
 */
export function applyLink(inner: string, url: string): string {
  if (/[ \t()]/.test(url)) return `[${inner}](<${url}>)`;
  return `[${inner}](${url})`;
}
