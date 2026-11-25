// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0): the pixel-to-page-point closures of merge_ocr_outcomes.

import type { Quad } from "../ocr/img.js";
import { f32 } from "../rust.js";
import { rotateAbout } from "./deskew.js";

/** A box as `[x, y, width, height]` in page points. */
export type PageBox = [number, number, number, number];

/** An axis-aligned pixel box `[x1, y1, x2, y2]`. */
export type PixelBox = [number, number, number, number];

/** How one page's OCR pixels map to page points, with the page's deskew (or none). */
export class PageFrame {
  constructor(
    private readonly deskew: number | null,
    private readonly scale: number,
    private readonly cx: number,
    private readonly cy: number
  ) {}

  private upright(x: number, y: number): [number, number] {
    return this.deskew === null ? [x, y] : rotateAbout(x, y, this.cx, this.cy, -this.deskew);
  }

  /**
   * An axis-aligned pixel box in page points. Under a deskew the box moves with its
   * centre and keeps its size, so rotating the centre back restores it.
   */
  toPage(b: PixelBox): PageBox {
    const w = f32(f32(b[2] - b[0]) * this.scale);
    const h = f32(f32(b[3] - b[1]) * this.scale);
    if (this.deskew === null) return [f32(b[0] * this.scale), f32(b[1] * this.scale), w, h];
    const [mx, my] = this.upright(
      f32(f32(f32(b[0] + b[2]) / 2) * this.scale),
      f32(f32(f32(b[1] + b[3]) / 2) * this.scale)
    );
    return [f32(mx - f32(w / 2)), f32(my - f32(h / 2)), w, h];
  }

  /**
   * Page-point bounds of a pixel box, or of its quad when the engine sent one. Without a
   * deskew the quad's points stay in image pixels until the bounds are taken, so the
   * boxes match the un-deskewed arithmetic exactly.
   */
  pageBounds(bbox: PixelBox, poly: Quad | null | undefined): PageBox {
    if (poly == null) return this.toPage(bbox);
    const s = this.deskew === null ? this.scale : 1;
    const pts: Array<[number, number]> = poly.map(([x, y]) =>
      this.deskew === null ? [x, y] : this.upright(f32(x * this.scale), f32(y * this.scale))
    );
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    return [f32(xMin * s), f32(yMin * s), f32(f32(xMax - xMin) * s), f32(f32(yMax - yMin) * s)];
  }
}
