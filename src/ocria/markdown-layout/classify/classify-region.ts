// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): `classify_region`.

import { f32, totalCmp, trim, trimEnd } from "../../rust.js";
import type { OutlineTarget } from "../../types/document.js";
import type { ParsedPage, ProjectedLine } from "../../types/page.js";
import type { PositionedBlock } from "../block-types.js";
import { sourcedBlock } from "../blocks/positioned.js";
import { detectOrderedListLines, parseListMarker } from "../lists/index.js";
import type { RuleSegments } from "../tables/ruled/index.js";
import type { TableRun } from "../tables/types.js";
import { emitBoldHeading, emitParagraphLine } from "./body-lines.js";
import { decorativeDividerKind } from "./divider.js";
import { emitHeading, mergeIntoHeadingRun } from "./heading-emit.js";
import { lineLevel } from "./heading-level.js";
import { InterruptionQueue } from "./interruption.js";
import type { YInterruption } from "./interruption.js";
import { FlowState } from "./flow-state.js";
import { continueListItem, emitListItem } from "./list-lines.js";
import type { RegionCtx } from "./region-ctx.js";
import { detectRegionTables, emitTableRun, tableYExtents } from "./region-tables.js";
import { isRotatedLine, rotatedTextIsContent, withoutStraySideways } from "./rotated.js";

/**
 * Outside tables, a line whose only sideways text is a stray OCR glyph renders without it,
 * instead of being skipped as margin furniture. Table runs were detected on the lines as
 * projected and keep them.
 */
function withoutStrayGlyphs(
  lines: ProjectedLine[],
  rotatedContent: boolean,
  tableCovered: ReadonlySet<number>
): ProjectedLine[] {
  if (rotatedContent) return lines;
  const out = [...lines];
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (tableCovered.has(i)) continue;
    const u = withoutStraySideways(lines[i]);
    if (u === null) continue;
    out[i] = u;
    changed = true;
  }
  return changed ? out : lines;
}

/** One non-table line: the code, divider, heading, list and paragraph rules in priority order. */
function classifyLine(ctx: RegionCtx, lineIdx: number): void {
  const { state, blocks } = ctx;
  const line = ctx.lines[lineIdx];
  const text = trim(line.text);
  if (text === "") return;
  // Skip rotated text (vertical sidebars, arXiv banners, watermarks). Including it would either
  // inject a paragraph of disconnected characters or be misclassified as a heading. Not when
  // rotated text is the page's content (a table or figure set sideways): projection has already
  // turned it upright, and skipping it drops the page.
  if (isRotatedLine(line) && !ctx.rotatedContent) return;

  // Code block detection runs first so a mono heading-shaped line (rare but plausible — e.g., a
  // code identifier in a large mono font) still becomes code. Mono content also wouldn't make a
  // useful heading.
  if (line.all_mono) {
    state.flushParagraph(blocks);
    state.resetList();
    state.pushCodeLine(trimEnd(line.text), line.bbox, line.span_item_indices);
    return;
  }
  // Any non-mono line ends the current code block (if any).
  state.flushCode(blocks);

  // Decorative divider / flourish lines (`* * * *`, a lone em-dash). Handled before
  // heading/paragraph classification so the ornament neither glues onto the next paragraph nor
  // gets promoted to a heading.
  const isRule = decorativeDividerKind(text);
  if (isRule !== null) {
    state.flushParagraph(blocks);
    state.resetList();
    ctx.headingRun = null;
    if (isRule) {
      blocks.push(sourcedBlock("HorizontalRule", { ...line.bbox }, [...line.span_item_indices]));
    }
    return;
  }

  const { level, tocSuppress } = lineLevel(ctx, line, text);
  // Gate the unconditional merge: only fold body-sized continuations that *look* like the rest of
  // a heading, not body prose. Reject the candidate if it starts a list item (`l.`, `1.`, `· `…)
  // or contains a mid-sentence period — both are unambiguous prose signals and never appear
  // inside a real wrapped heading.
  const contLooksLikeHeading = parseListMarker(text) === null && !text.includes(". ");
  if (level === null && mergeIntoHeadingRun(ctx, line, lineIdx, text, contLooksLikeHeading)) return;
  if (level !== null && emitHeading(ctx, line, lineIdx, text, level)) return;

  if (emitListItem(ctx, line, lineIdx, text, tocSuppress)) return;
  if (continueListItem(ctx, line, lineIdx, text)) return;
  if (emitBoldHeading(ctx, line, lineIdx, text, tocSuppress)) return;
  emitParagraphLine(ctx, line, text);
}

/**
 * Classify the lines of a single xy_cut leaf into a sequence of blocks. All per-line state
 * (active paragraph, code run, list run, heading_run) is local to this call — nothing crosses a
 * leaf boundary except through the explicit `stitch_regions` post-pass. Page-level signals
 * (`heading_map`, `struct_nodes`, `outline`, header/footer y-bands) are still consulted because
 * they're computed once per document.
 */
export function classifyRegion(
  lines: ProjectedLine[],
  interruptions: YInterruption[],
  page: ParsedPage,
  ruleSegments: RuleSegments,
  headingMap: Array<[number, number]>,
  outline: OutlineTarget[],
  tocPage: boolean,
  precomputedTables: TableRun[] | null
): PositionedBlock[] {
  const rotatedContent = rotatedTextIsContent(page);
  const tableRuns = detectRegionTables(page, lines, ruleSegments, precomputedTables);

  // Region-wide pre-pass: which line indices carry a lettered/roman marker (`a.`, `i.`) that
  // belongs to a confirmed sequential list run. Only these are treated as list items below — a
  // lone `A.` / initial is left alone. Lines already inside a detected table are excluded so
  // enumerated table footnotes (`(a)`, `(b)` below a table) aren't pulled out as a list, which
  // would disturb the table's row/track inference.
  const tableCovered = new Set<number>();
  for (const run of tableRuns) {
    for (let i = run.start; i < run.end; i++) tableCovered.add(i);
  }
  const orderedListLines = detectOrderedListLines(lines, tableCovered);
  const extents = tableYExtents(tableRuns, lines);
  const inTableBand = (y: number): boolean =>
    extents.some(([top, bot]) => y >= f32(top - 2) && y <= f32(bot + 2));

  // Figures and rules inside a table's band would split it, so they go. A table never does: its
  // lines were already pulled out of the flow, so dropping it loses them (a TableNet table whose
  // band a smaller heuristic table overlaps vanished from the page).
  const regionInterruptions = interruptions
    .filter(([y, kind]) => "Table" in kind || !inTableBand(y))
    .sort((a, b) => totalCmp(a[0], b[0]));
  const queue = new InterruptionQueue(regionInterruptions);

  const ctx: RegionCtx = {
    lines: withoutStrayGlyphs(lines, rotatedContent, tableCovered),
    page,
    headingMap,
    outline,
    tocPage,
    rotatedContent,
    blocks: [],
    state: new FlowState(),
    headingRun: null,
    tocTitleEmitted: false,
    orderedListLines,
  };

  let runPos = 0;
  let idx = 0;
  while (idx < ctx.lines.length) {
    const run = runPos < tableRuns.length ? tableRuns[runPos] : null;
    if (run !== null && run.start === idx) {
      // Flush any interruptions above this table's top edge first.
      ctx.state.emitBefore(ctx.blocks, queue, ctx.lines[run.start].bbox.y);
      ctx.state.flushParagraph(ctx.blocks);
      ctx.state.flushCode(ctx.blocks);
      ctx.state.resetList();
      runPos += 1;
      emitTableRun(ctx, run);
      idx = run.end;
      continue;
    }
    // Emit any interruptions that fall above this line.
    ctx.state.emitBefore(ctx.blocks, queue, ctx.lines[idx].bbox.y);
    classifyLine(ctx, idx);
    idx += 1;
  }

  ctx.state.flushParagraph(ctx.blocks);
  ctx.state.flushCode(ctx.blocks);
  // Flush any trailing interruptions that sat below the last text line.
  ctx.state.emitBefore(ctx.blocks, queue, Infinity);
  return ctx.blocks;
}
