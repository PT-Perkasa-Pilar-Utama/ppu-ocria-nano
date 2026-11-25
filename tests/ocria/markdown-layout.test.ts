// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Block classification against LiteParse's own values: each golden's recorded
// `layout.input` (the projected pages after the table model) gives the
// recorded `layout.signals`, and with those signals, each page's recorded
// `layout.blocks`.

import { describe, expect, test } from "bun:test";

import { documentSignals } from "../../src/ocria/stages/document-signals.js";
import type { DocumentSignals } from "../../src/ocria/stages/document-signals.js";
import { extractBlocks } from "../../src/ocria/stages/extract-blocks.js";
import type { BlockOptions } from "../../src/ocria/stages/extract-blocks.js";
import {
  canon,
  loadParseGolden,
  parseGoldenNames,
  parsedPageFromJson,
  stage,
} from "./parse-golden.js";
import type { Json } from "./parse-golden.js";

type SignalsJson = {
  body_size: number;
  heading_map: Array<[number, number]>;
  header_footer: string[];
};

/** `LiteParse::block_options` for the default config with Markdown output and `extract_blocks`. */
const OPTIONS: BlockOptions = {
  outline: [],
  image_mode: "placeholder",
  keep_headers_footers: false,
};

/** A signals value in the form the recorder writes (a HashSet serializes in unspecified order, so sort it). */
function signalsJson(s: DocumentSignals): SignalsJson {
  return {
    body_size: s.body_size,
    heading_map: s.heading_map,
    header_footer: [...s.header_footer].sort(),
  };
}

function recordedSignals(v: Json): DocumentSignals {
  // SAFETY: the recorder writes layout.signals as serde writes DocumentSignals.
  const o = v as unknown as SignalsJson;
  return {
    body_size: o.body_size,
    heading_map: o.heading_map,
    header_footer: new Set(o.header_footer),
  };
}

/** Every object and array reachable from `root`, by reference. */
function reachable(root: unknown, seen: Set<object>, dupes: object[]): void {
  if (root === null || typeof root !== "object") return;
  if (seen.has(root)) {
    dupes.push(root);
    return;
  }
  seen.add(root);
  for (const v of Object.values(root)) reachable(v, seen, dupes);
}

describe.each(parseGoldenNames())("%s", (name) => {
  const g = loadParseGolden(name);
  // SAFETY: the recorder writes layout.input as the Vec<ParsedPage> the stage reads.
  const pages = (stage(g, "layout.input") as unknown as unknown[]).map(parsedPageFromJson);

  test("layout.input to layout.signals", () => {
    const signals = documentSignals(pages, false);
    const recorded = signalsJson(recordedSignals(stage(g, "layout.signals")));
    expect(canon(signalsJson(signals))).toEqual(canon(recorded));
  });

  test("layout.input and layout.signals to layout.blocks", () => {
    const signals = recordedSignals(stage(g, "layout.signals"));
    const recorded = g.stages.get("layout.blocks") ?? [];
    expect(recorded.length).toBe(pages.length);
    pages.forEach((page, i) => {
      expect(canon(extractBlocks(page, signals, OPTIONS))).toEqual(canon(recorded[i]));
    });
  });

  // Rust moves or clones every value; a TS port that skips a clone shares an object between the input,
  // the signals and the blocks, and the stage after (rotate_back_ocr_deskew) mutates block boxes in place.
  test("extract_blocks leaves its inputs unchanged and shares no object with them", () => {
    const signals = recordedSignals(stage(g, "layout.signals"));
    const before = structuredClone({ pages, signals });
    const inputObjects = new Set<object>();
    reachable({ pages, signals }, inputObjects, []);
    const outputObjects = new Set<object>();
    const dupes: object[] = [];
    for (const page of pages)
      reachable(extractBlocks(page, signals, OPTIONS), outputObjects, dupes);
    expect({ pages, signals }).toEqual(before);
    expect(dupes).toEqual([]);
    expect([...outputObjects].filter((o) => inputObjects.has(o))).toEqual([]);
  });
});
