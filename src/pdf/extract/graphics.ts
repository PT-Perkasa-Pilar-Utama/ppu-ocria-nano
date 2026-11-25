// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): extract_layout_graphics.

import { f32 } from "../../ocria/rust.js";
import type { GraphicPrimitive, Rect } from "../../ocria/types/geometry.js";
import type { PathObject } from "../pdfium/page-paths.js";
import type { RectF } from "../pdfium/types.js";
import { colorToArgbHex } from "./misc.js";

/** `rectf_to_rect` / `rect_from_pdfium`. */
export function rectFToRect(r: RectF): Rect {
  return { x: r.left, y: r.top, width: f32(r.right - r.left), height: f32(r.bottom - r.top) };
}

/**
 * Simplified vector graphics for the markdown layout pass: filled paths become one bounding
 * `Rect` (cell backgrounds, code-block fills, banner fills); stroked paths become one `Stroke`
 * per `LineTo`, plus the implicit closing stroke when a subpath has its close flag set. A
 * `BezierTo` only advances the current point.
 */
export function extractLayoutGraphics(paths: readonly PathObject[]): GraphicPrimitive[] {
  const out: GraphicPrimitive[] = [];
  for (const path of paths) {
    if (path.is_filled) {
      out.push({
        Rect: {
          bbox: rectFToRect(path.bbox),
          fill: path.fill_color ? colorToArgbHex(path.fill_color) : null,
          stroke: path.stroke_color ? colorToArgbHex(path.stroke_color) : null,
        },
      });
    }
    if (!path.is_stroked) continue;

    const color = path.stroke_color ? colorToArgbHex(path.stroke_color) : null;
    let current: [number, number] | null = null;
    let subpathStart: [number, number] | null = null;
    for (const seg of path.segments) {
      if (seg.kind === "MoveTo") {
        current = [seg.x, seg.y];
        subpathStart = [seg.x, seg.y];
      } else if (seg.kind === "LineTo") {
        if (current !== null) {
          out.push({
            Stroke: {
              x1: current[0],
              y1: current[1],
              x2: seg.x,
              y2: seg.y,
              color,
              width: path.stroke_width,
            },
          });
        }
        current = [seg.x, seg.y];
        if (seg.close && subpathStart !== null) {
          const [cx, cy] = current;
          const [sx, sy] = subpathStart;
          if (f32(Math.hypot(f32(cx - sx), f32(cy - sy))) > f32(0.01)) {
            out.push({
              Stroke: { x1: cx, y1: cy, x2: sx, y2: sy, color, width: path.stroke_width },
            });
          }
        }
      } else {
        // Do not synthesize a stroke for a curve; just advance.
        current = [seg.x, seg.y];
      }
    }
  }
  return out;
}
