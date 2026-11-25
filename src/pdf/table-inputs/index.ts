// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/{mod.rs,units.rs,features.rs} (crates-v2.21.2, Apache-2.0): page_input, attach_render, pdf_units, char_bold, render_raw.

// The PDFium half of what the table model needs from a page. The pure half lives in
// src/ocria/table-model/ (`unitsFromChars`, `processRaster`, `runPage`).

import type { RawRaster } from "../../ocria/image-page.js";
import { RULES_DPI } from "../../ocria/image-page.js";
import { charCount, isWhitespace } from "../../ocria/rust.js";
import { MAX_UNITS } from "../../ocria/table-model/page-input.js";
import type { PageInput } from "../../ocria/table-model/page-input.js";
import type { Ch, Unit } from "../../ocria/table-model/units.js";
import { charOf, rotatePage } from "../../ocria/table-model/units.js";
import { unitsFromChars } from "../../ocria/table-model/units-chars.js";
import type { Page } from "../pdfium/page.js";
import type { TextPage } from "../pdfium/text-page.js";

/** Font-name fragments that mark a bold face. */
const BOLD_NAMES = ["Bold", "Black", "Heavy", "Semibold", ",B"];

/** `char_bold`: bold from the character's font: weight >= 600, or a bold-ish font name. */
function charBold(tp: TextPage, i: number): boolean | null {
  const w = tp.fontWeight(i);
  const name = tp.fontInfo(i)?.[0] ?? null;
  if (w < 0 && name === null) return null;
  const n = name ?? "";
  return w >= 600 || BOLD_NAMES.some((k) => n.includes(k));
}

/** `pdf_units`: units of a page's text layer (empty when it has none), and the rendered page size. */
export function pdfUnits(page: Page): [Unit[], [number, number]] {
  const vb = page.viewBox();
  if (vb === null) return [[], [0, 0]];
  const [cl, cb, cr, ct] = [vb.left, vb.bottom, vb.right, vb.top];
  const w0 = cr - cl;
  const h0 = ct - cb;
  const rot = ((page.rotation() % 4) + 4) % 4;
  const [w, h] = rot % 2 === 1 ? [h0, w0] : [w0, h0];
  const tp = page.text();
  try {
    // A Ch, or null for a generated line break
    const chars: Array<Ch | null> = [];
    const n = tp.charCount();
    for (let i = 0; i < n; i++) {
      let u = tp.unicode(i);
      let ch = charOf(u);
      if (tp.isGenerated(i) && (ch === "\r" || ch === "\n")) {
        chars.push(null);
        continue;
      }
      if (u === 0 || ch === "\r" || ch === "\n" || ch === "￾") continue;
      // PDFium reports U+0002 both for a hyphen it found at a line end and for a font that
      // encodes a drawn '-' (often a minus) as code 0x02 with no ToUnicode map. The line-end
      // hyphen is dropped (a wrapped cell's word break); the real code reads as '-', since
      // dropping it flips the sign of negative table values.
      if (u === 0x02) {
        if (tp.isHyphen(i)) continue;
        u = 0x2d;
        ch = "-";
      }
      const b = tp.charBox(i);
      if (b === null) continue;
      const pb = rotatePage([b.left - cl, ct - b.top, b.right - cl, ct - b.bottom], rot, w0, h0);
      const space = ch !== null && isWhitespace(ch);
      if (pb[2] <= pb[0] && pb[3] <= pb[1] && !space) continue;
      chars.push({ c: [u], pb, size: tp.fontSize(i), bold: charBold(tp, i) });
    }
    return [unitsFromChars(chars, w, h), [w, h]];
  } finally {
    tp.close();
  }
}

/** `render_raw`: render the page at `RULES_DPI` and copy its pixels out. */
export function renderRaw(page: Page): RawRaster {
  const bmp = page.render(RULES_DPI);
  try {
    // 4 bytes per pixel: pdfium's BGRA bitmap
    return {
      w: bmp.width(),
      h: bmp.height(),
      stride: bmp.stride(),
      bpp: 4,
      buf: bmp.buffer().slice(),
    };
  } finally {
    bmp.destroy();
  }
}

/**
 * `page_input`: units and ruling lines of a page. A page without a usable text layer (under 20
 * characters) is an OCR page: its units are built from LiteParse's OCR items once projected.
 * Null when the page has more units than the model takes.
 */
export function pageInput(page: Page, withRules: boolean, withImg: boolean): PageInput | null {
  const [allUnits, wh] = pdfUnits(page);
  if (allUnits.length > MAX_UNITS) return null;
  let chars = 0;
  for (const u of allUnits) chars += charCount(u.text);
  const ocr = chars < 20;
  const units = ocr ? [] : allUnits;
  // One render serves the ruling lines and the image branch; `runPage` turns it into them.
  const raw =
    withRules || withImg ? { raw: renderRaw(page), rules: withRules, img: withImg } : null;
  return { units, wh, rules: null, ocr, img: null, raw };
}

/** `attach_render`: add the page render to an input built without it. */
export function attachRender(
  input: PageInput,
  page: Page,
  withRules: boolean,
  withImg: boolean
): void {
  if (!(withRules || withImg)) return;
  input.raw = { raw: renderRaw(page), rules: withRules, img: withImg };
}
