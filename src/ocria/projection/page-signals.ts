// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): dump_projection (signals half).

// Upstream's `dump_projection` also appends one JSON line per page to the file
// `LITEPARSE_PROJECTION_DUMP` names in debug builds. That file output is a
// debugging aid and is not ported.

import type { Region } from "../types/geometry.js";
import type { Page } from "../types/page.js";
import type { ProjDumpItem } from "./grid-state.js";
import { xyWalkLeaves } from "./projected-lines.js";
import type { ProjSignals } from "./signals.js";
import type { ProjectedTextItem } from "./types.js";

/** One page's table-model signals: the per-item records plus each item's XY-cut leaf path. */
export function buildPageSignals(
  page: Page,
  recs: readonly ProjDumpItem[],
  items: readonly ProjectedTextItem[],
  regions: Region
): ProjSignals {
  const leaves: Array<[number[], number[]]> = [];
  xyWalkLeaves(regions, [], leaves);
  const leafItems: ProjSignals["leaves"] = [];
  for (const [path, idxs] of leaves) {
    for (const i of idxs) {
      const it = items[i];
      if (it) leafItems.push([[it.orig_x, it.orig_y, it.orig_width, it.orig_height], [...path]]);
    }
  }
  return {
    width: page.page_width,
    height: page.page_height,
    items: recs.map((r) => ({
      text: r.t,
      bx: [r.x, r.y, r.w, r.h],
      flow: r.flow,
      lc: r.lc,
      rc: r.rc,
      cc: r.cc,
      snap: r.snap === "" ? " " : r.snap,
      block: r.block,
      faint: r.faint,
    })),
    leaves: leafItems,
  };
}
