// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/mod.rs (crates-v2.21.2, Apache-2.0): what the model needs from a page.

// `page_input` and `attach_render` read an open PDFium page and are not
// ported: a `PageInput` is built from its serialized shape, with the page
// render in `raw` when `rules` / `img` are left to `runPage`.

import type { RawRaster } from "../image-page.js";
import type { Rules } from "./features.js";
import type { PageImage } from "./features-raster.js";
import { processRaster } from "./features-raster.js";
import type { Logits } from "./net.js";
import type { Unit } from "./units.js";

/**
 * Pages with more units than this skip the model (attention and decoding grow with N^2; such
 * pages are dense prose or indexes, where the heuristic path is kept).
 */
export const MAX_UNITS = 1500;

/** The page render, when `rules` / `img` are left to `runPage`, with the (rules, img) wanted from it. */
export type DeferredRender = { raw: RawRaster; rules: boolean; img: boolean };

/**
 * What the model needs from an open PDFium page, joined later with that page's projection
 * signals. `raw` is the Rust's `#[serde(skip)]` field: it is never in a serialized input.
 */
export type PageInput = {
  units: Unit[];
  /** rendered page size in points */
  wh: [number, number];
  rules: Rules | null;
  /** no usable text layer: the units come from the page's OCR items at `runPage` */
  ocr: boolean;
  /** the page for a model with an image branch */
  img: PageImage | null;
  raw?: DeferredRender | null;
};

/** `PageInput::raster`: ruling lines and image input, built from the deferred render. */
export function pageInputRaster(input: PageInput): [Rules | null, PageImage | null] {
  const d = input.raw;
  if (d == null) return [null, null];
  return processRaster(d.raw, d.rules, d.img);
}

/**
 * Units running against the page's main direction (a sidebar, a rotated label) take part in
 * the forward pass but are never table cells: their logits are set to -9 (as tablelab.run_model).
 */
export function maskMinor(l: Logits, minor: readonly boolean[]): void {
  const n = l.n;
  minor.forEach((m, i) => {
    if (!m) return;
    l.node[i * 2] = -9;
    l.node[i * 2 + 1] = -9;
    for (let k = 0; k < 4; k++) {
      for (let j = 0; j < n; j++) {
        l.pair[(k * n + i) * n + j] = -9;
        l.pair[(k * n + j) * n + i] = -9;
      }
    }
  });
}
