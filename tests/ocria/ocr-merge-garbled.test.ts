// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of the garble tests in liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0).

import { describe, expect, test } from "bun:test";

import {
  controlChars,
  controlsAreGarbled,
  isSymbolFont,
} from "../../src/ocria/ocr-merge/garble-signals.js";
import {
  garbledScope,
  pageIsGarbled,
  ratioIsGarbled,
} from "../../src/ocria/ocr-merge/garbled-scope.js";
import { misreadGlyphs } from "../../src/ocria/ocr-merge/misread.js";
import { countLettersAndVowels, nativeTextLength } from "../../src/ocria/ocr-merge/native.js";
import { tokenIsMalformed } from "../../src/ocria/ocr-merge/script-of.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import { makeBlankPage, makeFontPage } from "./ocr-merge-builders.test.js";

/** Caesar-shifted table text: the +11 letter / +3 digit map from the mixed-font fixture in issue #413. */
const GARBLED_ROWS = [
  "Tepx Nzop Opdnctaetzy Bflyetej Cpgtph Olep",
  "KI-334 Cpawlnpxpye Qtwepc Lddpxmwj 44 5359-30-34",
  "KI-335 Azcelmwp Dpydzc Wzfdtyr 45 5359-30-35",
  "KI-336 Nlwtmcletzy Mclnvpe 46 5359-30-36",
];

const HEALTHY_PARAGRAPH = [
  "This fictional report is a public parser-routing fixture.",
  "The upper section uses a standard font and extracts normally.",
  "All names, identifiers, quantities, and dates are fabricated.",
  "A PDF viewer still renders both sections as readable text.",
];

/** Clean Vietnamese: most vowels carry a diacritic. */
const VIETNAMESE_PARAGRAPH = [
  "Trường học tổ chức buổi họp phụ huynh vào sáng thứ bảy tuần trước.",
  "Những người tham dự đã thảo luận về chương trình học kỳ mới.",
  "Thầy hiệu trưởng nhấn mạnh việc rèn luyện thể chất cho học sinh.",
  "Cuối buổi, phụ huynh được nhận tài liệu hướng dẫn chi tiết.",
];

/** Tone-marked Hanyu pinyin: same failure mode, more severe. */
const PINYIN_PARAGRAPH = [
  "Rénrén shēng ér zìyóu, zài zūnyán hé quánlì shàng yīlǜ píngděng.",
  "Tāmen fùyǒu lǐxìng hé liángxīn, bìng yīng yǐ xiōngdì guānxì de jīngshén xiāng duìdài.",
];

const healthy = (): Array<[string, string]> => HEALTHY_PARAGRAPH.map((t) => ["Helvetica", t]);

describe("garble signals", () => {
  test("malformed tokens flag cipher and legacy fonts", () => {
    for (const t of [
      "hZeY",
      "cVdaVTe",
      "bViZgAVah",
      "ÞkusLkkykuÚke",
      "iNdm;s;=udf.a",
      "ࡶڜటర",
      "ประสงคŤ",
    ]) {
      expect(tokenIsMalformed(t), t).toBe(true);
    }
    for (const t of [
      "DataEncoder",
      "ShannonOverbrook",
      "iPhone",
      "McDonald",
      "fact_api.FactApi",
      "ExpRatio_Excluded",
      "iPhone発売",
      "Washington",
      "1G1FJ3D6&H",
      "W3GG",
      "ἀρχῇ",
      "ⲁⲣⲭⲏ",
      "ሀገርሰላም",
      "Ϣⲁⲣⲉ",
      "հոկտեմբերի",
      "Հանրապետությունում",
      "བསྟན་པའི",
    ]) {
      expect(tokenIsMalformed(t), t).toBe(false);
    }
    expect(tokenIsMalformed("ab")).toBeNull();
  });

  test("control chars flag broken maps, not dingbats", () => {
    const [c, n] = controlChars("$SULO \u0015\u0015\u000f \u0015\u0013\u0015\u0018 \u0010 3DJH");
    expect(controlsAreGarbled(c, n)).toBe(true);
    expect(controlChars("Plain text\twith tabs\n")).toEqual([0, 17]);
    expect(isSymbolFont("ZQNKFZ+Wingdings2")).toBe(true);
    expect(isSymbolFont("VTJFIN+Webdings")).toBe(true);
    expect(isSymbolFont("ArialMT")).toBe(false);
    expect(isSymbolFont("ABCDEF+CMEX10")).toBe(true);
    expect(isSymbolFont("Universal-GreekwithMathPi")).toBe(true);
    expect(isSymbolFont("TimesNewRomanPS-ItalicMT")).toBe(false);
  });

  test("count_letters_and_vowels counts accented vowels", () => {
    // NFC and NFD spellings of the same word count the same.
    expect(countLettersAndVowels("trường")).toEqual([6, 2]);
    expect(countLettersAndVowels("trường")).toEqual([6, 2]);
    // Non-Latin scripts still contribute nothing.
    expect(countLettersAndVowels("مرحبا こんにちは")).toEqual([0, 0]);
  });
});

describe("garbled_scope", () => {
  test("accented vowels are not garbled", () => {
    for (const para of [VIETNAMESE_PARAGRAPH, PINYIN_PARAGRAPH]) {
      const page = makeFontPage(para.map((t) => ["ArialUnicodeMS", t]));
      expect(garbledScope(page).kind, para[0]).toBe("None");
      expect(pageIsGarbled(page)).toBe(false);
    }
  });

  test("clean page", () => {
    const page = makeFontPage(healthy());
    expect(garbledScope(page).kind).toBe("None");
    expect(pageIsGarbled(page)).toBe(false);
  });

  test("whole page", () => {
    const page = makeFontPage(GARBLED_ROWS.map((t) => ["BadFont", t]));
    expect(garbledScope(page).kind).toBe("WholePage");
  });

  // Issue #413: healthy text in one font must not mask a corrupt ToUnicode map in another.
  test("mixed fonts flag only the bad font", () => {
    const page = makeFontPage([
      ...healthy(),
      ...GARBLED_ROWS.map((t): [string, string] => ["BitstreamVeraSans-Roman", t]),
    ]);
    // The page-wide sum alone does not trip: this is the regression.
    let letters = 0;
    let vowels = 0;
    for (const it of page.text_items) {
      const [l, v] = countLettersAndVowels(it.text);
      letters += l;
      vowels += v;
    }
    expect(ratioIsGarbled(letters, vowels)).toBe(false);
    const scope = garbledScope(page);
    expect(scope.kind).toBe("Fonts");
    if (scope.kind === "Fonts") expect([...scope.fonts]).toEqual(["BitstreamVeraSans-Roman"]);
    expect(pageIsGarbled(page)).toBe(true);
  });

  // A page of unmappable text (PUA char-code fallback) has no ASCII letters for the
  // vowel ratio to judge, and every item is excluded from text_length.
  test("unmapped text is garbled", () => {
    const pua = (base: number): string =>
      Array.from({ length: 8 }, (_, i) => String.fromCodePoint(0xe000 + base + i + 1)).join("");
    const page = makeFontPage(
      [0x00, 0x10, 0x20, 0x30].map((b): [string, string] => ["T3Font", pua(b)])
    );
    for (const it of page.text_items) it.has_unicode_map_error = true;
    expect(garbledScope(page).kind).toBe("None");
    expect(nativeTextLength(page)).toBe(0);
    expect(pageIsGarbled(page)).toBe(true);
  });

  test("a stray unmapped glyph does not flag a healthy page", () => {
    const page = makeFontPage([...healthy(), ["T3Font", ""]]);
    page.text_items[page.text_items.length - 1].has_unicode_map_error = true;
    expect(pageIsGarbled(page)).toBe(false);
  });

  // A font map wrong for a few glyphs leaves text that reads almost right. One misread
  // char across three or more words condemns every subset of that base font on the page.
  test("misread glyphs flag every subset of the base font", () => {
    const page = makeFontPage([
      ...healthy(),
      ["AAAAAB+Futura", "Tato kter*ch nabíječka je jednou z jin*m"],
      ["AAAAAC+Futura", "nejnověj*ch a b*t"],
      ["AAAAAD+Futura", "Kontakt"],
    ]);
    const scope = garbledScope(page);
    expect(scope.kind).toBe("Fonts");
    if (scope.kind === "Fonts") {
      expect(scope.fonts.has("AAAAAB+Futura")).toBe(true);
      expect(scope.fonts.has("AAAAAD+Futura")).toBe(true);
      expect(scope.fonts.has("Helvetica")).toBe(false);
    }
  });

  test("misread glyphs ignore compound names with one tail", () => {
    const page = makeFontPage([
      ...healthy(),
      ["STIX-Regular", "HistoAge PhenoAge GrimAge pTau acceleration"],
    ]);
    expect(garbledScope(page).kind).toBe("None");
  });

  test("misread glyphs ignore names, quotes and units", () => {
    for (const text of [
      "arXiv arXiv arXiv iPad iPad McRae McRae",
      'the expression"put out fire" and emerging"care in parentheses"exemplified',
      "70dBc -94dBc 21dBm 25dBm PubTabNet",
    ]) {
      const words = new Set(misreadGlyphs(text).map((m) => m.word));
      expect(words.size, text).toBeLessThan(3);
    }
    const found = misreadGlyphs("maGor OecutiMe horiQon va!í");
    expect(found.map((m) => m.ch).join("")).toBe("GMQ!");
    expect(found[0].word).toBe("magor");
  });

  test("a small low-vowel font does not flag a healthy page", () => {
    const page = makeFontPage([...healthy(), ["TickerFont", "NYSE NASDAQ FTSE DAX SPX"]]);
    expect(garbledScope(page).kind).toBe("None");
  });

  // A math item's text is the TeX pass's LaTeX, not decoded glyphs.
  test("math items are ignored", () => {
    const page = makeFontPage(healthy());
    for (const latex of [
      String.raw`A_{n}:f(x,y,z)=xy-z^{n+1},n\in \mathbb{N}`,
      String.raw`D_{n}:f(x,y,z)=z^{2}-x(y^{2}+x^{n-2}),n\in \mathbb{N},n\geq 4`,
      String.raw`E_{7}:f(x,y,z)=x^{2}+y^{3}+yz^{3}`,
      String.raw`s.v=\sum _{i=1}^{m}v_{i}`,
      String.raw`X=V(f)\subset \mathbb{C}^{3}`,
      String.raw`\mathrm{Co}_{1}(f)=\langle (n+1,0,1),(0,n+1,1)\rangle`,
    ]) {
      page.text_items.push(textItem({ text: latex, font_name: null, math: true }));
    }
    expect(garbledScope(page).kind).toBe("None");
    expect(pageIsGarbled(page)).toBe(false);
  });

  test("items without font names fall back to the page-wide verdict", () => {
    const page = makeBlankPage(1);
    page.text_items = GARBLED_ROWS.map((text) => textItem({ text, font_name: null }));
    expect(garbledScope(page).kind).toBe("WholePage");
  });
});
