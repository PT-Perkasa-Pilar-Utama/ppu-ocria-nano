// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/pdfium/src/page.rs (crates-v2.21.2, Apache-2.0): `Page::path_objects`.

import { f32 } from "../../ocria/rust.js";
import type { Library } from "./library.js";
import type { Page, ViewportTransform } from "./page.js";
import { transformBounds, transformPoint } from "./page.js";
import type { Color, Matrix, RectF } from "./types.js";

export type SegmentKind = "MoveTo" | "LineTo" | "BezierTo";

/** One segment of a vector path, in viewport space after the object's matrix. */
export type PathSegment = { kind: SegmentKind; x: number; y: number; close: boolean };

/** A vector path object of a page. */
export type PathObject = {
  /** Object bbox in viewport space. */
  bbox: RectF;
  stroke_color: Color | null;
  fill_color: Color | null;
  stroke_width: number;
  is_stroked: boolean;
  is_filled: boolean;
  segments: PathSegment[];
};

// FPDF_PAGEOBJ_*, FPDF_FILLMODE_NONE and FPDF_SEGMENT_* from fpdf_edit.h.
export const FPDF_PAGEOBJ_TEXT = 1;
export const FPDF_PAGEOBJ_PATH = 2;
export const FPDF_PAGEOBJ_IMAGE = 3;
export const FPDF_PAGEOBJ_FORM = 5;
const FPDF_FILLMODE_NONE = 0;
const FPDF_SEGMENT_LINETO = 0;
const FPDF_SEGMENT_BEZIERTO = 1;
const FPDF_SEGMENT_MOVETO = 2;

const MAX_FORM_DEPTH = 6;

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** `compose_matrix`: `result(p) = outer(inner(p))`. */
export function composeMatrix(outer: Matrix, inner: Matrix): Matrix {
  return {
    a: f32(f32(outer.a * inner.a) + f32(outer.c * inner.b)),
    b: f32(f32(outer.b * inner.a) + f32(outer.d * inner.b)),
    c: f32(f32(outer.a * inner.c) + f32(outer.c * inner.d)),
    d: f32(f32(outer.b * inner.c) + f32(outer.d * inner.d)),
    e: f32(f32(f32(outer.a * inner.e) + f32(outer.c * inner.f)) + outer.e),
    f: f32(f32(f32(outer.b * inner.e) + f32(outer.d * inner.f)) + outer.f),
  };
}

/** `FPDFPageObj_GetMatrix` into an identity-initialized FS_MATRIX: `ok` is pdfium's result; on failure `matrix` stays the identity. */
export function objectMatrix(lib: Library, obj: number): { ok: boolean; matrix: Matrix } {
  const { m, heap } = lib;
  return heap.scoped((s) => {
    const p = s.alloc(24);
    m.HEAPF32.set([1, 0, 0, 1, 0, 0], p >> 2);
    const ok = m._FPDFPageObj_GetMatrix(obj, p) !== 0;
    const matrix = {
      a: heap.f32(p),
      b: heap.f32(p + 4),
      c: heap.f32(p + 8),
      d: heap.f32(p + 12),
      e: heap.f32(p + 16),
      f: heap.f32(p + 20),
    };
    return { ok, matrix };
  });
}

/** `FPDFPageObj_GetBounds`: `[left, bottom, right, top]`, or null. */
export function objectBounds(lib: Library, obj: number): [number, number, number, number] | null {
  const { m, heap } = lib;
  return heap.scoped((s) => {
    const p = s.alloc(16);
    if (m._FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12) === 0) return null;
    return [heap.f32(p), heap.f32(p + 4), heap.f32(p + 8), heap.f32(p + 12)];
  });
}

/** `read_color`: RGBA channels from a pdfium color getter. */
export function readColor(
  lib: Library,
  getter: (r: number, g: number, b: number, a: number) => number
): Color | null {
  const { heap } = lib;
  return heap.scoped((s) => {
    const p = s.alloc(16);
    if (getter(p, p + 4, p + 8, p + 12) === 0) return null;
    return {
      r: heap.u32(p) & 0xff,
      g: heap.u32(p + 4) & 0xff,
      b: heap.u32(p + 8) & 0xff,
      a: heap.u32(p + 12) & 0xff,
    };
  });
}

function collectPathObjects(
  lib: Library,
  obj: number,
  parent: Matrix,
  vp: ViewportTransform,
  depth: number,
  out: PathObject[]
): void {
  const { m, heap } = lib;
  const type = m._FPDFPageObj_GetType(obj);
  if (type === FPDF_PAGEOBJ_FORM) {
    if (depth >= MAX_FORM_DEPTH) return;
    const combined = composeMatrix(parent, objectMatrix(lib, obj).matrix);
    const n = m._FPDFFormObj_CountObjects(obj);
    for (let i = 0; i < n; i++) {
      const child = m._FPDFFormObj_GetObject(obj, i);
      if (child === 0) continue;
      collectPathObjects(lib, child, combined, vp, depth + 1, out);
    }
    return;
  }
  if (type !== FPDF_PAGEOBJ_PATH) return;

  const objM = composeMatrix(parent, objectMatrix(lib, obj).matrix);
  // GetBounds reports bounds in the object's content-stream space (ancestor form matrices not applied).
  const bounds = objectBounds(lib, obj);
  if (bounds === null) return;
  const [left, bottom, right, top] = bounds;
  const corners: Array<[number, number]> = [
    [left, bottom],
    [left, top],
    [right, bottom],
    [right, top],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    const px = f32(f32(f32(parent.a * x) + f32(parent.c * y)) + parent.e);
    const py = f32(f32(f32(parent.b * x) + f32(parent.d * y)) + parent.f);
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  const bbox = transformBounds(vp, { left: minX, top: maxY, right: maxX, bottom: minY });

  const [isFilled, isStroked] = heap.scoped((s): [boolean, boolean] => {
    const fill = s.alloc(4);
    const stroke = s.alloc(4);
    if (m._FPDFPath_GetDrawMode(obj, fill, stroke) === 0) return [false, false];
    return [heap.i32(fill) !== FPDF_FILLMODE_NONE, heap.i32(stroke) !== 0];
  });
  const strokeColor = readColor(lib, (r, g, b, a) =>
    m._FPDFPageObj_GetStrokeColor(obj, r, g, b, a)
  );
  const fillColor = readColor(lib, (r, g, b, a) => m._FPDFPageObj_GetFillColor(obj, r, g, b, a));
  const strokeWidth = heap.scoped((s) => {
    const w = s.alloc(4);
    m._FPDFPageObj_GetStrokeWidth(obj, w);
    return heap.f32(w);
  });

  const segments: PathSegment[] = [];
  const nSegs = m._FPDFPath_CountSegments(obj);
  heap.scoped((s) => {
    const xy = s.alloc(8);
    for (let si = 0; si < nSegs; si++) {
      const seg = m._FPDFPath_GetPathSegment(obj, si);
      if (seg === 0) continue;
      if (m._FPDFPathSegment_GetPoint(seg, xy, xy + 4) === 0) continue;
      const sx = heap.f32(xy);
      const sy = heap.f32(xy + 4);
      const ty = m._FPDFPathSegment_GetType(seg);
      const close = m._FPDFPathSegment_GetClose(seg) !== 0;
      let kind: SegmentKind;
      if (ty === FPDF_SEGMENT_MOVETO) kind = "MoveTo";
      else if (ty === FPDF_SEGMENT_LINETO) kind = "LineTo";
      else if (ty === FPDF_SEGMENT_BEZIERTO) kind = "BezierTo";
      else continue;
      const pageX = f32(f32(f32(objM.a * sx) + f32(objM.c * sy)) + objM.e);
      const pageY = f32(f32(f32(objM.b * sx) + f32(objM.d * sy)) + objM.f);
      const [x, y] = transformPoint(vp, pageX, pageY);
      segments.push({ kind, x, y, close });
    }
  });

  out.push({
    bbox,
    stroke_color: strokeColor,
    fill_color: fillColor,
    stroke_width: strokeWidth,
    is_stroked: isStroked,
    is_filled: isFilled,
    segments,
  });
}

/**
 * `Page::path_objects`: the vector path objects of a page, recursing into form
 * XObjects, with segment points in viewport space.
 */
export function pathObjects(page: Page, viewBox: RectF): PathObject[] {
  const { m } = page.lib;
  const vp = page.viewportTransform(viewBox);
  const count = m._FPDFPage_CountObjects(page.handle);
  const out: PathObject[] = [];
  for (let i = 0; i < count; i++) {
    const obj = m._FPDFPage_GetObject(page.handle, i);
    if (obj === 0) continue;
    collectPathObjects(page.lib, obj, IDENTITY, vp, 0, out);
  }
  return out;
}
