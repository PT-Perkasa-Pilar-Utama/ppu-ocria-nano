// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] unit tests of liteparse crates/liteparse/src/ocr/ocria/{img,det,page}.rs
// (crates-v2.21.2), ported.

import { describe, expect, test } from "bun:test";

import { faintBoxes } from "../../src/ocria/ocr/det-faint.js";
import { minAreaRect } from "../../src/ocria/ocr/geometry.js";
import type { Img, Quad } from "../../src/ocria/ocr/img.js";
import { rot90 } from "../../src/ocria/ocr/img.js";
import { readingFrame } from "../../src/ocria/ocr/page.js";
import { cleanLatin, isShortToken } from "../../src/ocria/ocr/scripts.js";
import { bicubicTab } from "../../src/ocria/ocr/warp.js";

describe("img.rs", () => {
  test("rot90 matches numpy", () => {
    // [[1,2,3],[4,5,6]] -> np.rot90 -> [[3,6],[2,5],[1,4]]
    const img: Img = { w: 3, h: 2, ch: 1, data: new Uint8Array([1, 2, 3, 4, 5, 6]) };
    expect(Array.from(rot90(img, 1).data)).toEqual([3, 6, 2, 5, 1, 4]);
    expect(Array.from(rot90(img, 2).data)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  test("bicubic weights sum to one", () => {
    for (const t of bicubicTab()) expect(t.reduce((a, b) => a + b, 0)).toBe(1 << 15);
  });

  test("min area rect of an axis box", () => {
    const r = minAreaRect([
      [0, 0],
      [10, 0],
      [10, 4],
      [0, 4],
    ]);
    expect(Math.abs(r.cx - 5)).toBeLessThan(1e-4);
    expect(Math.abs(r.cy - 2)).toBeLessThan(1e-4);
    expect(Math.abs(Math.max(r.w, r.h) - 10)).toBeLessThan(1e-4);
    expect(Math.abs(Math.min(r.w, r.h) - 4)).toBeLessThan(1e-4);
  });
});

describe("det.rs", () => {
  /** A 60 x 20 probability map at one image pixel per cell, with one detected line (cells x 2..20, y 8..12) 20 px tall. */
  type FaintPage = { prob: Float32Array; mask: Uint8Array; boxes: Quad[]; img: Img };

  function page(): FaintPage {
    const pw = 60;
    const ph = 20;
    const prob = new Float32Array(pw * ph);
    for (let y = 8; y < 12; y++) for (let x = 2; x < 20; x++) prob[y * pw + x] = 0.9;
    const mask = Uint8Array.from(prob, (p) => (p > Math.fround(0.55) ? 1 : 0));
    const line: Quad = [
      [0, 0],
      [22, 0],
      [22, 20],
      [0, 20],
    ];
    const img: Img = { w: pw, h: ph, ch: 3, data: new Uint8Array(pw * ph * 3).fill(255) };
    return { prob, mask, boxes: [line], img };
  }

  function faint(prob: Float32Array, mask: Uint8Array, boxes: Quad[], img: Img): Quad[] {
    return faintBoxes(prob, mask, 60, 20, (x, y) => [x, y], boxes, { thresh: 0.1, max: 24 }, img);
  }

  test("a faint token in a row is a candidate", () => {
    const { prob, mask, boxes, img } = page();
    // a weak "1" in the same row, well right of the line
    for (let y = 8; y < 12; y++) prob[y * 60 + 40] = 0.13;
    const c = faint(prob, mask, boxes, img);
    expect(c.length).toBe(1);
    // the row's band, with a side margin around the region
    expect([c[0][0][1], c[0][2][1]]).toEqual([0, 20]);
    expect(c[0][0][0]).toBeLessThan(40);
    expect(c[0][1][0]).toBeGreaterThan(41);
  });

  test("faint regions off the row, touching a line, or tall are not", () => {
    const { prob, mask, boxes, img } = page();
    // off the row: centred below the line's middle half
    prob[18 * 60 + 40] = 0.2;
    prob[19 * 60 + 40] = 0.2;
    // touching the detected line
    prob[10 * 60 + 20] = 0.2;
    // taller than 0.8 of the row
    for (let y = 0; y < 20; y++) prob[y * 60 + 50] = 0.2;
    expect(faint(prob, mask, boxes, img)).toEqual([]);
  });
});

describe("page.rs", () => {
  test("short tokens", () => {
    for (const t of ["1", "12", " 7 ", "x3", "€1", "1,0"]) expect(isShortToken(t)).toBe(true);
    for (const t of ["", "|", "--", "1 2", "1234567"]) expect(isShortToken(t)).toBe(false);
  });

  test("homoglyphs fold only inside Latin words", () => {
    expect(cleanLatin("pt6а-42 Привет")).toBe("pt6a-42 Привет");
  });

  test("clean_latin folds other scripts in Latin lines", () => {
    // world-recognizer readings of Latin words
    expect(cleanLatin("REPՍBLQՍE FRANÇAISE")).toBe("REPUBLQUE FRANÇAISE");
    expect(cleanLatin("C๐mmunicatoทร Security")).toBe("Communicatons Security");
    // a lone lookalike word in a Latin line
    expect(cleanLatin("В - Linear 1- Center")).toBe("B - Linear 1- Center");
    // other scripts' digits in a Latin line
    expect(cleanLatin("KLAR 08 (UA०८ SHIP TERM")).toBe("KLAR 08 (UA08 SHIP TERM");
    expect(cleanLatin("GSTIN: 27ADC300६/१ZK")).toBe("GSTIN: 27ADC3006/1ZK");
    // small-cap / italic Cyrillic forms in Latin words
    expect(cleanLatin("ZQX272003тOKEN OнMS")).toBe("ZQX272003TOKEN OHMS");
    expect(cleanLatin("airborлe пoise to гeduce")).toBe("airborne noise to reduce");
    // Latin / Greek lookalikes inside Cyrillic words
    expect(cleanLatin("aрганізацый ФOPYMA ПяТAГΑ")).toBe("арганізацый ФОРУМА ПяТАГА");
    // a Greek letter in an English line stays Greek
    expect(cleanLatin("significant at α = 0.05 level")).toBe("significant at α = 0.05 level");
  });

  test("clean_latin leaves other-script lines", () => {
    for (const s of [
      "Привет мир, как дела",
      "ReturnToWorkSA ਦਾ ਨਿਯਮ ਸਮੂਹ (Regulation Group) ਰਿਟਰਨ ਟੂ ਵਰਕ",
      "३ मार्च २०२४ को",
      "การบริหารความเสี่ยง ๒๕๖๗",
      "Հայաստանի Հանրապետություն",
      "ติดตั้ง Windowsนี้ ได้ที่ร้าน",
    ]) {
      expect(cleanLatin(s)).toBe(s);
    }
  });

  test("reading_frame maps a quarter turn back", () => {
    const q: Quad = [
      [0, 0],
      [10, 0],
      [10, 2],
      [0, 2],
    ];
    const r = readingFrame(q, false, true, 100);
    expect(r[0]).toEqual([99, 0]);
    expect(r[1]).toEqual([99, 10]);
  });
});
