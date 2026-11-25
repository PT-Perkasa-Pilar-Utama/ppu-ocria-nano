// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/types.rs (crates-v2.21.2, Apache-2.0): geometry types.

// Field names and enum shapes follow serde's JSON form of the Rust types
// (snake_case fields, externally tagged enums), so stage values cross the
// boundary to and from LiteParse's own JSON unchanged.

import { f32 } from "../rust.js";

/** An axis-aligned rectangle in viewport space (top-left origin, 72 DPI), f32. */
export type Rect = { x: number; y: number; width: number; height: number };

/** `Rect::union`: the smallest rect containing both inputs. */
export function rectUnion(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(f32(a.x + a.width), f32(b.x + b.width));
  const bottom = Math.max(f32(a.y + a.height), f32(b.y + b.height));
  return { x, y, width: f32(right - x), height: f32(bottom - y) };
}

/** `Rect::extend`: fold `rect` into an optional accumulator. */
export function rectExtend(acc: Rect | undefined, rect: Rect): Rect {
  return acc ? rectUnion(acc, rect) : { ...rect };
}

/** A vector-graphic primitive distilled from PDFium path objects. */
export type GraphicPrimitive =
  | {
      Stroke: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        color: string | null;
        width: number;
      };
    }
  | { Rect: { bbox: Rect; fill: string | null; stroke: string | null } };

/** `GraphicPrimitive::bbox`. */
export function graphicBbox(g: GraphicPrimitive): Rect {
  if ("Rect" in g) return { ...g.Rect.bbox };
  const { x1, y1, x2, y2 } = g.Stroke;
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(f32(x2 - x1)),
    height: Math.abs(f32(y2 - y1)),
  };
}

export type CutAxis = "Horizontal" | "Vertical";

/** XY-cut region tree node. */
export type Region = { bbox: Rect; kind: RegionKind };

export type RegionKind =
  | { Leaf: { item_indices: number[] } }
  | { Split: { axis: CutAxis; children: Region[] } };

export function emptyRegion(): Region {
  return { bbox: { x: 0, y: 0, width: 0, height: 0 }, kind: { Leaf: { item_indices: [] } } };
}

export type Snap = "Left" | "Right" | "Center";

export type Anchor = "Left" | "Right" | "Center" | "Floating";

/** Page-scoped vector path output. */
export type VectorGraphics = { shapes: VectorShape[]; lines: VectorLine[] };

export type VectorShape = {
  bbox: Rect;
  stroke: boolean;
  stroke_color?: string;
  fill: boolean;
  fill_color?: string;
  has_curve: boolean;
};

export type VectorLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: boolean;
  stroke_width?: number;
  stroke_color?: string;
  fill: boolean;
  fill_color?: string;
};
