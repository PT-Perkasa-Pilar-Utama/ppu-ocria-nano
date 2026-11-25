// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): rule segments shared by every table pass.

import type { GraphicPrimitive } from "../../../types/geometry.js";
import { clusterHSegments, clusterVSegments, extractHVSegments } from "../grid-segments.js";
import type { HSeg, VSeg } from "../grid-segments.js";

/**
 * H/V rule segments extracted once from a page's graphics and shared by every
 * table-detection pass on the page. The global ruled pass, the per-region
 * ruled pass, the leaf-veto re-check, and the rule-band pass all consume the
 * same segments; extracting per call would redo the work once per region.
 */
export type RuleSegments = {
  /** Horizontal segments, clustered by y. */
  hs: HSeg[];
  /** Vertical segments as extracted, before same-x clustering. The component splitter needs these: clustering unions y-ranges across gaps. */
  raw_vs: VSeg[];
  /** Vertical segments, clustered by x. */
  vs: VSeg[];
};

export function extractRuleSegments(graphics: readonly GraphicPrimitive[]): RuleSegments {
  const [h, rawVs] = extractHVSegments(graphics);
  const hs = clusterHSegments(h);
  const vs = clusterVSegments(rawVs);
  return { hs, raw_vs: rawVs, vs };
}
