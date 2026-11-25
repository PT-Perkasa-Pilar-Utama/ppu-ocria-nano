// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "fs";
import { join } from "path";

import { OcriaNanoService, detect, ocr } from "../src/index.js";
import { EXACT_OCR, loadGolden, textSimilarity } from "./ocria/ocr-golden.js";
import { loadParseGolden } from "./ocria/parse-golden.js";

const ROOT = join(import.meta.dir, "..");
const bytes = (file: string): ArrayBuffer => {
  const b = readFileSync(join(ROOT, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const fixture = (name: string): ArrayBuffer => bytes(`tests/fixtures/pages/${name}.png`);

let service: OcriaNanoService;

beforeAll(async () => {
  service = new OcriaNanoService();
  await service.initialize();
});

afterAll(async () => {
  await service.destroy();
});

describe("OcriaNanoService.convert", () => {
  test.each(["table", "two-column", "hebrew"])(
    "%s.png gives LiteParse's markdown and text exactly",
    async (name) => {
      const golden = loadParseGolden(name);
      const page = await service.convert(fixture(name));
      if (EXACT_OCR) {
        expect(page.markdown).toBe(golden.text);
        expect(page.text).toBe((golden.pages[0] as { text: string }).text);
      } else {
        // x86-64 int8 kernels change a few characters (EXACT_OCR); measured
        // 0.998 on two-column in CI run 45590617365
        expect(textSimilarity(page.markdown, golden.text)).toBeGreaterThan(0.98);
      }
    }
  );

  test("returns the public page: size in points, dpi, items and blocks", async () => {
    const page = await service.convert(fixture("table"));
    // 1700 x 2200 pixels at 150 dpi are 816 x 1056 points.
    expect([page.pageNumber, page.dpi, page.width, page.height]).toEqual([1, 150, 816, 1056]);
    expect(page.items.length).toBeGreaterThan(10);
    expect(page.items.every((i) => i.text.length > 0 && i.confidence !== null)).toBe(true);
    expect(page.blocks.length).toBeGreaterThan(0);
    expect(page.blocks.some((b) => b.kind === "merged_table")).toBe(true);
    expect(page.parsed.page_number).toBe(1);
  });

  test("a JPEG without a resolution reads at 72 dpi and finds most of the receipt's words", async () => {
    const page = await service.convert(bytes("assets/receipt.jpg"));
    expect(page.dpi).toBe(72);
    // Different JPEG decoders give slightly different pixels, so no exact match.
    const truth = readFileSync(join(ROOT, "assets/receipt-ground-truth.txt"), "utf8")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const found = new Set(page.text.toLowerCase().split(/\s+/));
    const recall = truth.filter((w) => found.has(w)).length / truth.length;
    expect(recall).toBeGreaterThanOrEqual(0.7);
  });

  test("accepts a Uint8Array, a canvas and RGBA pixels like the same PNG bytes", async () => {
    const png = readFileSync(join(ROOT, "tests/fixtures/pages/table.png"));
    const want = loadParseGolden("table").text;
    expect((await service.convert(new Uint8Array(png))).markdown).toBe(want);
    const img = await loadImage(png);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    // SAFETY: @napi-rs/canvas is the node canvas ppu-ocv uses; the service checks it at runtime.
    expect((await service.convert(canvas as never)).markdown).toBe(want);
    const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
    // Raw pixels carry no resolution, so they read at the 150 dpi default.
    expect((await service.convert({ data, width, height })).markdown).toBe(want);
  });

  test("rejects other inputs with a TypeError, and bytes that are no image with an Error", async () => {
    // SAFETY: deliberately the wrong type, to reach the runtime check.
    await expect(service.convert("not an image" as never)).rejects.toThrow(TypeError);
    await expect(service.convert(new ArrayBuffer(4))).rejects.toBeInstanceOf(Error);
  });
});

describe("OcriaNanoService.toImage", () => {
  test("turns RGBA, RGB and grey pixels into RGB", async () => {
    const rgba = await service.toImage({
      data: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]),
      width: 2,
      height: 1,
    });
    expect(Array.from(rgba.rgb.data)).toEqual([1, 2, 3, 4, 5, 6]);
    const rgb = await service.toImage({
      data: new Uint8Array([1, 2, 3, 4, 5, 6]),
      width: 2,
      height: 1,
    });
    expect(Array.from(rgb.rgb.data)).toEqual([1, 2, 3, 4, 5, 6]);
    const grey = await service.toImage({ data: new Uint8Array([7, 9]), width: 2, height: 1 });
    expect(Array.from(grey.rgb.data)).toEqual([7, 7, 7, 9, 9, 9]);
    expect([grey.rgb.w, grey.rgb.h, grey.rgb.ch, grey.dpi]).toEqual([2, 1, 3, [150, 150]]);
  });

  test("rejects pixel data that fits no layout", async () => {
    await expect(service.toImage({ data: new Uint8Array(5), width: 2, height: 1 })).rejects.toThrow(
      "fits no 2x1 RGBA, RGB or grey image"
    );
  });

  test("reads the resolution a PNG states", async () => {
    // tests/fixtures/pages/*.png carry a 150 dpi pHYs chunk.
    expect((await service.toImage(fixture("table"))).dpi).toEqual([150, 150]);
  });
});

describe("OcriaNanoService.recognize and detect", () => {
  test("recognize returns the text lines LiteParse's OCR stage finds", async () => {
    const lines = await service.recognize(fixture("table"));
    expect(lines.map((l) => l.text)).toEqual(loadGolden("table").results.map((r) => r.text));
    for (const l of lines) {
      expect(l.bbox).toHaveLength(4);
      expect(l.confidence).toBeGreaterThan(0);
      expect(l.confidence).toBeLessThanOrEqual(1);
    }
  });

  test("detect returns line quads and faint candidates without reading any text", async () => {
    const found = await service.detect(fixture("table"));
    expect(found.boxes.length).toBeGreaterThan(10);
    expect(found.boxes[0]).toHaveLength(4);
    expect(Array.isArray(found.faint)).toBe(true);
  });
});

describe("OcriaNanoService batches", () => {
  test("convertBatch keeps input order", async () => {
    const pages = await service.convertBatch([fixture("hebrew"), fixture("table")], {
      concurrency: 2,
    });
    expect(pages.map((p) => p.markdown)).toEqual([
      loadParseGolden("hebrew").text,
      loadParseGolden("table").text,
    ]);
  });

  test("settle reports a bad image and keeps the good one; without settle the batch rejects", async () => {
    const settled = await service.convertBatch([fixture("hebrew"), new ArrayBuffer(4)], {
      settle: true,
    });
    expect(settled.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    await expect(service.convertBatch([new ArrayBuffer(4)])).rejects.toBeInstanceOf(Error);
  });

  test("convertStream yields every result with its index and reports progress", async () => {
    const good = fixture("hebrew");
    const seen: number[] = [];
    let progress = 0;
    for await (const r of service.convertStream([good, good], {
      onProgress: (done) => (progress = done),
    })) {
      expect(r.status).toBe("fulfilled");
      seen.push(r.index);
    }
    expect(seen.toSorted()).toEqual([0, 1]);
    expect(progress).toBe(2);
  });
});

describe("OcriaNanoService lifecycle and options", () => {
  test("stages throw before initialize()", async () => {
    const fresh = new OcriaNanoService();
    expect(fresh.isInitialized()).toBe(false);
    expect(() => fresh.models).toThrow("initialize()");
    // an unreadable image does not hide the missing initialize()
    const unreadable = new ArrayBuffer(8);
    await expect(fresh.convert(unreadable)).rejects.toThrow("initialize()");
    await expect(fresh.recognize(unreadable)).rejects.toThrow("initialize()");
    await expect(fresh.detect(unreadable)).rejects.toThrow("initialize()");
    await fresh.destroy();
  });

  test("a missing model file names the file and the source", async () => {
    const bad = new OcriaNanoService({ models: { det: "/no/such/det.onnx" } });
    await expect(bad.initialize()).rejects.toThrow(
      "could not load det.onnx from /no/such/det.onnx"
    );
    expect(bad.isInitialized()).toBe(false);
  });

  test("layout: false loads no LayoutNet and still reads a page", async () => {
    const plain = new OcriaNanoService({ layout: false });
    await plain.initialize();
    try {
      expect(plain.models.layout).toBeNull();
      const page = await plain.convert(fixture("two-column"));
      expect(page.text.length).toBeGreaterThan(100);
      expect(page.markdown.length).toBeGreaterThan(100);
    } finally {
      await plain.destroy();
    }
  });

  test("destroy releases the models, and the service initializes again", async () => {
    const again = new OcriaNanoService({ layout: false });
    await again.initialize();
    await again.initialize();
    expect(again.isInitialized()).toBe(true);
    await again.destroy();
    expect(again.isInitialized()).toBe(false);
    await again.initialize();
    try {
      expect((await again.recognize(fixture("hebrew"))).length).toBeGreaterThan(0);
    } finally {
      await again.destroy();
    }
  });

  test("one-shot ocr() and detect() load, run and release", async () => {
    const image = fixture("hebrew");
    const page = await ocr(image, { layout: false });
    expect(page.pageNumber).toBe(1);
    expect(page.text.length).toBeGreaterThan(0);
    const found = await detect(image, { layout: false });
    expect(found.boxes.length).toBe((await service.detect(image)).boxes.length);
  });
});
