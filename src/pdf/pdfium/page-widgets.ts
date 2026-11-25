// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/pdfium/src/page.rs and document.rs (crates-v2.21.2, Apache-2.0): form_widget_text_rects, text_objects_overlap, flatten_form_widgets_for_display, Document::flatten_form_widgets.

// PDFium's page text API omits the glyphs a form widget paints through its appearance stream
// until the page is flattened. LiteParse flattens only the widget appearances, only on pages
// where one paints text, and only in the extraction document.

import type { Document } from "./document.js";
import { FPDF_PAGEOBJ_FORM, FPDF_PAGEOBJ_TEXT, objectBounds } from "./page-paths.js";
import type { Page } from "./page.js";
import type { RectF } from "./types.js";

const FPDF_ANNOT_WIDGET = 20;
const FPDF_ANNOT_FLAG_INVISIBLE = 1;
const FPDF_ANNOT_FLAG_HIDDEN = 2;
const FPDF_ANNOT_FLAG_NOVIEW = 32;
const FLAT_NORMALDISPLAY = 0;
const FLATTEN_SUCCESS = 1;
/** Appearance nesting is shallow in practice; the cap guards against pathological or cyclic documents. */
const MAX_DEPTH = 8;

/** Depth-bounded search for a text object, following form XObjects. */
function objectPaintsText(page: Page, object: number, depth: number): boolean {
  const { m } = page.lib;
  const type = m._FPDFPageObj_GetType(object);
  if (type === FPDF_PAGEOBJ_TEXT) return true;
  if (type !== FPDF_PAGEOBJ_FORM || depth >= MAX_DEPTH) return false;
  const count = m._FPDFFormObj_CountObjects(object);
  for (let i = 0; i < count; i++) {
    const child = m._FPDFFormObj_GetObject(object, i);
    if (child !== 0 && objectPaintsText(page, child, depth + 1)) return true;
  }
  return false;
}

/** Whether a visible widget's appearance paints text, descending into nested form XObjects. */
function annotationPaintsTextDeep(page: Page, annot: number): boolean {
  const { m } = page.lib;
  // Invisible, hidden and no-view widgets are not painted, so flattening them would introduce
  // text the reader never sees.
  const suppressed = FPDF_ANNOT_FLAG_INVISIBLE | FPDF_ANNOT_FLAG_HIDDEN | FPDF_ANNOT_FLAG_NOVIEW;
  if ((m._FPDFAnnot_GetFlags(annot) & suppressed) !== 0) return false;
  const count = m._FPDFAnnot_GetObjectCount(annot);
  for (let i = 0; i < count; i++) {
    const object = m._FPDFAnnot_GetObject(annot, i);
    if (object !== 0 && objectPaintsText(page, object, 0)) return true;
  }
  return false;
}

/**
 * `Page::form_widget_text_rects`: viewport rects of the visible AcroForm widgets that paint text
 * through their appearance streams. Empty when the page has none, which is the signal not to flatten.
 */
export function formWidgetTextRects(page: Page, viewBox: RectF): RectF[] {
  const { m, heap } = page.lib;
  const rects: RectF[] = [];
  const count = m._FPDFPage_GetAnnotCount(page.handle);
  for (let index = 0; index < count; index++) {
    const annot = m._FPDFPage_GetAnnot(page.handle, index);
    if (annot === 0) continue;
    if (
      m._FPDFAnnot_GetSubtype(annot) === FPDF_ANNOT_WIDGET &&
      annotationPaintsTextDeep(page, annot)
    ) {
      // FS_RECTF: left, top, right, bottom
      const rect = heap.scoped((s) => {
        const p = s.alloc(16);
        if (m._FPDFAnnot_GetRect(annot, p) === 0) return null;
        return {
          left: heap.f32(p),
          top: heap.f32(p + 4),
          right: heap.f32(p + 8),
          bottom: heap.f32(p + 12),
        };
      });
      if (rect !== null) rects.push(page.boundsToViewport(viewBox, rect));
    }
    m._FPDFPage_CloseAnnot(annot);
  }
  return rects;
}

/**
 * `Page::text_objects_overlap`: whether any text object already in the page content overlaps one
 * of `rects`. Flattening replaces the content under a widget, so text drawn there would be lost.
 */
export function textObjectsOverlap(page: Page, viewBox: RectF, rects: readonly RectF[]): boolean {
  if (rects.length === 0) return false;
  const { m } = page.lib;
  const count = m._FPDFPage_CountObjects(page.handle);
  for (let i = 0; i < count; i++) {
    const obj = m._FPDFPage_GetObject(page.handle, i);
    if (obj === 0 || m._FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) continue;
    const bounds = objectBounds(page.lib, obj);
    if (bounds === null) continue;
    const [left, bottom, right, top] = bounds;
    const b = page.boundsToViewport(viewBox, { left, top, right, bottom });
    if (
      rects.some(
        (r) => b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top
      )
    )
      return true;
  }
  return false;
}

function restoreAnnotationFlags(page: Page, originals: ReadonlyArray<[number, number]>): void {
  const { m } = page.lib;
  for (const [index, flags] of originals) {
    const annot = m._FPDFPage_GetAnnot(page.handle, index);
    if (annot === 0) continue;
    m._FPDFAnnot_SetFlags(annot, flags);
    m._FPDFPage_CloseAnnot(annot);
  }
}

/**
 * `Page::flatten_form_widgets_for_display`: promote visible form-widget appearances into the page
 * content without admitting comment, markup or stamp appearances (PDFium's flatten is page-wide,
 * so the other annotations are hidden first). True only when PDFium changed the page; on a
 * failure the changed flags are restored.
 */
function flattenForDisplay(page: Page): boolean {
  const { m } = page.lib;
  const suppressed: Array<[number, number]> = [];
  const count = m._FPDFPage_GetAnnotCount(page.handle);
  for (let index = 0; index < count; index++) {
    const annot = m._FPDFPage_GetAnnot(page.handle, index);
    if (annot === 0) continue;
    if (m._FPDFAnnot_GetSubtype(annot) !== FPDF_ANNOT_WIDGET) {
      const flags = m._FPDFAnnot_GetFlags(annot);
      if ((flags & FPDF_ANNOT_FLAG_HIDDEN) === 0) {
        const changed = m._FPDFAnnot_SetFlags(annot, flags | FPDF_ANNOT_FLAG_HIDDEN) !== 0;
        m._FPDFPage_CloseAnnot(annot);
        if (!changed) {
          restoreAnnotationFlags(page, suppressed);
          return false;
        }
        suppressed.push([index, flags]);
        continue;
      }
    }
    m._FPDFPage_CloseAnnot(annot);
  }
  const result = m._FPDFPage_Flatten(page.handle, FLAT_NORMALDISPLAY);
  if (result !== FLATTEN_SUCCESS) restoreAnnotationFlags(page, suppressed);
  return result === FLATTEN_SUCCESS;
}

/**
 * `Document::flatten_form_widgets`: flatten the widget appearances of page `index` in place and
 * return a freshly loaded page that shows them, or null when nothing was flattened (keep using
 * the page you have). Flattening invalidates the handle it ran on, so the load, flatten and
 * reload live here.
 */
export function flattenFormWidgets(document: Document, index: number): Page | null {
  const page = document.page(index);
  let flattened: boolean;
  try {
    flattened = flattenForDisplay(page);
  } finally {
    page.close();
  }
  return flattened ? document.page(index) : null;
}
