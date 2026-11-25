// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/units.rs (crates-v2.21.2, Apache-2.0): unit types and frame maps.

// A unit is a run of text the writer put down together, cut wherever a gap is
// wide enough to separate two cells. Boxes are built in the text's reading
// frame (sideways tables read in their own direction); `pbox` keeps the
// rendered page's frame. Points, top-left origin, f64.

import { isWhitespace } from "../rust.js";

/** A box `[x0, y0, x1, y1]`. */
export type Box4 = [number, number, number, number];

/** A word `(x0, x1, text)` in the reading frame, for `split_aligned`. */
export type UnitWord = [number, number, string];

/** One text unit. `q` is the reading direction on the page: right, up, left, down = 0..3. */
export type Unit = {
  /** reading-frame box */
  bx: Box4;
  /** rendered-page box */
  pbox: Box4;
  text: string;
  h: number;
  size: number;
  bold: boolean | null;
  q: number;
  /** runs against the page's main direction (a sidebar, a rotated label) */
  minor: boolean;
  words: UnitWord[];
};

/** One character: code unit(s), rendered-page box, font size, bold. */
export type Ch = { c: number[]; pb: Box4; size: number; bold: boolean | null };

export const CELL_GAP = 1.8;

/** `char::from_u32`: the character of a code point, or null for a surrogate or out-of-range value. */
export function charOf(u: number): string | null {
  if (u > 0x10ffff || (u >= 0xd800 && u <= 0xdfff)) return null;
  return String.fromCodePoint(u);
}

/** `Ch::is_space`. */
export function chIsSpace(c: Ch): boolean {
  if (c.c.length !== 1) return false;
  const ch = charOf(c.c[0]);
  return ch !== null && isWhitespace(ch);
}

/** A box in the rendered page to the reading frame of direction `q`. */
export function toFrame(b: Box4, q: number, w: number, h: number): Box4 {
  const [x0, y0, x1, y1] = b;
  switch (q) {
    case 1:
      return [h - y1, x0, h - y0, x1];
    case 2:
      return [w - x1, h - y1, w - x0, h - y0];
    case 3:
      return [y0, w - x1, y1, w - x0];
    default:
      return b;
  }
}

/** The inverse of `toFrame`. */
export function fromFrame(b: Box4, q: number, w: number, h: number): Box4 {
  const [x0, y0, x1, y1] = b;
  switch (q) {
    case 1:
      return [y0, h - x1, y1, h - x0];
    case 2:
      return [w - x1, h - y1, w - x0, h - y0];
    case 3:
      return [w - y1, x0, w - y0, x1];
    default:
      return b;
  }
}

/** Page box (crop-relative, top-left) to the rendered page under /Rotate `rot` quarter turns. */
export function rotatePage(b: Box4, rot: number, w0: number, h0: number): Box4 {
  const [x0, y0, x1, y1] = b;
  switch (rot) {
    case 1:
      return [h0 - y1, x0, h0 - y0, x1];
    case 2:
      return [w0 - x1, h0 - y1, w0 - x0, h0 - y0];
    case 3:
      return [y0, w0 - x1, y1, w0 - x0];
    default:
      return b;
  }
}

/** `median` of units.rs: sorts `v` in place; the mean of the two middle values for an even count. */
export function median(v: number[]): number {
  v.sort((a, b) => a - b);
  const n = v.length;
  if (n % 2 === 1) return v[(n - 1) / 2];
  return (v[n / 2 - 1] + v[n / 2]) / 2;
}
