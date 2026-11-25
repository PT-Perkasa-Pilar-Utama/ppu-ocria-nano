// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// run_page on the pages whose text runs sideways, with a net that answers the recorded
// logits: the page is turned upright, read, and the boxes come back to the page. The
// recorded rules and image of such a page are already upright, so they are turned to the
// page's frame first (the inverse turn) and `runPage` must turn them back.

import { describe, expect, test } from "bun:test";

import { defaultDecodeOptions } from "../../src/ocria/table-model/decode.js";
import type { PageImage } from "../../src/ocria/table-model/features-raster.js";
import type { Rules } from "../../src/ocria/table-model/features.js";
import type { TableNet } from "../../src/ocria/table-model/net-onnx.js";
import type { PageInput } from "../../src/ocria/table-model/page-input.js";
import { mainRotation, rotateImage, rotateRules } from "../../src/ocria/table-model/rotate.js";
import { MAX_UNITS } from "../../src/ocria/table-model/page-input.js";
import { runPage } from "../../src/ocria/table-model/run-page.js";
import type { Unit } from "../../src/ocria/table-model/units.js";
import { rotatePage, toFrame } from "../../src/ocria/table-model/units.js";
import { canon } from "./parse-golden.js";
import { copyLogits, recordedModel, tableCases } from "./table-model-fixtures.js";

const opt = defaultDecodeOptions();
const turned = tableCases().filter((c) => mainRotation(c.input) !== null);

/** The turn that undoes reading direction `q`. */
const inverse = (q: number): number => (4 - q) % 4;

describe.each(turned)("$name", (c) => {
  const q = mainRotation(c.input) ?? 0;

  test("runPage turns the page upright and the boxes back", async () => {
    const [w, h] = c.input.wh;
    // the page's own frame: the upright recorded raster turned back
    const upW = q % 2 === 1 ? h : w;
    const upH = q % 2 === 1 ? w : h;
    const rules: Rules | null = c.raster.rules && rotateRules(c.raster.rules, inverse(q), upW, upH);
    const im = c.raster.img;
    const img: PageImage | null =
      im &&
      rotateImage(
        { w: im.w, h: im.h, px: new Uint8Array(im.w * im.h).fill(7), k: im.k },
        inverse(q)
      );
    const net: TableNet = {
      cfg: { d: 0, layers: 0, heads: 0, pair_d: 0, stack_feats: false, rule_feats: false, img: {} },
      feat_dim: 68,
      forward: async () => copyLogits(c.logits),
    };
    const input: PageInput = { ...c.input, rules, img };
    const pm = await runPage(net, null, input, c.sig, opt);
    const want = recordedModel(c);
    // the class probabilities come from `exp`, which differs from the platform's by a step
    expect(canon({ ...pm, classes: pm.classes.map((x) => ({ ...x, probs: [] })) })).toEqual(
      canon({ ...want, classes: want.classes.map((x) => ({ ...x, probs: [] })) })
    );
  });
});

describe("pages the model skips", () => {
  const net: TableNet = {
    cfg: { d: 0, layers: 0, heads: 0, pair_d: 0, stack_feats: false, rule_feats: false, img: {} },
    feat_dim: 68,
    forward: async () => {
      throw new Error("the net must not run");
    },
  };
  const unit = (text: string): Unit => ({
    bx: [0, 0, 10, 10],
    pbox: [0, 0, 10, 10],
    text,
    h: 10,
    size: 10,
    bold: null,
    q: 0,
    minor: false,
    words: [],
  });
  const empty = { tables: [], classes: [], blocks: [] };

  test("one unit, little text, or an OCR page without signals read as no model", async () => {
    const input = (units: Unit[], ocr = false): PageInput => ({
      units,
      wh: [100, 100],
      rules: null,
      ocr,
      img: null,
    });
    expect(
      await runPage(net, null, input([unit("only one unit of text here")]), null, opt)
    ).toEqual(empty);
    expect(await runPage(net, null, input([unit("a"), unit("b")]), null, opt)).toEqual(empty);
    expect(await runPage(net, null, input([], true), null, opt)).toEqual(empty);
    const many = Array.from({ length: MAX_UNITS + 1 }, () => unit("twenty or more characters"));
    expect(await runPage(net, null, input(many), null, opt)).toEqual(empty);
  });
});

describe("rotation of rules and image", () => {
  test("a rule goes where its end points go", () => {
    const rules: Rules = {
      h: [[100, 10, 60]],
      v: [[30, 20, 90]],
    };
    const [w, h] = [200, 120];
    for (const q of [1, 2, 3]) {
      const r = rotateRules(rules, q, w, h);
      const hs = toFrame([10, 100, 60, 100], q, w, h);
      const vs = toFrame([30, 20, 30, 90], q, w, h);
      const all = [...r.h.map((s) => ["h", s] as const), ...r.v.map((s) => ["v", s] as const)];
      expect(all.length).toBe(2);
      // a quarter turn swaps horizontal and vertical; a half turn keeps them
      const swapped = q % 2 === 1;
      expect(r.h.length).toBe(1);
      expect(r.v.length).toBe(1);
      const wantH = swapped ? vs : hs;
      const wantV = swapped ? hs : vs;
      expect(r.h[0][0]).toBeCloseTo((wantH[1] + wantH[3]) / 2, 3);
      expect(r.v[0][0]).toBeCloseTo((wantV[0] + wantV[2]) / 2, 3);
    }
  });

  test("a character box goes to the rendered page under /Rotate", () => {
    const b: [number, number, number, number] = [10, 20, 40, 35];
    expect(rotatePage(b, 0, 300, 200)).toEqual(b);
    expect(rotatePage(b, 1, 300, 200)).toEqual([165, 10, 180, 40]);
    expect(rotatePage(b, 2, 300, 200)).toEqual([260, 165, 290, 180]);
    expect(rotatePage(b, 3, 300, 200)).toEqual([20, 260, 35, 290]);
  });

  test("an image turned by q and back by its inverse is the image", () => {
    const px = Uint8Array.from({ length: 7 * 5 }, (_, i) => i);
    const im: PageImage = { w: 7, h: 5, px, k: 1 };
    for (const q of [1, 2, 3]) {
      const t = rotateImage(im, q);
      expect([t.w, t.h]).toEqual(q % 2 === 1 ? [5, 7] : [7, 5]);
      expect(rotateImage(t, inverse(q))).toEqual(im);
    }
    // q = 1 maps (x, y) to (h - 1 - y, x)
    expect(rotateImage(im, 1).px[3 * 5 + (5 - 1 - 2)]).toBe(px[2 * 7 + 3]);
  });
});
