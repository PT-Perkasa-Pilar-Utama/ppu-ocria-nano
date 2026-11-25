// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/pdfium/src/page.rs (crates-v2.21.2, Apache-2.0): `Page::image_objects` without image data.

import { f32 } from "../../ocria/rust.js";
import { FPDF_PAGEOBJ_IMAGE, objectBounds } from "./page-paths.js";
import type { Page } from "./page.js";
import type { RectF } from "./types.js";

/** Bounding box of an embedded image object: viewport space, top-left origin, points. */
export type ImageBounds = { x: number; y: number; width: number; height: number };

/** Metadata of an embedded image object (pixel size, rotation and data are only read with `include_data`, which no caller here sets). */
export type ImageObjectInfo = { object_index: number; bounds: ImageBounds };

export type ImageObjects = { images: ImageObjectInfo[]; error_count: number };

/**
 * `Page::image_objects` with `include_data = false`: the image objects at
 * least `minSizePt` on both sides that do not cover more than
 * `maxPageCoverage` of the page in both dimensions.
 */
export function imageObjects(page: Page, minSizePt: number, maxPageCoverage: number): ImageObjects {
  const { m } = page.lib;
  const pageWidth = page.width();
  const pageHeight = page.height();
  const viewBox: RectF = page.viewBox() ?? {
    left: 0,
    top: pageHeight,
    right: pageWidth,
    bottom: 0,
  };
  const count = m._FPDFPage_CountObjects(page.handle);
  const images: ImageObjectInfo[] = [];
  let errorCount = 0;
  let imageIndex = 0;
  for (let i = 0; i < count; i++) {
    const obj = m._FPDFPage_GetObject(page.handle, i);
    if (obj === 0) continue;
    if (m._FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_IMAGE) continue;
    const objectIndex = imageIndex;
    imageIndex += 1;
    const bounds = objectBounds(page.lib, obj);
    if (bounds === null) {
      errorCount += 1;
      continue;
    }
    const [left, bottom, right, top] = bounds;
    const w = f32(right - left);
    const h = f32(top - bottom);
    if (w < minSizePt || h < minSizePt) continue;
    if (w > f32(pageWidth * maxPageCoverage) && h > f32(pageHeight * maxPageCoverage)) continue;
    const v = page.boundsToViewport(viewBox, { left, top, right, bottom });
    images.push({
      object_index: objectIndex,
      bounds: { x: v.left, y: v.top, width: f32(v.right - v.left), height: f32(v.bottom - v.top) },
    });
  }
  return { images, error_count: errorCount };
}
