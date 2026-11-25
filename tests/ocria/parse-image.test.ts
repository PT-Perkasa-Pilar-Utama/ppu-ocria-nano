// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The whole image path in TypeScript, image bytes to markdown, against
// LiteParse's parse of the same page. Stage tests feed each stage upstream's
// recorded input; this one runs every stage on the port's own output, so it
// also catches state that never reaches a golden.

import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { RECOGNIZER_FILES } from "../../src/model-catalogue.js";
import { readImageDpi } from "../../src/ocria/image-page.js";
import type { DetMeta } from "../../src/ocria/ocr/engine.js";
import { OcriaEngine } from "../../src/ocria/ocr/engine.js";
import { GROUPS, Recognizer, Router } from "../../src/ocria/ocr/rec.js";
import type { ParseModels } from "../../src/ocria/pipeline/parse-image.js";
import { parseImage } from "../../src/ocria/pipeline/parse-image.js";
import { tableNetFromOnnx } from "../../src/ocria/table-model/index.js";
import { ModelLoader } from "../../src/core/model-loader.js";
import { NodePlatformProvider } from "../../src/processor/platform.node.js";
import { PAGES_DIR, pagePixels } from "./ocr-golden.js";
import { canon, loadParseGolden, parseGoldenNames } from "./parse-golden.js";

let models: ParseModels;

beforeAll(async () => {
  const loader = new ModelLoader(new NodePlatformProvider(), {}, () => {});
  const recs = await Promise.all(
    GROUPS.map(async (g) => {
      const f = RECOGNIZER_FILES[g];
      const meta = f.meta ? await loader.json<{ visual_rtl?: boolean }>(f.meta) : {};
      return Recognizer.create(
        await loader.model(f.model),
        await loader.json<string[]>(f.charset),
        meta.visual_rtl ?? false
      );
    })
  );
  const engine = new OcriaEngine({
    det: await loader.model("det"),
    detMeta: await loader.json<DetMeta>("detMeta"),
    router: new Router(await loader.model("router")),
    rec: async (g) => recs[g],
  });
  const layout = tableNetFromOnnx(
    await loader.model("layout"),
    new Uint8Array(await loader.bytes("layout"))
  );
  models = { engine, layout };
});

const images = parseGoldenNames().filter((n) => loadParseGolden(n).image.endsWith(".png"));

describe.each(images)("%s", (name) => {
  test("markdown and page", async () => {
    const g = loadParseGolden(name);
    const bytes = new Uint8Array(readFileSync(join(PAGES_DIR, g.image)));
    const got = await parseImage(models, await pagePixels(g.image), {
      dpi: readImageDpi(bytes),
      keepHeadersFooters: false,
    });
    expect(got.markdown).toBe(g.text);
    // probabilities from LayoutNet's class head differ from the reference in the last f32 bit
    expect(canon({ ...got.page, model_classes: [] })).toEqual(
      canon({ ...(g.pages[0] as object), model_classes: [] })
    );
  });
});
