// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of ProjSignals in liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0).

/** One projected item's signals for the table model. */
export type ProjSignalItem = {
  text: string;
  /** Original box (x, y, w, h). */
  bx: [number, number, number, number];
  flow: boolean;
  /** Left / right / centre anchor counts. */
  lc: number;
  rc: number;
  cc: number;
  /** One character: the item's snap. */
  snap: string;
  block: number;
  /** From an ocria-nano faint-token read. */
  faint: boolean;
};

/** Per-item projection signals of one page, kept for the table model. */
export type ProjSignals = {
  width: number;
  height: number;
  items: ProjSignalItem[];
  /** XY-cut leaf membership: an item's original box and its leaf path. */
  leaves: Array<[[number, number, number, number], number[]]>;
};
