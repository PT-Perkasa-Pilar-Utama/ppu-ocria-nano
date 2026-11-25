// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0): rotation, skew and upright-scan helpers.

import type { OcrResult } from "../ocr/types.js";
import { asUsize, charCount, f32, totalCmp } from "../rust.js";
import type { Page } from "../types/page.js";
import {
  atan2F32,
  hypotF32,
  remEuclidF32,
  roundF32,
  toDegreesF32,
  toRadiansF32,
} from "../rust-extra.js";

/**
 * Tilt range a page is deskewed over: below it rows already group correctly, above it the
 * "tilt" is more likely rotated or curved text than a skewed scan.
 */
const DESKEW_MIN_DEG = f32(0.3);
const DESKEW_MAX_DEG = 10;

/**
 * Share of a page's OCR text (by characters) that must share one quarter-turn rotation for the
 * page to be read as a scan turned on its side or upside down.
 */
const ROTATED_SCAN_MIN_SHARE = f32(0.7);

/** 0, 90, 180 or 270 for an item rotation in degrees. */
export function canonicalQuarter(rot: number): number {
  return (asUsize(roundF32(f32(remEuclidF32(rot, 360) / 90))) % 4) * 90;
}

/** Rotate (x, y) by `deg` degrees about (cx, cy), in the y-down page frame. */
export function rotateAbout(
  x: number,
  y: number,
  cx: number,
  cy: number,
  deg: number
): [number, number] {
  const rad = toRadiansF32(deg);
  const s = f32(Math.sin(rad));
  const c = f32(Math.cos(rad));
  const dx = f32(x - cx);
  const dy = f32(y - cy);
  return [f32(f32(cx + f32(dx * c)) - f32(dy * s)), f32(f32(cy + f32(dx * s)) + f32(dy * c))];
}

/**
 * The page's tilt in degrees (image frame, y down: positive = lines descend to the right),
 * as the length-weighted median angle of its long, near-horizontal OCR lines (length >= 4x
 * height): a long line's angle is reliable, a short piece's (a list marker, one word) is
 * often 0 or noise, and a plain median of a page with few long lines lands between the two.
 * `null` below three such lines or outside the deskew range.
 */
export function ocrPageSkew(results: readonly OcrResult[]): number | null {
  const lines: Array<[number, number]> = [];
  for (const r of results) {
    const p = r.polygon;
    if (p == null) continue;
    const dx = f32(p[1][0] - p[0][0]);
    const dy = f32(p[1][1] - p[0][1]);
    const len = hypotF32(dx, dy);
    const h = hypotF32(f32(p[3][0] - p[0][0]), f32(p[3][1] - p[0][1]));
    const deg = toDegreesF32(atan2F32(dy, dx));
    if (len >= f32(4 * h) && len > 0 && Math.abs(deg) <= 45) lines.push([deg, len]);
  }
  if (lines.length < 3) return null;
  lines.sort((a, b) => totalCmp(a[0], b[0]));
  let total = 0;
  for (const l of lines) total = f32(total + l[1]);
  const half = f32(total / 2);
  let acc = 0;
  let mid = 0;
  for (const l of lines) {
    acc = f32(acc + l[1]);
    if (acc >= half) {
      mid = l[0];
      break;
    }
  }
  const a = Math.abs(mid);
  return a >= DESKEW_MIN_DEG && a <= DESKEW_MAX_DEG ? mid : null;
}

type Box = [number, number, number, number];

/**
 * A scan whose text all runs one way other than upright (a page fed sideways or upside down):
 * re-express every item in the upright page's frame and clear its rotation, so reading order and
 * layout work on the page as written. The rotation handler in projection is built for a few
 * rotated labels on an upright page (pin labels, margin stamps), not a whole rotated page, which
 * came out reversed (180) or shredded into fake tables (90 / 270). Item boxes, and for quarter
 * turns the page size, are then in the upright frame.
 */
export function uprightRotatedScan(page: Page): void {
  const chars = [0, 0, 0, 0];
  for (const it of page.text_items) {
    chars[canonicalQuarter(it.rotation) / 90] += charCount(it.text);
  }
  const total = chars.reduce((a, b) => a + b, 0);
  // max_by_key keeps the last of equal maxima.
  let q = 0;
  for (let i = 1; i < 4; i++) if (chars[i] >= chars[q]) q = i;
  const top = chars[q];
  if (q === 0 || total < 20 || f32(top) < f32(f32(total) * ROTATED_SCAN_MIN_SHARE)) return;
  const w = page.page_width;
  const h = page.page_height;
  const turn = ([x, y, bw, bh]: Box): Box => {
    // reading bottom-to-top: the page's top edge is on the left
    if (q === 1) return [f32(h - f32(y + bh)), x, bh, bw];
    if (q === 2) return [f32(w - f32(x + bw)), f32(h - f32(y + bh)), bw, bh];
    // reading top-to-bottom: the page's top edge is on the right
    return [y, f32(w - f32(x + bw)), bh, bw];
  };
  for (const it of page.text_items) {
    [it.x, it.y, it.width, it.height] = turn([it.x, it.y, it.width, it.height]);
    it.rotation = 0;
    for (const wb of it.words) {
      [wb.x, wb.y, wb.width, wb.height] = turn([wb.x, wb.y, wb.width, wb.height]);
    }
  }
  if (q !== 2) {
    page.page_width = h;
    page.page_height = w;
  }
}

/**
 * Recover a discrete CCW rotation in degrees from a 4-point OCR polygon.
 * Returns one of 0, 90, 180, 270 (snapping to the nearest right angle), or 0
 * for nearly-square or degenerate polygons.
 *
 * Point ordering varies between OCR engines: some emit TL, TR, BR, BL in the
 * glyphs' upright reading frame (so poly[0] to poly[1] is always the reading
 * direction), but others (notably PaddleOCR 3.x with
 * `use_textline_orientation=True`) emit polygons in screen-axis order, where
 * poly[0] to poly[1] is always horizontal in screen space regardless of how the
 * text actually reads. To handle both, we pick the longer of the two
 * adjacent edges as the reading direction: the text always runs along the
 * long axis of its bounding quadrilateral.
 */
export function polygonRotationDeg(poly: readonly (readonly [number, number])[]): number {
  const e0 = [f32(poly[1][0] - poly[0][0]), f32(poly[1][1] - poly[0][1])];
  const e1 = [f32(poly[2][0] - poly[1][0]), f32(poly[2][1] - poly[1][1])];
  const len0 = f32(Math.sqrt(f32(f32(e0[0] * e0[0]) + f32(e0[1] * e0[1]))));
  const len1 = f32(Math.sqrt(f32(f32(e1[0] * e1[0]) + f32(e1[1] * e1[1]))));
  if (Math.max(len0, len1) < 1) return 0;
  // Treat near-square polygons as un-rotated: there's no reliable reading
  // axis to pick from. Single-char/CJK detections fall in here.
  const [longer, shorter] = len0 >= len1 ? [len0, len1] : [len1, len0];
  if (shorter > 0 && f32(longer / shorter) < f32(1.3)) return 0;
  const reading = len0 >= len1 ? e0 : e1;
  // atan2 with screen-down y; negate to get the conventional CCW angle.
  return canonicalQuarter(-toDegreesF32(atan2F32(reading[1], reading[0])));
}
