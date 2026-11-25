// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// resegment_by_model_blocks (src/ocria/resegment) on upstream's recorded page, plus the
// #[cfg(test)] tests of liteparse crates/liteparse/src/resegment.rs (crates-v2.21.2).

import { describe, expect, test } from "bun:test";

import { numericToken, resegmentByModelBlocks } from "../../src/ocria/resegment/index.js";
import type { ParsedPage } from "../../src/ocria/types/page.js";
import {
  canon,
  loadParseGolden,
  parsedPageFromJson,
  parseGoldenNames,
  stage,
} from "./parse-golden.js";
import { recordedModel, tableCase } from "./table-model-fixtures.js";

describe.each(parseGoldenNames())("%s", (name) => {
  const c = tableCase(name);
  const want = parsedPageFromJson(stage(loadParseGolden(name), "resegment.page"));

  test("page after the model: lines split and reordered along its blocks", () => {
    const m = recordedModel(c);
    const page: ParsedPage = {
      ...structuredClone(c.projected),
      model_tables: m.tables,
      model_classes: m.classes,
      model_blocks: m.blocks,
    };
    resegmentByModelBlocks(page);
    expect(canon(page)).toEqual(canon(want));
  });
});

describe("resegment.rs", () => {
  test("numeric tokens are margins", () => {
    for (const t of ["19", "14:00-14:10", "2pm", "5:35pm", "(3)", "§3.1", "2025", "1.2.3."]) {
      expect(numericToken(t), t).toBe(true);
    }
    for (const t of ["Abstract", "a", "pm", "Room", "7F", "COVID-19", "-", "..."]) {
      expect(numericToken(t), t).toBe(false);
    }
  });
});
