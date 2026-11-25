// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/layout.rs (crates-v2.21.2, Apache-2.0): with_model_blocks.

import { f32, trim } from "../rust.js";
import { BLOCK_CLASSES } from "../table-model/types.js";
import type { Rect } from "../types/geometry.js";
import type { ParsedPage } from "../types/page.js";
import { clipToPage } from "./clip.js";
import { layoutBlockOf } from "./from-block.js";
import type { LayoutBlock } from "./types.js";
import { xyCutOrder } from "./xy-cut.js";

const KEPT_KINDS = new Set(["table", "merged_table", "grid_fallback", "figure"]);

/** The block kind and heading level the model's class maps to; `null` for the classes the heuristic blocks own. */
function kindOfClass(cls: string | undefined): [string, number | undefined] | null {
  switch (cls) {
    case "Title":
      return ["heading", 1];
    case "Heading":
      return ["heading", 2];
    case "PageHeader":
      return ["page_header", undefined];
    case "PageFooter":
      return ["page_footer", undefined];
    case "List":
      return ["list_item", undefined];
    case "Code":
      return ["code", undefined];
    case "Table":
    case "FigureText":
      return null;
    default:
      return ["paragraph", undefined];
  }
}

function centreInside(cx: number, cy: number, r: Rect): boolean {
  return r.x <= cx && cx <= f32(r.x + r.width) && r.y <= cy && cy <= f32(r.y + r.height);
}

/**
 * The page's layout blocks with a joint model's blocks in place of the
 * heuristic text blocks: heuristic figures and tables stay (their rows / ids come from those
 * paths), every model block whose centre falls in a kept table is dropped, and the rest are
 * emitted by class (heading / title, page header / footer, list item, code, else paragraph;
 * table and figure-text classes are left to the heuristic blocks).
 */
export function withModelBlocks(page: ParsedPage, heuristic: LayoutBlock[]): LayoutBlock[] {
  const kept = heuristic.filter((b) => KEPT_KINDS.has(b.kind));
  const inside = (r: Rect): boolean => {
    const cx = f32(r.x + f32(r.width / 2));
    const cy = f32(r.y + f32(r.height / 2));
    return kept.some(
      (t) => t.kind !== "figure" && t.bbox !== undefined && centreInside(cx, cy, t.bbox)
    );
  };
  const out = structuredClone(kept);
  // each text item links to one block: the kept heuristic blocks' items first, then the model
  // block holding the item's centre
  const claimed = new Set<number>(kept.flatMap((b) => b.text_item_indices));
  for (const m of page.model_blocks) {
    if (inside(m.bbox) || trim(m.text) === "") continue;
    const mapped = kindOfClass(BLOCK_CLASSES[m.class]);
    if (mapped === null) continue;
    const [kind, level] = mapped;
    const b = layoutBlockOf(kind, { ...m.bbox });
    if (level !== undefined) b.level = level;
    const r = m.bbox;
    b.text_item_indices = [];
    page.text_items.forEach((it, i) => {
      const cx = f32(it.x + f32(it.width / 2));
      const cy = f32(it.y + f32(it.height / 2));
      if (!claimed.has(i) && trim(it.text) !== "" && centreInside(cx, cy, r)) {
        b.text_item_indices.push(i);
      }
    });
    for (const i of b.text_item_indices) claimed.add(i);
    if (kind === "code") b.lines = [m.text];
    else b.text = m.text;
    out.push(b);
  }
  clipToPage(out, page.page_width, page.page_height);
  const order = xyCutOrder(out, f32(page.page_width * page.page_height));
  return order.map((i) => out[i]);
}
