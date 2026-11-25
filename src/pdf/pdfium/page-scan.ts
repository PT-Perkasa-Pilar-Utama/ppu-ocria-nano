// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/pdfium/src/page.rs (crates-v2.21.2, Apache-2.0): form_image_bounds, filled_path_bounds, has_annotation_text, image_metadata.

import { f32 } from "../../ocria/rust.js";
import type { ImageBounds } from "./page-images.js";
import {
  FPDF_PAGEOBJ_FORM,
  FPDF_PAGEOBJ_IMAGE,
  FPDF_PAGEOBJ_PATH,
  FPDF_PAGEOBJ_TEXT,
  IDENTITY,
  composeMatrix,
  objectBounds,
  objectMatrix,
  readColor,
} from "./page-paths.js";
import type { Page } from "./page.js";
import type { Library } from "./library.js";
import type { Matrix, RectF } from "./types.js";

const FPDF_FILLMODE_NONE = 0;
const FPDF_ANNOT_POPUP = 16;
const FPDF_ANNOT_FLAG_HIDDEN = 2;
/** Nesting limit of `collect_form_images`. */
const FORM_IMAGE_DEPTH = 8;
/** Nesting limit of `collect_filled_paths`. */
const FILLED_PATH_DEPTH = 4;

/** Page-space boxes of images in a form and its nested forms. */
function collectFormImages(
  lib: Library,
  form: number,
  parent: Matrix,
  depth: number,
  out: RectF[]
): void {
  if (depth >= FORM_IMAGE_DEPTH) return;
  const { m } = lib;
  const formToPage = composeMatrix(parent, objectMatrix(lib, form).matrix);
  const n = m._FPDFFormObj_CountObjects(form);
  for (let i = 0; i < n; i++) {
    const child = m._FPDFFormObj_GetObject(form, i);
    if (child === 0) continue;
    const type = m._FPDFPageObj_GetType(child);
    if (type === FPDF_PAGEOBJ_FORM) {
      collectFormImages(lib, child, formToPage, depth + 1, out);
    } else if (type === FPDF_PAGEOBJ_IMAGE) {
      // The image matrix maps the unit square into the form.
      const { ok, matrix: im } = objectMatrix(lib, child);
      if (!ok) continue;
      const mm = composeMatrix(formToPage, im);
      const rect: RectF = {
        left: Infinity,
        right: -Infinity,
        bottom: Infinity,
        top: -Infinity,
      };
      for (const [x, y] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const px = f32(f32(f32(mm.a * x) + f32(mm.c * y)) + mm.e);
        const py = f32(f32(f32(mm.b * x) + f32(mm.d * y)) + mm.f);
        rect.left = Math.min(rect.left, px);
        rect.right = Math.max(rect.right, px);
        rect.bottom = Math.min(rect.bottom, py);
        rect.top = Math.max(rect.top, py);
      }
      if (Number.isFinite(rect.left) && Number.isFinite(rect.top)) out.push(rect);
    }
  }
}

/** `Page::form_image_bounds`: viewport boxes of images inside form XObjects, clamped to the page. */
export function formImageBounds(page: Page, minSizePt: number): ImageBounds[] {
  const viewBox: RectF = page.viewBox() ?? {
    left: 0,
    top: page.height(),
    right: page.width(),
    bottom: 0,
  };
  const pageRects: RectF[] = [];
  const count = page.lib.m._FPDFPage_CountObjects(page.handle);
  for (let i = 0; i < count; i++) {
    const obj = page.lib.m._FPDFPage_GetObject(page.handle, i);
    if (obj === 0 || page.lib.m._FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_FORM) continue;
    collectFormImages(page.lib, obj, IDENTITY, 0, pageRects);
  }
  const out: ImageBounds[] = [];
  for (const r of pageRects) {
    const clamped: RectF = {
      left: Math.max(r.left, viewBox.left),
      right: Math.min(r.right, viewBox.right),
      bottom: Math.max(r.bottom, viewBox.bottom),
      top: Math.min(r.top, viewBox.top),
    };
    if (
      f32(clamped.right - clamped.left) < minSizePt ||
      f32(clamped.top - clamped.bottom) < minSizePt
    )
      continue;
    const v = page.boundsToViewport(viewBox, clamped);
    out.push({
      x: v.left,
      y: v.top,
      width: f32(v.right - v.left),
      height: f32(v.bottom - v.top),
    });
  }
  return out;
}

function collectFilledPaths(
  lib: Library,
  obj: number,
  transform: Matrix | null,
  pageWidth: number,
  pageHeight: number,
  minSizePt: number,
  maxPageCoverage: number,
  depth: number,
  out: ImageBounds[]
): void {
  const { m, heap } = lib;
  const type = m._FPDFPageObj_GetType(obj);
  if (type === FPDF_PAGEOBJ_FORM) {
    if (depth >= FILLED_PATH_DEPTH) return;
    // Child bounds are reported in the form's coordinate space, so the form matrix (composed
    // with any outer form transforms) maps them into page space.
    const { ok, matrix } = objectMatrix(lib, obj);
    let combined: Matrix | null;
    if (transform !== null) combined = ok ? composeMatrix(transform, matrix) : transform;
    else combined = ok ? matrix : null;
    const childCount = m._FPDFFormObj_CountObjects(obj);
    for (let i = 0; i < childCount; i++) {
      const child = m._FPDFFormObj_GetObject(obj, i);
      if (child === 0) continue;
      collectFilledPaths(
        lib,
        child,
        combined,
        pageWidth,
        pageHeight,
        minSizePt,
        maxPageCoverage,
        depth + 1,
        out
      );
    }
    return;
  }
  if (type !== FPDF_PAGEOBJ_PATH) return;

  // Only filled paths can be glyph outlines; skip stroke-only paths (table borders, rules, underlines).
  const fillMode = heap.scoped((s) => {
    const fill = s.alloc(4);
    const stroke = s.alloc(4);
    return m._FPDFPath_GetDrawMode(obj, fill, stroke) === 0 ? null : heap.i32(fill);
  });
  if (fillMode === null || fillMode === FPDF_FILLMODE_NONE) return;

  // Skip light or transparent fills: glyph outlines are ink-like (dark, opaque), while zebra
  // striping and shading use light pastels. A fill color that cannot be read (pattern or
  // shading) is kept.
  const color = readColor(lib, (r, g, b, a) => m._FPDFPageObj_GetFillColor(obj, r, g, b, a));
  if (color !== null) {
    if (color.a < 128) return;
    const luminance = f32(
      f32(f32(f32(0.299) * color.r) + f32(f32(0.587) * color.g)) + f32(f32(0.114) * color.b)
    );
    if (luminance > 140) return;
  }

  const bounds = objectBounds(lib, obj);
  if (bounds === null) return;
  let [left, bottom, right, top] = bounds;
  if (transform !== null) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of [
      [left, bottom],
      [right, bottom],
      [left, top],
      [right, top],
    ]) {
      const tx = f32(f32(f32(transform.a * x) + f32(transform.c * y)) + transform.e);
      const ty = f32(f32(f32(transform.b * x) + f32(transform.d * y)) + transform.f);
      minX = Math.min(minX, tx);
      maxX = Math.max(maxX, tx);
      minY = Math.min(minY, ty);
      maxY = Math.max(maxY, ty);
    }
    left = minX;
    right = maxX;
    bottom = minY;
    top = maxY;
  }
  const w = f32(right - left);
  const h = f32(top - bottom);
  if (w < minSizePt || h < minSizePt) return;
  if (w > f32(pageWidth * maxPageCoverage) && h > f32(pageHeight * maxPageCoverage)) return;
  out.push({ x: left, y: f32(pageHeight - top), width: w, height: h });
}

/**
 * `Page::filled_path_bounds`: viewport boxes of filled vector paths (dark, opaque, not full-page),
 * recursing into form XObjects with each form's transform applied.
 */
export function filledPathBounds(
  page: Page,
  minSizePt: number,
  maxPageCoverage: number
): ImageBounds[] {
  const pageWidth = page.width();
  const pageHeight = page.height();
  const out: ImageBounds[] = [];
  const count = page.lib.m._FPDFPage_CountObjects(page.handle);
  for (let i = 0; i < count; i++) {
    const obj = page.lib.m._FPDFPage_GetObject(page.handle, i);
    if (obj === 0) continue;
    collectFilledPaths(
      page.lib,
      obj,
      null,
      pageWidth,
      pageHeight,
      minSizePt,
      maxPageCoverage,
      0,
      out
    );
  }
  return out;
}

/**
 * `Page::has_annotation_text`: whether any visible, non-popup annotation paints text through its
 * appearance stream at the top level. Deliberately shallow: widening it would reroute pages to OCR.
 */
export function hasAnnotationText(page: Page): boolean {
  const { m } = page.lib;
  const count = m._FPDFPage_GetAnnotCount(page.handle);
  for (let index = 0; index < count; index++) {
    const annot = m._FPDFPage_GetAnnot(page.handle, index);
    if (annot === 0) continue;
    const subtype = m._FPDFAnnot_GetSubtype(annot);
    const flags = m._FPDFAnnot_GetFlags(annot);
    const hidden = (flags & FPDF_ANNOT_FLAG_HIDDEN) !== 0;
    let found = false;
    if (!hidden && subtype !== FPDF_ANNOT_POPUP) {
      const objectCount = m._FPDFAnnot_GetObjectCount(annot);
      for (let i = 0; i < objectCount && !found; i++) {
        const object = m._FPDFAnnot_GetObject(annot, i);
        found = object !== 0 && m._FPDFPageObj_GetType(object) === FPDF_PAGEOBJ_TEXT;
      }
    }
    m._FPDFPage_CloseAnnot(annot);
    if (found) return true;
  }
  return false;
}

/** `PageObject::image_metadata` reduced to the field a caller reads: bits per pixel, null on failure. */
export function imageBitsPerPixel(page: Page, obj: number): number | null {
  const { m, heap } = page.lib;
  return heap.scoped((s) => {
    // FPDF_IMAGEOBJ_METADATA: width, height, horizontal_dpi, vertical_dpi, bits_per_pixel, ...
    const p = s.alloc(28);
    if (m._FPDFImageObj_GetImageMetadata(obj, page.handle, p) === 0) return null;
    return heap.u32(p + 16);
  });
}
