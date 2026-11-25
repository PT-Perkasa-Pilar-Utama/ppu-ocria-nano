// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/pdfium/src/bitmap.rs (crates-v2.21.2, Apache-2.0): the parts the render paths use.

import { PdfiumError } from "./error.js";
import type { Library } from "./library.js";

// FPDFBitmap_* from fpdfview.h.
export const FPDF_BITMAP_BGR = 2;
export const FPDF_BITMAP_BGRA = 4;

/** A pixel buffer owned by pdfium; call `destroy()` when done. */
export class Bitmap {
  private constructor(
    private readonly lib: Library,
    readonly handle: number
  ) {}

  /** `Bitmap::new_with_format`. */
  static newWithFormat(lib: Library, width: number, height: number, format: number): Bitmap {
    const handle = lib.m._FPDFBitmap_CreateEx(width, height, format, 0, 0);
    if (handle === 0) throw new PdfiumError("OperationFailed");
    return new Bitmap(lib, handle);
  }

  /** `Bitmap::new`: BGRA. */
  static new(lib: Library, width: number, height: number): Bitmap {
    return Bitmap.newWithFormat(lib, width, height, FPDF_BITMAP_BGRA);
  }

  width(): number {
    return this.lib.m._FPDFBitmap_GetWidth(this.handle);
  }

  height(): number {
    return this.lib.m._FPDFBitmap_GetHeight(this.handle);
  }

  stride(): number {
    return this.lib.m._FPDFBitmap_GetStride(this.handle);
  }

  /** `Bitmap::fill_rect`: `color` is ARGB (0xAARRGGBB). */
  fillRect(left: number, top: number, width: number, height: number, color: number): void {
    this.lib.m._FPDFBitmap_FillRect(this.handle, left, top, width, height, color);
  }

  /** `Bitmap::buffer`: a view of the pixels (BGRA row-major, `stride()` bytes per row); copy before the next pdfium call that can grow memory. */
  buffer(): Uint8Array {
    const ptr = this.lib.m._FPDFBitmap_GetBuffer(this.handle);
    return this.lib.m.HEAPU8.subarray(ptr, ptr + this.stride() * this.height());
  }

  /** `Bitmap::to_rgb`: tightly packed RGB, alpha dropped. */
  toRgb(): Uint8Array {
    const width = this.width();
    const height = this.height();
    const stride = this.stride();
    const src = this.buffer();
    const rgb = new Uint8Array(width * height * 3);
    let o = 0;
    for (let y = 0; y < height; y++) {
      let i = y * stride;
      for (let x = 0; x < width; x++, i += 4) {
        rgb[o++] = src[i + 2];
        rgb[o++] = src[i + 1];
        rgb[o++] = src[i];
      }
    }
    return rgb;
  }

  /** `Bitmap::to_luma`: 8-bit gray, Rec. 601 weights. */
  toLuma(): Uint8Array {
    const width = this.width();
    const height = this.height();
    const stride = this.stride();
    const src = this.buffer();
    const luma = new Uint8Array(width * height);
    let o = 0;
    for (let y = 0; y < height; y++) {
      let i = y * stride;
      for (let x = 0; x < width; x++, i += 4) {
        luma[o++] = (77 * src[i + 2] + 150 * src[i + 1] + 29 * src[i]) >> 8;
      }
    }
    return luma;
  }

  destroy(): void {
    this.lib.m._FPDFBitmap_Destroy(this.handle);
  }
}
