// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/repetition.rs (crates-v2.21.2, Apache-2.0): layout-model page header / footer lines.

import { BLOCK_CLASSES } from "../../table-model/types.js";
import { f32, trim } from "../../rust.js";
import type { Rect } from "../../types/geometry.js";
import type { ParsedPage } from "../../types/page.js";
import { isRotatedLine, linePageBoxes } from "../classify/index.js";

/** Page bands (fractions of the page height) inside which a layout-model furniture block may strip text. */
const FURNITURE_BAND_FRACTION: number = f32(0.2);

function isFurnitureClass(cls: number): boolean {
  const name = BLOCK_CLASSES[cls];
  return name === "PageHeader" || name === "PageFooter";
}

/**
 * Indices of `page.projected_lines` at least half covered by layout-model `PageHeader` / `PageFooter` blocks
 * in the top / bottom page band: running chrome the model saw on this page alone, which the
 * cross-page repetition set cannot catch on a one-page document. Rotated lines are skipped (their
 * projection frame is not the page frame).
 */
export function modelFurnitureLines(page: ParsedPage): Set<number> {
  const out = new Set<number>();
  const h = page.page_height;
  if (h <= 0 || page.model_blocks.length === 0) return out;
  const furniture: Rect[] = page.model_blocks
    .filter((b) => isFurnitureClass(b.class))
    .map((b) => b.bbox);
  const body: Rect[] = page.model_blocks
    .filter((b) => !isFurnitureClass(b.class))
    .map((b) => b.bbox);
  const top = f32(h * FURNITURE_BAND_FRACTION);
  const bottom = f32(h * f32(1 - FURNITURE_BAND_FRACTION));
  // the model's blocks are in page space; a projected line's box can be in the projection's reflowed space
  const pboxes = linePageBoxes(page, page.projected_lines);
  page.projected_lines.forEach((line, idx) => {
    if (trim(line.text) === "" || isRotatedLine(line)) return;
    const b = pboxes[idx];
    if (!(f32(b.y + b.height) <= top || b.y >= bottom)) return;
    // At least half the line's width under furniture blocks at its height: a projected line can span two
    // side-by-side header blocks (left / right running heads), with its centre in the gap between them.
    const cy = f32(b.y + f32(b.height / 2));
    // Share of the line's text (span widths, not its box: "MUSIC .......... 35" is one wide line whose two
    // words each sit in a small header block) inside furniture blocks at its height.
    const atCy = (r: Rect): boolean => r.y <= cy && cy <= f32(r.y + r.height);
    const spanOverlap = (r: Rect): number => {
      let sum = 0;
      for (const sp of line.spans) {
        const overlap = f32(
          Math.min(f32(sp.x + sp.width), f32(r.x + r.width)) - Math.max(sp.x, r.x)
        );
        sum = f32(sum + Math.max(overlap, 0));
      }
      return sum;
    };
    let ink = 0;
    for (const sp of line.spans) ink = f32(ink + Math.max(sp.width, 0));
    let covered = 0;
    for (const r of furniture) if (atCy(r)) covered = f32(covered + spanOverlap(r));
    if (ink > 0 && covered >= f32(f32(0.5) * ink)) {
      out.add(idx);
      return;
    }
    // A line in no body block (letterhead logos, address strips beside a footer): furniture when it lies
    // beyond every body block toward the page edge, clear of them, so a table row or caption the model
    // missed inside the content area stays.
    const unblocked = !body.some((r) => atCy(r) && spanOverlap(r) > 0);
    if (unblocked && body.length > 0) {
      // separated from the body by at least a line's height: a paragraph's last line just past a model block
      // that ends a little short is body text
      const gap = Math.max(b.height, 1);
      const beyond =
        cy < f32(h / 2)
          ? body.every((r) => r.y >= f32(f32(b.y + b.height) + gap))
          : body.every((r) => f32(r.y + r.height) <= f32(b.y - gap));
      if (beyond) out.add(idx);
    }
  });
  return out;
}
