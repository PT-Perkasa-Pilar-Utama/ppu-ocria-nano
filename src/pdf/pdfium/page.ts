// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/pdfium/src/page.rs (crates-v2.21.2, Apache-2.0): geometry, text page and render.

import { f32 } from "../../ocria/rust.js";
import { asI32, roundAway } from "../util.js";
import { Bitmap } from "./bitmap.js";
import { PdfiumError } from "./error.js";
import type { Library } from "./library.js";
import { TextPage } from "./text-page.js";
import type { RectF } from "./types.js";

// Render flags from fpdfview.h.
export const FPDF_ANNOT = 0x01;
export const FPDF_PRINTING = 0x800;

/** Affine map from PDF page space to viewport space, probed from 3 points (see `viewportTransform`). */
export type ViewportTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

/** `ViewportTransform::transform_point`. */
export function transformPoint(
  t: ViewportTransform,
  pageX: number,
  pageY: number
): [number, number] {
  return [
    f32(f32(f32(t.a * pageX) + f32(t.b * pageY)) + t.e),
    f32(f32(f32(t.c * pageX) + f32(t.d * pageY)) + t.f),
  ];
}

/** `ViewportTransform::transform_bounds`. */
export function transformBounds(t: ViewportTransform, b: RectF): RectF {
  const [llX, llY] = transformPoint(t, b.left, b.bottom);
  const [urX, urY] = transformPoint(t, b.right, b.top);
  return {
    left: Math.min(llX, urX),
    top: Math.min(llY, urY),
    right: Math.max(llX, urX),
    bottom: Math.max(llY, urY),
  };
}

/** A loaded page; call `close()` before closing its document. */
export class Page {
  constructor(
    readonly lib: Library,
    readonly handle: number,
    readonly docHandle: number,
    /** `/UserUnit` multiplier (1.0 for normal pages): pdfium reports raw MediaBox units. */
    readonly userUnit: number
  ) {}

  /** Page width in raw MediaBox units; `viewportSize` applies `/UserUnit`. */
  width(): number {
    return this.lib.m._FPDF_GetPageWidthF(this.handle);
  }

  height(): number {
    return this.lib.m._FPDF_GetPageHeightF(this.handle);
  }

  /** `/Rotate` in quarter turns clockwise (0..=3). */
  rotation(): number {
    return this.lib.m._FPDFPage_GetRotation(this.handle);
  }

  setRotation(quarterTurns: number): void {
    this.lib.m._FPDFPage_SetRotation(this.handle, quarterTurns);
  }

  /** `Page::viewport_size`: the page size in rotation-adjusted points. */
  viewportSize(viewBox: RectF): [number, number] {
    let width = f32(Math.abs(f32(viewBox.right - viewBox.left)) * this.userUnit);
    let height = f32(Math.abs(f32(viewBox.top - viewBox.bottom)) * this.userUnit);
    const rotation = this.rotation();
    if (rotation === 1 || rotation === 3) [width, height] = [height, width];
    return [width, height];
  }

  /** `Page::view_box`: CropBox, else MediaBox, in PDF page space. */
  viewBox(): RectF | null {
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const rect = s.alloc(16);
      if (m._FPDF_GetPageBoundingBox(this.handle, rect) === 0) return null;
      return {
        left: heap.f32(rect),
        top: heap.f32(rect + 4),
        right: heap.f32(rect + 8),
        bottom: heap.f32(rect + 12),
      };
    });
  }

  /** `Page::page_to_viewport`: a PDF-space point to viewport space (top-left origin, 72 dpi). */
  pageToViewport(viewBox: RectF, pageX: number, pageY: number): [number, number] {
    const [vw, vh] = this.viewportSize(viewBox);
    // 1000x is the precision multiplier for the integer device space; capped so a huge /UserUnit page stays inside i32.
    const mult = Math.min(1000, f32(f32(536870911) / Math.max(Math.max(vw, vh), 1)));
    const deviceW = asI32(roundAway(f32(vw * mult)));
    const deviceH = asI32(roundAway(f32(vh * mult)));
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const dx = s.alloc(4);
      const dy = s.alloc(4);
      m._FPDF_PageToDevice(this.handle, 0, 0, deviceW, deviceH, 0, pageX, pageY, dx, dy);
      return [f32(f32(heap.i32(dx)) / mult), f32(f32(heap.i32(dy)) / mult)];
    });
  }

  /** `Page::bounds_to_viewport`. */
  boundsToViewport(viewBox: RectF, b: RectF): RectF {
    const [llX, llY] = this.pageToViewport(viewBox, b.left, b.bottom);
    const [urX, urY] = this.pageToViewport(viewBox, b.right, b.top);
    return {
      left: Math.min(llX, urX),
      top: Math.min(llY, urY),
      right: Math.max(llX, urX),
      bottom: Math.max(llY, urY),
    };
  }

  /** `Page::viewport_transform`: 3 probes through pdfium, then pure math. */
  viewportTransform(viewBox: RectF): ViewportTransform {
    const [e, f] = this.pageToViewport(viewBox, 0, 0);
    const [axE, cxF] = this.pageToViewport(viewBox, 1, 0);
    const [byE, dyF] = this.pageToViewport(viewBox, 0, 1);
    return { a: f32(axE - e), b: f32(byE - e), c: f32(cxF - f), d: f32(dyF - f), e, f };
  }

  /** `Page::text`. */
  text(): TextPage {
    const handle = this.lib.m._FPDFText_LoadPage(this.handle);
    if (handle === 0) throw new PdfiumError("OperationFailed");
    return new TextPage(this.lib, handle);
  }

  /**
   * `Page::render_bitmap` without a form environment: a BGRA render at `dpi`
   * onto opaque white, with annotations and printing flags.
   */
  render(dpi: number): Bitmap {
    // `/UserUnit` scales the physical page, so the requested dpi scales the pixel size by it too.
    const scale = f32(f32(dpi / 72) * this.userUnit);
    const width = asI32(roundAway(f32(this.width() * scale)));
    const height = asI32(roundAway(f32(this.height() * scale)));
    const bitmap = Bitmap.new(this.lib, width, height);
    bitmap.fillRect(0, 0, width, height, 0xffffffff);
    this.lib.m._FPDF_RenderPageBitmap(
      bitmap.handle,
      this.handle,
      0,
      0,
      width,
      height,
      0,
      FPDF_ANNOT | FPDF_PRINTING
    );
    return bitmap;
  }

  /** `Page::render_into`, without a form environment. */
  renderInto(
    bitmap: Bitmap,
    startX: number,
    startY: number,
    sizeX: number,
    sizeY: number,
    flags: number
  ): void {
    this.lib.m._FPDF_RenderPageBitmap(
      bitmap.handle,
      this.handle,
      startX,
      startY,
      sizeX,
      sizeY,
      0,
      flags
    );
  }

  /** `Page::set_crop_box`. */
  setCropBox(left: number, bottom: number, right: number, top: number): void {
    this.lib.m._FPDFPage_SetCropBox(this.handle, left, bottom, right, top);
  }

  close(): void {
    this.lib.m._FPDF_ClosePage(this.handle);
  }
}
