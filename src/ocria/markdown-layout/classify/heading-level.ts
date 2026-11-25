// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): heading level of one line.

import { charCount, chars, f32, isLowercase, trimEnd } from "../../rust.js";
import type { ProjectedLine } from "../../types/page.js";
import {
  HEADING_MAX_TEXT_CHARS,
  MAX_HEADING_LEVELS,
  headingLevelFor,
  headingSizeOf,
  isAttributionLine,
  isCaptionLine,
  isTocTitle,
  outlineHeadingLevel,
  structHeadingLevel,
} from "../headings/index.js";
import {
  continuesParagraph,
  endsHyphenated,
  endsOpenHyphen,
  endsSentenceFinal,
} from "../paragraphs/index.js";
import { modelHeading } from "./model-page.js";
import { prevLine } from "./region-ctx.js";
import type { RegionCtx } from "./region-ctx.js";
import { isRotatedLine } from "./rotated.js";

/** Occurrences of the single character `ch` in `s` (`str::matches(char).count()`). */
function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/** `(len + 1).clamp(1, MAX_HEADING_LEVELS)`: one level deeper than the size map's deepest. */
export function deepestHeadingLevel(ctx: RegionCtx): number {
  return Math.min(Math.max(ctx.headingMap.length + 1, 1), MAX_HEADING_LEVELS);
}

/** What the priority chain made of one line. */
export type LineLevel = {
  /** The heading level, 1 to 6, or null when the line is not a heading. */
  level: number | null;
  /** The line sits on a TOC page and is not its title. */
  tocSuppress: boolean;
};

/**
 * Size-based level of `line`, after the guards that reject height jitter, citations, attribution
 * lines, run-in labels and half-tokens. `openHyphenScan` is also read by the model-based level.
 */
function sizeLevelOf(
  ctx: RegionCtx,
  line: ProjectedLine,
  text: string,
  tocSuppress: boolean,
  openHyphenScan: boolean,
  demote: boolean
): number | null {
  // Caption lines ("Figure 7", "Table 3.") are routinely set in a distinct (and slightly larger)
  // font that lands them in the font-size heading map. Suppress font-size promotion for them;
  // outline / struct-tree signals still win since those are explicit. Rotated lines (margin
  // stamps like a sideways "arXiv:…" watermark) are excluded from `build_heading_map`, but
  // their size can still coincide with a map entry built from horizontal text.
  if (isCaptionLine(text) || tocSuppress || isRotatedLine(line) || line.in_figure) return null;
  const size = headingLevelFor(headingSizeOf(line), ctx.headingMap);
  if (size === null) return null;
  // Guard against height-jitter false headings: a line that flows from the previous line (same
  // paragraph) AND starts lowercase is a mid-paragraph continuation, not a heading — even if its
  // height-estimated size jittered into a heading slot. A real heading has a break above it and
  // is capitalized, so it won't satisfy both.
  const first = chars(text)[0];
  const startsLower = first !== undefined && isLowercase(first);
  const prev = prevLine(ctx);
  // A previous line ending in a mid-word hyphen wrap means this line is its continuation
  // regardless of capitalization ("…SOLAR 10.7 Billion-" / "Parameter Model: We have…").
  const prevHyphenWrap = prev !== null && endsHyphenated(prev.text);
  // `prev` is the *live body paragraph* (or list line) immediately above, so it only exists
  // mid-paragraph — never right after a heading. A lowercase line that *completes a sentence*
  // (ends with terminal punctuation) while its predecessor is left open (no terminal
  // punctuation) is a wrapped sentence tail, not a heading — even when a centered short tail's
  // large left-edge indent defeats `continues_paragraph`. Requiring the tail to end a sentence
  // keeps genuine lowercase headings (which rarely end in `.`/`!`/`?`) promoted.
  const sentenceTail =
    startsLower && endsSentenceFinal(text) && prev !== null && !endsSentenceFinal(prev.text);
  const isContinuation = (prev !== null && continuesParagraph(prev, line)) || sentenceTail;
  if ((startsLower || prevHyphenWrap) && isContinuation) return null;
  // Long-text guard: a real heading is a label, not a sentence with multiple clauses. Footnotes /
  // citations / captions that happen to be set slightly larger than body text (e.g. a 10.7pt
  // citation over a 9pt body) score as the smallest heading level in the size map. Threshold is
  // generous — book titles and long subsection labels can run 100+ chars.
  if (charCount(text) > HEADING_MAX_TEXT_CHARS) return null;
  // Attribution lines under figures/charts are never section headings, even when the chart
  // caption font is slightly above body size.
  if (isAttributionLine(text)) return null;
  // Run-in label guard: a size-promoted line that contains a mid-line ". " followed by ≥3 more
  // words AND ends with a mid-word "-" wrap is almost always a paragraph leading with a bold
  // run-in label ("Base model. Any n-layer transformer architec-"), not a section heading. Both
  // signals must fire — a heading occasionally has either on its own.
  const hasMidSentence = text.includes(". ") || text.includes(": ");
  const midWordWrap = trimEnd(text).endsWith("-");
  if (hasMidSentence && midWordWrap) return null;
  if (openHyphenScan || demote) return null;
  return size;
}

/**
 * The level of `line` from the priority chain: tagged-PDF struct tree → outline → font-size map
 * → learned block classes → a standalone TOC title. Also arms `ctx.tocTitleEmitted` when the
 * line is the page's TOC title.
 */
export function lineLevel(ctx: RegionCtx, line: ProjectedLine, text: string): LineLevel {
  const { page } = ctx;
  const taggedLevel = structHeadingLevel(line, page.struct_nodes);
  const isFirstTocTitle = isTocTitle(text) && !ctx.tocTitleEmitted;
  const tocSuppress = ctx.tocPage && !isFirstTocTitle;
  // Outline entries on a TOC page are the TOC itself — every entry prefix-matches an outline
  // target ("Introduction", "Part I", ...). Promoting them to `##` shreds the document's heading
  // structure (a TOC page is just `# Contents`). Tagged-PDF struct levels are explicit and still win.
  const outlineLevel =
    taggedLevel ??
    (tocSuppress ? null : outlineHeadingLevel(line, page.page_height, ctx.outline, text));
  // On a page whose sizes are estimated from box heights (scans, OCR) a line ending in an
  // attached hyphen is the first half of a token, not a finished heading: promoted, it splits
  // the token across a heading and the paragraph below. Left in the paragraph, the join keeps it whole.
  const openHyphenScan = line.font_size_is_estimated && endsOpenHyphen(text);
  // Learned block classes (joint layout model): a confident "text" call demotes a font-size
  // heading, a confident heading call promotes a line no size rule caught (scans with no font
  // sizes, body-size headings). Tagged / outline levels stay authoritative.
  const model = modelHeading(page, line);
  // Demotion trusts the model over the font only where the font is weak evidence: a
  // height-estimated size (scans, OCR) jitters into the heading map, while a real Tf size well
  // above body is a heading the model may simply not know the style of.
  const demote = model !== null && model[0] <= model[3] && line.font_size_is_estimated;
  const sizeLevel = sizeLevelOf(ctx, line, text, tocSuppress, openHyphenScan, demote);
  // A standalone "Contents" / "Table of Contents" / "Index" line is almost always a real H1,
  // even when `page_is_toc` is false. `is_toc_title` matches the *entire* trimmed line against
  // an exact whitelist, so it can't fire mid-prose.
  const tocTitleLevel = isFirstTocTitle ? 1 : null;
  if (isFirstTocTitle) ctx.tocTitleEmitted = true;
  const modelLevel = modelLevelOf(ctx, line, text, model, {
    taken: outlineLevel !== null || sizeLevel !== null,
    tocSuppress,
    openHyphenScan,
  });
  const level = outlineLevel ?? sizeLevel ?? modelLevel ?? tocTitleLevel;
  return {
    level: level === null ? null : Math.min(Math.max(level, 1), MAX_HEADING_LEVELS),
    tocSuppress,
  };
}

/** The level a confident model heading call gives a line no other rule promoted. */
function modelLevelOf(
  ctx: RegionCtx,
  line: ProjectedLine,
  text: string,
  model: ReturnType<typeof modelHeading>,
  s: { taken: boolean; tocSuppress: boolean; openHyphenScan: boolean }
): number | null {
  if (model === null) return null;
  const [ph, pt, promote] = model;
  // a promoted line must not be the next line of the paragraph above (a wrapped sentence's
  // tail or a continuation line the model scored as heading-like)
  const prev = prevLine(ctx);
  const continuesLiveParagraph = prev !== null && continuesParagraph(prev, line);
  const ok =
    !s.taken &&
    !s.tocSuppress &&
    ph >= promote &&
    charCount(text) <= HEADING_MAX_TEXT_CHARS &&
    !isCaptionLine(text) &&
    !continuesLiveParagraph &&
    // a sentence's end, or a ")" closing a "(" on an earlier line, is prose torn
    // from a paragraph, not a heading
    !endsSentenceFinal(text) &&
    !s.openHyphenScan &&
    countChar(text, ")") <= countChar(text, "(");
  if (!ok) return null;
  if (f32(pt * 2) > ph) return 1;
  return headingLevelFor(headingSizeOf(line), ctx.headingMap) ?? deepestHeadingLevel(ctx);
}
