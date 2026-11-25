// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): `classify_region` state.

import type { OutlineTarget } from "../../types/document.js";
import type { ParsedPage, ProjectedLine } from "../../types/page.js";
import type { PositionedBlock } from "../block-types.js";
import type { FlowState } from "./flow-state.js";

/**
 * The locals `classify_region` threads through its per-line steps. Rust keeps them as locals of
 * one 700-line function; the steps live in separate files here, so they share this record.
 */
export type RegionCtx = {
  /** The region's lines, with stray sideways glyphs removed outside tables. */
  lines: ProjectedLine[];
  page: ParsedPage;
  headingMap: Array<[number, number]>;
  outline: OutlineTarget[];
  tocPage: boolean;
  /** Whether rotated lines are the page's content, so they are not skipped as furniture. */
  rotatedContent: boolean;
  blocks: PositionedBlock[];
  state: FlowState;
  /** `(level, line index)` of the heading the last emitted block came from. */
  headingRun: [number, number] | null;
  /**
   * Whether a TOC title was already emitted on this page. Once seen, any subsequent line
   * matching `is_toc_title` (e.g. "Index", "List of Figures") is a TOC entry pointing at that
   * chapter, not another title, and must stay suppressed.
   */
  tocTitleEmitted: boolean;
  /** Lines carrying a lettered/roman marker that belongs to a confirmed sequential list run. */
  orderedListLines: ReadonlySet<number>;
};

/** The line `state` last read: the live paragraph's last line, else the last list line. */
export function prevLine(ctx: RegionCtx): ProjectedLine | null {
  if (ctx.state.paragraph !== null) return ctx.state.paragraph.last;
  return ctx.state.lastListLine !== null ? ctx.lines[ctx.state.lastListLine] : null;
}
