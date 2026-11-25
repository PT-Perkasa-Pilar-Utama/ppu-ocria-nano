// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The recorded table-model stages of tests/fixtures/golden/parse, per page that
// ran the model, as the typed values the ported functions take. f32 fields are
// rounded to f32 on load (serde_json writes the shortest decimal of an f32).

import { ModelLoader } from "../../src/core/model-loader.js";
import type { PageImage } from "../../src/ocria/table-model/features-raster.js";
import type { Rules } from "../../src/ocria/table-model/features.js";
import type { FUnit } from "../../src/ocria/table-model/features.js";
import type { Logits } from "../../src/ocria/table-model/net.js";
import type { TableNet } from "../../src/ocria/table-model/net-onnx.js";
import { tableNetFromOnnx } from "../../src/ocria/table-model/net-onnx.js";
import type { PageInput } from "../../src/ocria/table-model/page-input.js";
import type { PageModel } from "../../src/ocria/table-model/types.js";
import type { Unit } from "../../src/ocria/table-model/units.js";
import type { ProjSignals } from "../../src/ocria/projection/signals.js";
import type { ParsedPage } from "../../src/ocria/types/page.js";
import { NodePlatformProvider } from "../../src/processor/platform.node.js";
import type { Json } from "./parse-golden.js";
import { loadParseGolden, parsedPageFromJson, parseGoldenNames, stage } from "./parse-golden.js";

/** `serde_json`'s f32 numbers as f32: every number in `v` rounded. */
export function deepF32<T>(v: T): T {
  if (typeof v === "number") {
    // SAFETY: T is number here.
    return Math.fround(v) as T;
  }
  if (Array.isArray(v)) {
    // SAFETY: an array maps to an array of the same element type.
    return v.map(deepF32) as T;
  }
  if (v && typeof v === "object") {
    // SAFETY: an object maps to an object with the same keys.
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepF32(x)])) as T;
  }
  return v;
}

/** A recorded raster: ruling lines, and the page image with its pixels as a sha256 hex string. */
export type RasterGolden = {
  rules: Rules | null;
  img: { w: number; h: number; px: string; k: number } | null;
};

/** The recorded stage values of one page that ran the model. */
export type TableCase = {
  name: string;
  image: string;
  pageNumber: number;
  /** `table.inputs.final`: units, wh, rules, ocr, img (the deferred render is not serialized). */
  input: PageInput;
  sig: ProjSignals;
  raster: RasterGolden;
  /** `table.units`: the units the model read, and their `FUnit`s. */
  units: Unit[];
  fu: FUnit[];
  feats: {
    n: number;
    feats: number[];
    pairf: number[];
    img: { canvas_sha: string; boxes: number[][]; valid: number[] } | null;
  };
  logits: Logits;
  model: Json;
  /** `project.pages` entry of this page, before the model. */
  projected: ParsedPage;
};

export const IS_IMAGE = (image: string): boolean => image.endsWith(".png");

function logitsFromJson(v: Json): Logits {
  const o = v as unknown as {
    n: number;
    node: number[];
    pair: number[];
    cls: number[];
    n_cls: number;
    n_pair: number;
  };
  return {
    n: o.n,
    node: Float32Array.from(o.node),
    pair: Float32Array.from(o.pair),
    cls: Float32Array.from(o.cls),
    n_cls: o.n_cls,
    n_pair: o.n_pair,
  };
}

export function tableCase(name: string): TableCase {
  const g = loadParseGolden(name);
  const finals = stage(g, "table.inputs.final") as unknown as Array<[number, PageInput]>;
  const [pageNumber, rawInput] = finals[0];
  const input: PageInput = { ...rawInput, rules: deepF32(rawInput.rules), img: null, raw: null };
  const sigs = stage(g, "project.signals") as unknown as Record<string, ProjSignals>;
  const raster = deepF32(stage(g, "table.raster") as unknown as RasterGolden);
  const u = stage(g, "table.units") as unknown as { units: Unit[]; fu: FUnit[] };
  const projPages = stage(g, "project.pages") as unknown as Array<{ page_number: number }>;
  const projected = projPages.find((p) => p.page_number === pageNumber);
  if (!projected) throw new Error(`${name}: no project.pages entry for page ${pageNumber}`);
  return {
    name,
    image: g.image,
    pageNumber,
    input,
    sig: deepF32(sigs[String(pageNumber)]),
    raster,
    units: u.units,
    fu: deepF32(u.fu),
    feats: deepF32(stage(g, "table.feats") as unknown as TableCase["feats"]),
    logits: logitsFromJson(stage(g, "table.logits")),
    model: stage(g, "table.model"),
    projected: parsedPageFromJson(projected),
  };
}

export function tableCases(): TableCase[] {
  return parseGoldenNames().map(tableCase);
}

/** The recorded PageModel (`table.model`) typed. */
export function recordedModel(c: TableCase): PageModel {
  return c.model as unknown as PageModel;
}

const loader = new ModelLoader(new NodePlatformProvider(), {}, () => {});

let net: Promise<TableNet> | null = null;

/** LayoutNet (tablenet.onnx) on ONNX Runtime, from the verified model cache. */
export function loadTableNet(): Promise<TableNet> {
  net ??= (async () => {
    const [model, bytes] = await Promise.all([loader.model("layout"), loader.bytes("layout")]);
    return tableNetFromOnnx(model, new Uint8Array(bytes));
  })();
  return net;
}

/** A copy of `l` with its own arrays (the decoder masks logits in place). */
export function copyLogits(l: Logits): Logits {
  return { ...l, node: l.node.slice(), pair: l.pair.slice(), cls: l.cls.slice() };
}

export type { PageImage };
