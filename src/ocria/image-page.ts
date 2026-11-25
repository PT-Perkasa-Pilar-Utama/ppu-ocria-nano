// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of read_image_dpi / convert_image_to_pdf in liteparse crates/liteparse/src/conversion.rs
// and load_ocr_page_image in ocr_merge.rs (crates-v2.21.2, Apache-2.0).

// An image file becomes one page: LiteParse sizes the page in points from the
// image's physical resolution and OCRs the image itself (`ocr_page_images`).

import type { Img } from "./ocr/img.js";
import { resizeArea } from "./ocr/img.js";
import { f32 } from "./rust.js";
import type { Page } from "./types/page.js";

/** Images with no density metadata are taken at this resolution (ImageMagick's default). */
export const DEFAULT_IMAGE_DPI = 150;

function u16be(d: Uint8Array, i: number): number {
  return (d[i] << 8) | d[i + 1];
}

function u32be(d: Uint8Array, i: number): number {
  return ((d[i] << 24) >>> 0) + ((d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]);
}

function isPng(d: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return d.length >= 8 && sig.every((b, i) => d[i] === b);
}

/** The PNG `pHYs` chunk as dots per inch (unit 1 = metre only). */
function readPngDpi(d: Uint8Array): [number, number] | undefined {
  if (d.length < 8 + 12 || !isPng(d)) return undefined;
  let i = 8;
  while (i + 12 <= d.length) {
    const len = u32be(d, i);
    const ty = String.fromCharCode(d[i + 4], d[i + 5], d[i + 6], d[i + 7]);
    const body = i + 8;
    if (body + len + 4 > d.length) return undefined;
    if (ty === "pHYs" && len === 9) {
      if (d[body + 8] !== 1) return undefined;
      // pixels-per-metre to pixels-per-inch (f32, as the reference)
      const dx = f32(f32(u32be(d, body)) * f32(0.0254));
      const dy = f32(f32(u32be(d, body + 4)) * f32(0.0254));
      return dx > 1 && dy > 1 ? [dx, dy] : undefined;
    }
    // pHYs must precede IDAT
    if (ty === "IDAT" || ty === "IEND") return undefined;
    i = body + len + 4;
  }
  return undefined;
}

/** The JPEG JFIF density (units 1 = dpi, 2 = dots per cm), scanned up to the first segment error. */
function readJpegDpi(d: Uint8Array): [number, number] | undefined {
  if (d.length < 4 || d[0] !== 0xff || d[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 4 <= d.length) {
    if (d[i] !== 0xff) return undefined;
    const marker = d[i + 1];
    i += 2;
    // standalone markers carry no length field
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (i + 2 > d.length) return undefined;
    const segLen = u16be(d, i);
    if (segLen < 2 || i + segLen > d.length) return undefined;
    const jfif =
      d[i + 2] === 0x4a &&
      d[i + 3] === 0x46 &&
      d[i + 4] === 0x49 &&
      d[i + 5] === 0x46 &&
      d[i + 6] === 0;
    if (marker === 0xe0 && segLen >= 16 && jfif) {
      const units = d[i + 9];
      const x = u16be(d, i + 10);
      const y = u16be(d, i + 12);
      if (!(x > 1 && y > 1)) return undefined;
      if (units === 1) return [x, y];
      if (units === 2) return [f32(x * f32(2.54)), f32(y * f32(2.54))];
      return undefined;
    }
    i += segLen;
  }
  return undefined;
}

/** An encoded image's resolution `[dpi_x, dpi_y]` (PNG and JPEG), else 150 dpi. */
export function readImageDpi(bytes: Uint8Array): [number, number] {
  return (
    (isPng(bytes) ? readPngDpi(bytes) : readJpegDpi(bytes)) ?? [
      DEFAULT_IMAGE_DPI,
      DEFAULT_IMAGE_DPI,
    ]
  );
}

/**
 * Rust's `{:.4}` of an f32, read back as PDFium reads the MediaBox (to f32).
 * Rust rounds the exact decimal value half to even; JS `toFixed` rounds half
 * up, so ties are settled here.
 */
function mediaBoxValue(v: number): number {
  const scaled = v * 10000;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  // v is an f32 and 10000 * v is exact in f64 for the page sizes in use
  const n = frac > 0.5 || (frac === 0.5 && floor % 2 === 1) ? floor + 1 : floor;
  return f32(n / 10000);
}

/** The page an image of `width` x `height` pixels becomes: its size in points from `dpi`. */
export function imagePage(width: number, height: number, dpi: readonly [number, number]): Page {
  return {
    page_number: 1,
    page_width: mediaBoxValue(f32(f32(f32(width) * 72) / f32(dpi[0]))),
    page_height: mediaBoxValue(f32(f32(f32(height) * 72) / f32(dpi[1]))),
    text_items: [],
    graphics: [],
    struct_nodes: [],
    image_refs: [],
  };
}

/**
 * The resolution an image page is OCR'd at (`load_ocr_page_image`): pixels
 * per point along the page's longer side, times 72. Throws when the image does
 * not match the page within a pixel.
 */
export function ocrImageDpi(page: Page, width: number, height: number): number {
  const ppp =
    page.page_width >= page.page_height
      ? f32(f32(width) / page.page_width)
      : f32(f32(height) / page.page_height);
  const dpi = f32(ppp * 72);
  const off =
    Math.abs(f32(f32(width) - f32(page.page_width * ppp))) > 1 ||
    Math.abs(f32(f32(height) - f32(page.page_height * ppp))) > 1;
  if (width === 0 || height === 0 || !(dpi > 0) || !Number.isFinite(dpi) || off) {
    throw new Error(
      `OCR image for page ${page.page_number} is ${width}x${height}; expected a full-page image ` +
        `matching the ${page.page_width.toFixed(1)}x${page.page_height.toFixed(1)} point page`
    );
  }
  return dpi;
}

/** `table_model::features::RULES_DPI`: the resolution LayoutNet's raster is made at. */
export const RULES_DPI = 150;

/**
 * A page render as `table_model::features::RawRaster` holds it: `bpp` bytes
 * per pixel in PDFium's BGR(x) order, rows `stride` bytes apart.
 */
export type RawRaster = { w: number; h: number; stride: number; bpp: number; buf: Uint8Array };

/**
 * LayoutNet's raster of an image page: the image area-resampled to the size
 * PDFium renders the page at `RULES_DPI` (`round(points * 150 / 72)`), in
 * BGR order. Stands in for the PDFium render of the image-wrapping PDF (see
 * docs/decisions, Q10).
 */
export function imageRaster(img: Img, page: Page): RawRaster {
  const scale = f32(RULES_DPI / 72);
  const w = Math.round(f32(page.page_width * scale));
  const h = Math.round(f32(page.page_height * scale));
  const r = resizeArea(img, w, h);
  const buf = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    buf[i * 3] = r.data[i * 3 + 2];
    buf[i * 3 + 1] = r.data[i * 3 + 1];
    buf[i * 3 + 2] = r.data[i * 3];
  }
  return { w, h, stride: w * 3, bpp: 3, buf };
}
