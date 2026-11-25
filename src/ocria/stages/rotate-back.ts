// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/stages.rs (crates-v2.21.2, Apache-2.0): rotate_back_ocr_deskew.

import { f32 } from "../rust.js";
import { rotateAbout } from "../ocr-merge/deskew.js";
import type { Rect } from "../types/geometry.js";
import type { ParsedPage } from "../types/page.js";

/**
 * Move the boxes of every deskewed page back onto the page image. Pure and
 * per page.
 *
 * On a skewed scan `mergeOcr` rotates the OCR items upright about the
 * page centre (`Page::ocr_deskew`) so lines group into rows. Projection,
 * block classification and markdown all run on those upright items, and
 * `project` carries the angle onto `ParsedPage::ocr_deskew`. This stage
 * undoes the rotation on the output geometry: each OCR item box and every
 * layout block and table-cell box becomes the axis-aligned bound of itself
 * rotated back about the page centre. A word box, which the merge moved by
 * its centre at its measured size, moves its centre back and keeps its size,
 * so it comes back as the rect the OCR engine measured. Native items were
 * never rotated and stay put. Text and markdown do not change.
 *
 * Run it last, after `layoutBlocks` (whose boxes it moves) and after
 * `layoutComplexity` (which measures the upright frame). It clears
 * `ocr_deskew` on each page it moves, so a second call is a no-op. Pages
 * without a deskew are untouched.
 */
export function rotateBackOcrDeskew(pages: ParsedPage[]): void {
  for (const page of pages) {
    const deg = page.ocr_deskew;
    if (deg == null) continue;
    page.ocr_deskew = null;
    rotateBackPage(page, deg);
  }
}

function rotateBackPage(page: ParsedPage, deg: number): void {
  const cx = f32(page.page_width / 2);
  const cy = f32(page.page_height / 2);
  const back = (x: number, y: number, w: number, h: number): [number, number, number, number] => {
    const pts = [
      [x, y],
      [f32(x + w), y],
      [f32(x + w), f32(y + h)],
      [x, f32(y + h)],
    ].map(([px, py]) => rotateAbout(px, py, cx, cy, deg));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    return [x0, y0, f32(x1 - x0), f32(y1 - y0)];
  };
  const rect = (r: Rect): void => {
    [r.x, r.y, r.width, r.height] = back(r.x, r.y, r.width, r.height);
  };
  for (const item of page.text_items) {
    if (item.confidence == null) continue;
    [item.x, item.y, item.width, item.height] = back(item.x, item.y, item.width, item.height);
    for (const w of item.words) {
      const [mx, my] = rotateAbout(
        f32(w.x + f32(w.width / 2)),
        f32(w.y + f32(w.height / 2)),
        cx,
        cy,
        deg
      );
      w.x = f32(mx - f32(w.width / 2));
      w.y = f32(my - f32(w.height / 2));
    }
  }
  for (const block of page.blocks ?? []) {
    if (block.bbox !== undefined) rect(block.bbox);
    for (const cell of [...(block.header ?? []), ...(block.rows ?? []).flat()]) {
      if (cell.bbox !== undefined) rect(cell.bbox);
    }
  }
}
