// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The full-pipeline goldens in tests/fixtures/golden/parse: LiteParse
// crates-v2.21.2 parsing each fixture page with ocria-nano OCR on the page
// image, LayoutNet from tablenet.onnx and markdown output, with each stage's
// value recorded (see scripts/golden/README.md). Stage values are serde JSON
// of the Rust types; the loaders below fill `#[serde(default)]` fields as
// Rust's Deserialize does, and `canon` makes two values comparable.

import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";

import type { Page, ParsedPage, ProjectedLine } from "../../src/ocria/types/page.js";
import type { TextItem } from "../../src/ocria/types/text-item.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import { emptyRegion } from "../../src/ocria/types/geometry.js";

export const PARSE_DIR: string = join(import.meta.dir, "../fixtures/golden/parse");

/** A JSON value as serde_json writes it. */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type ParseGolden = {
  image: string;
  /** Every value recorded under each checkpoint, in order. */
  stages: Map<string, Json[]>;
  /** The parse's markdown. */
  text: string;
  pages: Json[];
};

export function parseGoldenNames(): string[] {
  return readdirSync(PARSE_DIR)
    .filter((f) => f.endsWith(".parse.json.gz"))
    .map((f) => f.replace(/\.parse\.json\.gz$/, ""));
}

export function loadParseGolden(name: string): ParseGolden {
  const raw = JSON.parse(
    gunzipSync(readFileSync(join(PARSE_DIR, `${name}.parse.json.gz`))).toString("utf8")
  ) as {
    image: string;
    stages: Array<{ k: string; v: Json }>;
    text: string;
    pages: Json[];
  };
  const stages = new Map<string, Json[]>();
  for (const s of raw.stages) {
    const list = stages.get(s.k) ?? [];
    list.push(s.v);
    stages.set(s.k, list);
  }
  return { image: raw.image, stages, text: raw.text, pages: raw.pages };
}

/** The first value recorded under `k`; throws when the checkpoint is missing. */
export function stage(g: ParseGolden, k: string): Json {
  const v = g.stages.get(k)?.[0];
  if (v === undefined) throw new Error(`golden ${g.image} has no "${k}" checkpoint`);
  return v;
}

/** `TextItem` from serde JSON, with defaults for omitted fields. */
export function textItemFromJson(v: unknown): TextItem {
  const o = v as Partial<TextItem>;
  return textItem({ ...o, style_pieces: (o.style_pieces ?? []).map(textItemFromJson) });
}

/** `ProjectedLine` from serde JSON (`span_item_indices` defaults to empty). */
export function projectedLineFromJson(v: unknown): ProjectedLine {
  const o = v as ProjectedLine;
  return {
    ...o,
    span_item_indices: o.span_item_indices ?? [],
    spans: o.spans.map(textItemFromJson),
  };
}

/** `Page` from serde JSON, with defaults for omitted fields. */
export function pageFromJson(v: unknown): Page {
  const o = v as Page;
  return {
    ...o,
    graphics: o.graphics ?? [],
    struct_nodes: o.struct_nodes ?? [],
    image_refs: o.image_refs ?? [],
    text_items: o.text_items.map(textItemFromJson),
  };
}

/** `ParsedPage` from serde JSON, with defaults for omitted fields. */
export function parsedPageFromJson(v: unknown): ParsedPage {
  const o = v as ParsedPage;
  return {
    ...o,
    markdown: o.markdown ?? "",
    projected_lines: (o.projected_lines ?? []).map(projectedLineFromJson),
    regions: o.regions ?? emptyRegion(),
    graphics: o.graphics ?? [],
    figures: o.figures ?? [],
    projected_item_frames: o.projected_item_frames ?? [],
    model_tables: o.model_tables ?? [],
    model_classes: o.model_classes ?? [],
    model_blocks: o.model_blocks ?? [],
    struct_nodes: o.struct_nodes ?? [],
    image_refs: o.image_refs ?? [],
    text_items: o.text_items.map(textItemFromJson),
  };
}

/**
 * A value made comparable with a Rust golden: every number as the f32 it
 * stands for (+0 for -0), and object keys whose value is null, undefined,
 * false, "" or [] dropped (serde's skipped defaults and JS's absent fields
 * mean the same).
 */
export function canon(v: unknown): Json {
  if (typeof v === "number") {
    const f = Math.fround(v);
    return f === 0 ? 0 : f;
  }
  if (Array.isArray(v)) return v.map(canon);
  if (v instanceof Map) return canon(Object.fromEntries(v));
  if (v && typeof v === "object") {
    const out: { [k: string]: Json } = {};
    for (const [k, x] of Object.entries(v)) {
      const c = canon(x);
      if (c === null || c === undefined || c === false || c === "") continue;
      if (Array.isArray(c) && c.length === 0) continue;
      out[k] = c;
    }
    return out;
  }
  if (typeof v === "string" || typeof v === "boolean" || v === null) return v;
  return null;
}
