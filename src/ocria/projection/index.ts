// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): the public projection stages.

// Upstream collects each page's projection signals in a thread-local that the
// caller switches on with `collect_signals(true)` and drains with
// `take_signals()`. This port has no hidden state: a caller that wants the
// signals passes a `Map` to `projectPagesForMarkdown` (or `projectPagesToGrid`)
// and reads it afterwards; a caller that omits it pays nothing for them.

import { detectFigureRects } from "../figure-cluster/index.js";
import { detectTableRects } from "../markdown-layout/tables/detect-table-rects.js";
import type { Rect } from "../types/geometry.js";
import type { ParsedPage, Page } from "../types/page.js";
import type { ProjSignals } from "./signals.js";
import { newProjectedItem } from "./projected-item.js";
import { projectToGrid } from "./project-to-grid.js";
import { buildProjectedLines } from "./projected-lines.js";
import { buildPageSignals } from "./page-signals.js";
import type { ProjDumpItem } from "./grid-state.js";
import type { ProjectedTextItem } from "./types.js";

export { projectToGrid } from "./project-to-grid.js";

/**
 * `(projected, original)` rect per text item when rotation handling moved any
 * item on the page (see `ParsedPage::projected_item_frames`); empty otherwise.
 * Gated on the `rotated` flag rather than on coordinate drift: projection also
 * rounds sizes and merges neighbours, and those small deltas are not the frame
 * change block boxes need mapping through, so the common no-rotation page pays
 * nothing and its boxes pass through untouched.
 */
export function projectedItemFrames(items: readonly ProjectedTextItem[]): Array<[Rect, Rect]> {
  if (!items.some((p) => p.rotated)) return [];
  return items.map((p) => [
    { x: p.item.x, y: p.item.y, width: p.item.width, height: p.item.height },
    { x: p.orig_x, y: p.orig_y, width: p.orig_width, height: p.orig_height },
  ]);
}

function projectPage(
  page: Page,
  styleRuns: boolean,
  signals: Map<number, ProjSignals> | undefined
): ParsedPage {
  const projectionBoxes = page.text_items.map(newProjectedItem);
  const dump: ProjDumpItem[] | undefined = signals ? [] : undefined;
  const [projectedItems, text] = projectToGrid(page, projectionBoxes, styleRuns, dump);
  // Detect figure regions from the page's vector graphics before XY-cut runs so the
  // layout recursion can treat them as obstacles (partition the page around figures
  // rather than slicing through).
  const figures = detectFigureRects(
    page.graphics,
    page.text_items,
    page.page_width,
    page.page_height
  );
  // Pre-projection ruled-table detection. Feeds XY-cut as obstacles so a table's
  // inter-column gaps don't get picked as page-level V-cuts (column-major reading
  // order is the dominant TEDS=0 failure mode on the bench).
  const tableRects = detectTableRects(page.graphics, page.page_width, page.page_height);
  const obstacles: Rect[] = [...figures, ...tableRects];
  const [projectedLines, regions] = buildProjectedLines(
    projectedItems,
    page.page_width,
    page.page_height,
    obstacles
  );
  if (signals && dump)
    signals.set(page.page_number, buildPageSignals(page, dump, projectedItems, regions));
  const frames = projectedItemFrames(projectedItems);
  return {
    page_number: page.page_number,
    page_label: page.page_label,
    page_width: page.page_width,
    page_height: page.page_height,
    content_bounds: page.content_bounds,
    text,
    markdown: "",
    text_items: projectedItems.map((proj) => ({
      ...proj.item,
      x: proj.orig_x,
      y: proj.orig_y,
      width: proj.orig_width,
      height: proj.orig_height,
      rotation: proj.orig_rotation,
    })),
    projected_lines: projectedLines,
    regions,
    graphics: page.graphics,
    vector_graphics: page.vector_graphics,
    figures,
    projected_item_frames: frames,
    model_tables: [],
    model_classes: [],
    model_blocks: [],
    struct_nodes: page.struct_nodes,
    image_refs: page.image_refs,
    annotations: page.annotations,
    form_fields: page.form_fields,
    structure_tree: page.structure_tree,
    // Filled in after classification, which needs the finished page (and
    // whole-document signals) to run.
    blocks: null,
    ocr_deskew: page.ocr_deskew,
  };
}

function projectPages(
  pages: readonly Page[],
  styleRuns: boolean,
  signals: Map<number, ProjSignals> | undefined
): ParsedPage[] {
  return pages.map((page) => projectPage(page, styleRuns, signals));
}

/** Project pages to plain text. Pass `signals` to receive each page's projection signals by page number. */
export function projectPagesToGrid(
  pages: readonly Page[],
  signals?: Map<number, ProjSignals>
): ParsedPage[] {
  return projectPages(pages, false, signals);
}

/**
 * `projectPagesToGrid` for markdown output: items whose emphasis differs stay
 * apart, so each run renders in its own style.
 */
export function projectPagesForMarkdown(
  pages: readonly Page[],
  signals?: Map<number, ProjSignals>
): ParsedPage[] {
  return projectPages(pages, true, signals);
}
