// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The public PDF entry (`ppu-ocria-nano/pdf`): convertPdf on whole documents. The stage
// goldens are in tests/ocria/pdf-*.test.ts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OcriaNanoService } from "../src/index.js";
import { convertPdf, hostFonts, isPdf, loadPdfium } from "../src/pdf/index.js";
import { loadParseGolden } from "./ocria/parse-golden.js";

const PAGES = join(import.meta.dir, "fixtures", "pages");
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(join(PAGES, name)));

let service: OcriaNanoService;

beforeAll(async () => {
  service = new OcriaNanoService();
  await service.initialize();
});

afterAll(async () => {
  await service.destroy();
});

describe("hostFonts", () => {
  test.if(process.platform === "darwin")(
    "reads the twelve standard-14 substitutes from the macOS font folders, once",
    async () => {
      const first = hostFonts();
      expect(hostFonts()).toBe(first);
      const fonts = await first;
      expect(fonts.map((f) => f.name)).toContain("Times New Roman Bold Italic");
      expect(fonts.length).toBe(12);
      // a TrueType file starts with the sfnt version 0x00010000
      expect([...fonts[0].data.subarray(0, 4)]).toEqual([0, 1, 0, 0]);
    }
  );
});

describe("convertPdf", () => {
  test("reads a digital PDF's text layer into the golden markdown, with no OCR dpi", async () => {
    const pages = await convertPdf(service, read("digital.pdf"));
    expect(pages.length).toBe(1);
    expect(pages[0].markdown).toBe(loadParseGolden("digital").text);
    expect(pages[0].dpi).toBeNull();
    expect(pages[0].pageNumber).toBe(1);
  });

  test("accepts an ArrayBuffer and OCRs a scanned page at the requested dpi", async () => {
    const bytes = read("scanned.pdf");
    const pages = await convertPdf(service, bytes.buffer.slice(0) as ArrayBuffer, { dpi: 150 });
    expect(pages[0].dpi).toBe(150);
    expect(pages[0].items.some((i) => i.confidence !== null)).toBe(true);
  });

  test("OCRs a scanned page at 250 dpi by default", async () => {
    // 250 dpi is above the despeckle and bilevel-scan threshold the 150 dpi goldens never reach.
    const pages = await convertPdf(service, read("scanned.pdf"));
    expect(pages[0].dpi).toBe(250);
    expect(pages[0].items.some((i) => i.confidence !== null)).toBe(true);
  });

  test("maxPages stops after that many pages", async () => {
    expect((await convertPdf(service, read("multipage.pdf"))).length).toBe(3);
    const pages = await convertPdf(service, read("multipage.pdf"), { maxPages: 1 });
    expect(pages.length).toBe(1);
  });

  test("keeps the repeated page header when the service keeps headers and footers", async () => {
    const header = "Ridge Survey Annual Report";
    const dropped = await convertPdf(service, read("multipage.pdf"), { maxPages: 1 });
    expect(dropped[0].markdown).not.toContain(header);
    const keeping = new OcriaNanoService({ keepHeadersFooters: true });
    await keeping.initialize();
    try {
      const kept = await convertPdf(keeping, read("multipage.pdf"), { maxPages: 1 });
      expect(kept[0].markdown).toContain(header);
    } finally {
      await keeping.destroy();
    }
  });

  test("opens an encrypted PDF only with its password", async () => {
    await expect(convertPdf(service, read("locked.pdf"))).rejects.toThrow("password required");
    const pages = await convertPdf(service, read("locked.pdf"), { password: "secret" });
    expect(pages[0].markdown).toContain("locked with a password");
  });

  test("throws on bytes that are not a PDF, or a broken one", async () => {
    expect(isPdf(read("table.png"))).toBe(false);
    await expect(convertPdf(service, read("table.png"))).rejects.toThrow("not a PDF");
    await expect(convertPdf(service, new TextEncoder().encode("%PDF-1.7 broken"))).rejects.toThrow(
      "invalid PDF format"
    );
  });

  test("the pdfium instance is shared between calls", async () => {
    expect(await loadPdfium()).toBe(await loadPdfium());
  });

  test("reads the models before the PDF, so an uninitialized service names initialize()", async () => {
    const fresh = new OcriaNanoService();
    await expect(convertPdf(fresh, read("digital.pdf"))).rejects.toThrow("initialize");
  });
});
