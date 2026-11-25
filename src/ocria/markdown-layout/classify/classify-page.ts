// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): `classify_page_with_filters`.

import { f32, totalCmp } from "../../rust.js";
import { NUMERIC_FOOTER_PATH } from "../../projection/xy-cut.js";
import type { OutlineTarget } from "../../types/document.js";
import type { ParsedPage, ProjectedLine } from "../../types/page.js";
import type { PositionedBlock } from "../block-types.js";
import { sourcedBlock } from "../blocks/positioned.js";
import type { ImageMode } from "../constants.js";
import { findCrossRegionTableMerge } from "../cross-region/index.js";
import { detectHorizontalRules } from "../hr/index.js";
import { isHeaderOrFooter } from "../repetition/index.js";
import { fixBlock } from "../table-fix/index.js";
import type { TableRun } from "../tables/types.js";
import { extractRuleSegments } from "../tables/ruled/index.js";
import { classifyRegion } from "./classify-region.js";
import { globalRuledPass } from "./global-ruled.js";
import { positionedInterruption } from "./interruption.js";
import type { YInterruption } from "./interruption.js";
import { modelTablePass } from "./model-tables.js";
import { stitchRegions } from "./stitch.js";
import { isTocPage } from "./toc.js";

function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Contiguous runs of lines sharing a `region_path` (one xy_cut leaf each), as `[start, end)`. */
function regionRanges(lines: readonly ProjectedLine[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = 0;
  while (s < lines.length) {
    const path = lines[s].region_path;
    let e = s + 1;
    while (e < lines.length && samePath(lines[e].region_path, path)) e += 1;
    out.push([s, e]);
    s = e;
  }
  return out;
}

/** The lines after cross-region table merges, with each merge's region path and validated runs. */
type CrossRegionPass = { lines: ProjectedLine[]; runs: Array<[number[], TableRun[]]> };

/**
 * Cross-region table re-merge: when a V-cut sliced a table into sibling
 * leaves, fuse the slices back into single rows (one synthetic region)
 * before grouping. Each successful merge carries its own validated table
 * runs, which are handed to `classify_region` so emission is guaranteed
 * even for shapes the standard detectors would reject in normal flow.
 * TOC pages are skipped: their split number/title/page-number leaves
 * baseline-align perfectly and fuse into a convincing-but-wrong table.
 */
function crossRegionMerge(lines: ProjectedLine[], tocPage: boolean): CrossRegionPass {
  let cur = lines;
  const runs: Array<[number[], TableRun[]]> = [];
  for (let n = 0; n < 3; n++) {
    if (tocPage) break;
    const m = findCrossRegionTableMerge(cur);
    if (m === null) break;
    const mergedPath = m.merged[0].region_path;
    cur = [...cur.slice(0, m.start), ...m.merged, ...cur.slice(m.end)];
    runs.push([mergedPath, m.runs]);
  }
  return { lines: cur, runs };
}

/**
 * Classify a page's `ProjectedLine`s into blocks, also stripping lines matching a precomputed
 * running header/footer set. Use this when emitting a whole document so
 * repeating chrome (titles, page numbers) doesn't show up in every page.
 *
 * `outline` is the document outline filtered to entries whose `page_index`
 * matches this page (or the full outline — out-of-page entries are
 * ignored). Heading promotion from struct tree + outline outranks the
 * font-size heading map.
 */
export function classifyPageWithFilters(
  page: ParsedPage,
  headingMap: Array<[number, number]>,
  headerFooter: Set<string>,
  outline: OutlineTarget[],
  imageMode: ImageMode,
  chromeIndices: ReadonlySet<number>
): PositionedBlock[] {
  const tocPage = isTocPage(page);

  // Strip running header/footer lines up-front so they don't leak into
  // table detection (a repeating two-column footer would otherwise look
  // like a 2-row table) or paragraph grouping.
  const needFilter = headerFooter.size > 0 || chromeIndices.size > 0;
  const filtered = needFilter
    ? page.projected_lines.filter(
        (l, idx) => !chromeIndices.has(idx) && !isHeaderOrFooter(l, page, headerFooter)
      )
    : page.projected_lines;

  // Projection appends detached footers after all body lines. Filtering keeps
  // that order. Keep footers outside table detection: extending a table region can lower
  // its validated coverage enough to reject the table.
  const found = filtered.findIndex((l) => samePath(l.region_path, NUMERIC_FOOTER_PATH));
  const footerStart = found < 0 ? filtered.length : found;
  const bodyLines = filtered.slice(0, footerStart);
  const footerLines = filtered.slice(footerStart);

  const model = modelTablePass(page, bodyLines);
  const afterModel = model.lines;

  // Rule segments are extracted from the page graphics once and shared by
  // every table-detection pass below (global, per-region, leaf veto, bands).
  const ruleSegments = extractRuleSegments(page.graphics);
  const globalRuled = globalRuledPass(page, afterModel, ruleSegments);
  const afterGlobal =
    globalRuled.consumed.size === 0
      ? afterModel
      : afterModel.filter((_, i) => !globalRuled.consumed.has(i));

  const cross = crossRegionMerge(afterGlobal, tocPage);
  const lines = cross.lines;

  // Region-grouped pipeline: split the filtered line list into contiguous
  // runs sharing a `region_path` (one xy_cut leaf each) and classify each
  // leaf as its own mini-page. Paragraph / list / code / heading state is
  // scoped per leaf so a column-wrap can't silently fuse two leaves into one
  // paragraph, and table detection runs per-leaf so a misfired borderless
  // table can't consume lines from a different leaf. Cross-leaf merges
  // happen only in `stitch_regions` at the end, where the rule is explicit and inspectable.
  //
  // Page-level interruptions (HRs from vector graphics + figure refs) need
  // to interleave with text by y-position. Collect once, then dispatch into
  // each region's classify call by y-band so they emit in the right slot.
  // Two interruptions belonging to *no* region (e.g. an HR in a margin band
  // that no leaf covers) are emitted between regions in y order.
  const allInterruptions: YInterruption[] = detectHorizontalRules(page).map((r) => [
    r.y,
    { Hr: r },
  ]);
  if (imageMode !== "off") {
    for (const r of page.image_refs) allInterruptions.push([r.bbox.y, { Figure: r }]);
  }
  for (const [y, block] of [...globalRuled.tables, ...model.tables]) {
    allInterruptions.push([y, { Table: block }]);
  }
  allInterruptions.sort((a, b) => totalCmp(a[0], b[0]));

  // regionBoundaries[k] = index into `blocks` where region k's first block lives. Used by
  // `stitch_regions` to know where to test cross-leaf paragraph continuation.
  const regionBoundaries: number[] = [];
  let cursor = 0;
  const blocks: PositionedBlock[] = [];

  for (const [rstart, rend] of regionRanges(lines)) {
    const regionLines = lines.slice(rstart, rend);

    // Compute this region's y-extent so we can slot in interruptions that
    // fall above or inside it. xy_cut leaves are rectangular partitions,
    // so a leaf's y-band is well-defined.
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const l of regionLines) {
      yMin = Math.min(yMin, l.bbox.y);
      yMax = Math.max(yMax, f32(l.bbox.y + l.bbox.height));
    }

    // Emit any interruptions that sit above this region's top edge before
    // we start emitting the region's own blocks.
    while (cursor < allInterruptions.length && allInterruptions[cursor][0] < yMin) {
      blocks.push(positionedInterruption(allInterruptions[cursor][1]));
      cursor += 1;
    }

    // Hand the region its in-band interruptions (y in [yMin, yMax]) so
    // the per-line loop can interleave them by y.
    const regionInterruptions: YInterruption[] = [];
    while (cursor < allInterruptions.length && allInterruptions[cursor][0] <= yMax) {
      regionInterruptions.push(allInterruptions[cursor]);
      cursor += 1;
    }

    const regionStart = blocks.length;
    const pre = cross.runs.find(([path]) => samePath(path, lines[rstart].region_path));
    const regionBlocks = classifyRegion(
      regionLines,
      regionInterruptions,
      page,
      ruleSegments,
      headingMap,
      outline,
      tocPage,
      pre === undefined ? null : structuredClone(pre[1])
    );
    if (regionBlocks.length > 0) {
      regionBoundaries.push(regionStart);
      blocks.push(...regionBlocks);
    }
  }

  // Trailing interruptions below the last region.
  while (cursor < allInterruptions.length) {
    blocks.push(positionedInterruption(allInterruptions[cursor][1]));
    cursor += 1;
  }

  // Appending here gives the footer its own final paragraph, outside table
  // detection and cross-column paragraph continuation.
  const stitched = stitchRegions(blocks, regionBoundaries);
  for (const b of stitched) fixBlock(b.block);
  for (const line of footerLines) {
    stitched.push(
      sourcedBlock(
        { Paragraph: { text: line.text, bold: false, italic: false } },
        { ...line.bbox },
        [...line.span_item_indices]
      )
    );
  }
  return stitched;
}
