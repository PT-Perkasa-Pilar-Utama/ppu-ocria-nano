// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/inline.rs (crates-v2.21.2, Apache-2.0): line rendering.

import { isBoldItem, isMonoItem } from "../../projection/style.js";
import { f32, totalCmp, trim } from "../../rust.js";
import { splitWhitespace } from "../../rust-extra.js";
import type { ProjectedLine } from "../../types/page.js";
import type { TextItem } from "../../types/text-item.js";
import { collapseWhitespace } from "../paragraphs/index.js";
import { applyLink, renderSpan } from "./apply-style.js";
import { spanStyleEq, spanStyleFromItem } from "./style.js";
import type { SpanStyle } from "./style.js";

/**
 * A line's spans as the renderer styles them: a merged item that kept its differently-styled
 * pieces (`TextItem::style_pieces`) contributes those pieces.
 */
export function styledSpans(line: ProjectedLine): TextItem[] {
  return line.spans
    .flatMap((s) => (s.style_pieces.length === 0 ? [s] : s.style_pieces))
    .filter((s) => trim(s.text) !== "");
}

/**
 * Render a `ProjectedLine` to markdown with per-span emphasis. Adjacent
 * same-style spans are merged into a single emphasis run; whitespace between
 * spans is preserved as one space (the underlying projection output already
 * has the right inter-word spacing baked into span text).
 *
 * Per-line shortcut: when every non-whitespace span shares the same style,
 * emit one outer wrap around the collapsed line text instead of run-by-run
 * (avoids `**foo** **bar** **baz**` noise on uniformly styled lines).
 *
 * Falls back to `collapseWhitespace(line.text)` when the line has no usable
 * spans (e.g. OCR-only lines where TextItem styling isn't populated).
 */
export function renderLineInline(line: ProjectedLine): string {
  const spans = styledSpans(line);
  if (spans.length === 0) return collapseWhitespace(line.text);

  // Sort spans into reading order regardless of extraction order. Stable so
  // equal-x spans keep their original sequence. A right-to-left line reads
  // from the highest x down, matching the join `build_one_line` used for
  // `line.text` — the uniform-style shortcut below falls back on that string,
  // so the two orderings have to agree.
  if (line.rtl) spans.sort((a, b) => totalCmp(b.x, a.x));
  else spans.sort((a, b) => totalCmp(a.x, b.x));

  const styles = spans.map(spanStyleFromItem);
  const links = spans.map((s) => s.link ?? null);

  // Per-line shortcut: only when the whole line shares one style AND carries
  // no hyperlinks (a link must wrap only the spans it covers, so link lines
  // always take the per-group path below).
  const uniform = styles.every((s) => spanStyleEq(s, styles[0])) && links.every((l) => l === null);
  if (uniform) {
    const joined = collapseWhitespace(line.text);
    if (joined === "") return joined;
    return renderSpan(joined, styles[0]);
  }

  // Group consecutive spans by style. Within a group, span texts join with
  // a single space (we lose intra-group spacing precision; acceptable).
  let out = "";
  let i = 0;
  while (i < spans.length) {
    const style = styles[i];
    const link = links[i];
    let j = i + 1;
    while (j < spans.length && spanStyleEq(styles[j], style) && links[j] === link) j++;
    let groupRaw = "";
    for (const span of spans.slice(i, j)) {
      if (groupRaw !== "" && !groupRaw.endsWith(" ")) groupRaw += " ";
      groupRaw += trim(span.text);
    }
    const groupText = collapseWhitespace(groupRaw);
    let rendered = renderSpan(groupText, style);
    if (link !== null) rendered = applyLink(rendered, link);
    // Between groups, a space only where the page has one: a style that changes inside a
    // word (`Taha` + raised `1`, `**Note**` + `:`) abuts its neighbour.
    if (
      out !== "" &&
      !out.endsWith(" ") &&
      (i === 0 || spansSeparated(spans[i - 1], spans[i], line.text, line.rtl))
    ) {
      out += " ";
    }
    out += rendered;
    i = j;
  }
  return out;
}

/**
 * Whether two consecutive spans of a line (in reading order) are separated by a space. The
 * line's own text (projection's join, which already decided word spacing) answers when it holds
 * the two spans' touching words either joined or apart (not at a sub/superscript, which its
 * join spaces off); otherwise the page geometry does: a
 * gap over an eighth of the smaller span's height (a word space is a quarter em or more).
 */
export function spansSeparated(a: TextItem, b: TextItem, lineText: string, rtl: boolean): boolean {
  const aWords = splitWhitespace(a.text);
  const bWords = splitWhitespace(b.text);
  const last = aWords.length > 0 ? aWords[aWords.length - 1] : "";
  const first = bWords.length > 0 ? bWords[0] : "";
  // a raised / lowered script hugs its word: projection's join spaces it off, the page doesn't
  const script = a.sup || a.sub || b.sup || b.sub;
  if (!script && last !== "" && first !== "") {
    const [l, r] = rtl ? [first, last] : [last, first];
    const apart = lineText.includes(`${l} ${r}`);
    const joined = lineText.includes(`${l}${r}`);
    if (apart !== joined) return apart;
  }
  const gap = rtl ? f32(a.x - f32(b.x + b.width)) : f32(b.x - f32(a.x + a.width));
  return gap > f32(Math.min(a.height, b.height) * 0.125);
}

/**
 * The shared `SpanStyle` of `line` when every non-whitespace span on the line has the same
 * style; null when spans disagree. Mono is folded into the style for the purpose of
 * "uniform": a fully-mono line is uniform-mono. Used by the paragraph-level optimization to
 * decide whether to wrap once around the whole paragraph or fall back to per-line inline.
 */
export function lineUniformStyle(line: ProjectedLine): SpanStyle | null {
  // A line carrying any hyperlink can't use the uniform fast path: the link
  // wraps only its own spans, so such lines must render via the per-group
  // path in `renderLineInline`.
  if (line.spans.some((s) => trim(s.text) !== "" && s.link != null)) return null;
  const styles = styledSpans(line).map(spanStyleFromItem);
  if (styles.length === 0) return null;
  const first = styles[0];
  for (const s of styles) if (!spanStyleEq(s, first)) return null;
  return first;
}

/**
 * True when every non-whitespace span on the line is bold and non-mono.
 * Unlike `lineUniformStyle`, this tolerates per-span *italic* variation,
 * so a heading whose spans mix bold and bold-italic still reads as a single
 * bold line. False for an empty / all-whitespace line.
 */
export function lineAllBold(line: ProjectedLine): boolean {
  let sawSpan = false;
  for (const span of line.spans) {
    if (trim(span.text) === "") continue;
    if (isMonoItem(span) || !isBoldItem(span)) return false;
    sawSpan = true;
  }
  return sawSpan;
}
