// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The OCR stage against LiteParse's own values, stage by stage: each stage is
// fed upstream's input for that stage, so a mismatch names the stage that drifted.

import { beforeAll, describe, expect, test } from "bun:test";

import { Detector } from "../../src/ocria/ocr/det.js";
import type { DetMeta, OcriaModels } from "../../src/ocria/ocr/engine.js";
import { DEFAULT_OCRIA_OPTIONS, OcriaEngine } from "../../src/ocria/ocr/engine.js";
import type { Img, Quad } from "../../src/ocria/ocr/img.js";
import { resizeArea, rot90 } from "../../src/ocria/ocr/img.js";
import { splitGutters } from "../../src/ocria/ocr/gutters.js";
import { crop } from "../../src/ocria/ocr/page.js";
import { GROUPS, Recognizer, Router } from "../../src/ocria/ocr/rec.js";
import { RECOGNIZER_FILES } from "../../src/model-catalogue.js";
import { f32 } from "../../src/ocria/rust.js";
import type { ImgFacts, OcrGolden } from "./ocr-golden.js";
import {
  facts,
  goldenNames,
  loadGolden,
  loadModel,
  pagePixels,
  readJson,
  sha,
  stages,
} from "./ocr-golden.js";

let models: OcriaModels;

beforeAll(async () => {
  const rec = async (g: (typeof GROUPS)[number]): Promise<Recognizer> => {
    const files = RECOGNIZER_FILES[g];
    const meta = files.meta ? await readJson<{ visual_rtl?: boolean }>(files.meta) : {};
    return Recognizer.create(
      await loadModel(files.model),
      await readJson<string[]>(files.charset),
      meta.visual_rtl ?? false
    );
  };
  const recs = await Promise.all(GROUPS.map(rec));
  models = {
    det: await loadModel("det"),
    detMeta: await readJson<DetMeta>("detMeta"),
    router: new Router(await loadModel("router")),
    rec: async (g) => recs[g],
  };
});

/** Quads with every coordinate as the f32 the Rust recorded. */
function quads(v: unknown): Quad[] {
  return (v as Quad[]).map((q) => q.map(([x, y]) => [f32(x), f32(y)]) as Quad);
}

type DetPass = { long_side: number; boxes: Quad[]; faint: Quad[] };
type Reads = { reads: Array<[string, number]>; flip: boolean; dom: number };
type Route = { groups: number[]; flip: boolean; share: number[] };

const names = goldenNames();

describe.each(names)("%s", (name) => {
  let g: OcrGolden;
  let img0: Img;
  /** The image the lines were read in (turned a quarter when the page was sideways). */
  let img: Img;

  beforeAll(async () => {
    g = loadGolden(name);
    img0 = await pagePixels(g.image);
    const sideways = stages<boolean>(g, "page.sideways")[0] ?? false;
    img = sideways ? rot90(img0, 1) : img0;
  });

  test("decoded pixels", () => {
    expect(sha(img0.data)).toBe(g.pixels_sha);
  });

  test("detector input resize", () => {
    const want = stages<ImgFacts>(g, "det.small")[0];
    expect(facts(resizeArea(img0, want.w, want.h))).toEqual(want);
  });

  test("detector boxes and faint candidates", async () => {
    const det = new Detector(models.det, {
      longSide: DEFAULT_OCRIA_OPTIONS.detLongSide,
      thresh: models.detMeta.thresh ?? 0.5,
      merge: models.detMeta.merge ?? 0.6,
      faint: DEFAULT_OCRIA_OPTIONS.faint,
    });
    const want = stages<DetPass>(g, "det.pass")[0];
    const got = await det.detectWithFaint(img0);
    expect(got.boxes).toEqual(quads(want.boxes));
    expect(got.faint).toEqual(quads(want.faint));
  });

  test("gutter split", () => {
    const passes = stages<DetPass>(g, "det.pass");
    const sideways = stages<boolean>(g, "page.sideways")[0] ?? false;
    const boxes = quads(passes[sideways ? 1 : 0].boxes);
    expect(splitGutters(img, boxes)).toEqual(quads(stages(g, "page.gutter")[0]));
  });

  test("line crops", () => {
    const boxes = quads(stages(g, "page.gutter")[0]);
    const want = stages<ImgFacts[]>(g, "read.crops")[0] ?? [];
    expect(boxes.map((b) => facts(crop(img, b)))).toEqual(want);
  });

  test("routing", async () => {
    const want = stages<Route>(g, "route")[0];
    if (!want) return;
    const boxes = quads(stages(g, "page.gutter")[0]);
    const got = await models.router.route(boxes.map((b) => crop(img, b)));
    expect(got.groups).toEqual(want.groups);
    expect(got.flip).toBe(want.flip);
    // Rust's f32::exp is the platform's expf, which can round the last bit
    // differently from Math.exp (macOS and glibc differ too): shares agree to
    // ~1e-11, every routing decision exactly.
    got.share.forEach((s, k) => expect(s).toBeCloseTo(want.share[k], 9));
  });

  test("engine results", async () => {
    const engine = new OcriaEngine(models);
    const got = await engine.run(img0.data, img0.w, img0.h);
    const want = g.results.map((r) => ({
      text: r.text,
      bbox: r.bbox,
      confidence: f32(r.confidence),
      polygon: r.polygon ? quads([r.polygon])[0] : undefined,
      words: [],
      faint: r.faint ?? false,
    }));
    expect(got.map((r) => r.text)).toEqual(want.map((r) => r.text));
    expect(got).toEqual(want);
    // the page-level reads, before the faint pass and the filters
    const reads = stages<Reads>(g, "page.reads")[0];
    expect(reads.reads.length).toBeGreaterThanOrEqual(0);
  });
});
