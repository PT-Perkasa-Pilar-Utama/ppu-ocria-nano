// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): project_to_grid state.

import type { ForwardAnchors } from "./anchors.js";
import type { BoxMeta } from "./flowing.js";
import type { AnchorMap, ProjectedTextItem } from "./types.js";

/** What `project_to_grid` threads through its per-block steps (locals of the Rust function). */
export type GridCtx = {
  lines: ProjectedTextItem[][];
  meta: BoxMeta[][];
  rawLines: string[];
  medianWidth: number;
  pageWidth: number;
  pageHeight: number;
  /** Page-scoped forward anchors: they carry alignment across blocks. */
  forwardLeft: ForwardAnchors;
  forwardRight: ForwardAnchors;
  forwardCenter: ForwardAnchors;
  forwardFloating: ForwardAnchors;
};

/** One block's surviving anchor groups. */
export type BlockAnchors = { left: AnchorMap; right: AnchorMap; center: AnchorMap };

/** Per-item projection signals, recorded when signals are collected (Rust `ProjDumpItem`). */
export type ProjDumpItem = {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
  line: number;
  block: number;
  flow: boolean;
  /** "L", "R", "C" or "" when the item has no snap. */
  snap: string;
  lc: number;
  rc: number;
  cc: number;
  px: number;
  faint: boolean;
};
