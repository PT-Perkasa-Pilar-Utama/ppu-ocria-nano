// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): page interruptions.

import type { Rect } from "../../types/geometry.js";
import type { ImageRef } from "../../types/document.js";
import type { PositionedBlock } from "../block-types.js";
import { positionedBlock } from "../blocks/positioned.js";

/**
 * A document-order page interruption that breaks the normal text flow: either
 * a horizontal rule (from vector graphics) or a figure injection (a raster
 * image ref). Collected into one y-sorted stream so the two kinds interleave
 * correctly by vertical position rather than emitting all of one before the
 * other.
 */
export type Interruption =
  /** A divider rule, carrying the region of the stroke that produced it. */
  | { Hr: Rect }
  | { Figure: ImageRef }
  /**
   * A ruled table detected by the global pass, already fully built. Emitted
   * at its top-y position like other interruptions; its lines were pulled
   * out of the region pipeline so it won't be re-detected per-region.
   */
  | { Table: PositionedBlock };

/** An interruption and the y it sits at. */
export type YInterruption = [number, Interruption];

/**
 * Turn an interruption into a positioned block. Both the page-level walker
 * and `FlowState::emit_before` funnel through here so the two emission paths
 * stay identical.
 */
export function positionedInterruption(kind: Interruption): PositionedBlock {
  if ("Hr" in kind) return positionedBlock("HorizontalRule", kind.Hr);
  if ("Figure" in kind) {
    const r = kind.Figure;
    return positionedBlock({ Figure: { id: r.id, format: r.format } }, { ...r.bbox });
  }
  return kind.Table;
}

/** A `Peekable` iterator over the y-sorted interruptions of one region. */
export class InterruptionQueue {
  private pos = 0;

  constructor(private readonly items: readonly YInterruption[]) {}

  /** The y of the next interruption, or null when the queue is empty. */
  peekY(): number | null {
    return this.pos < this.items.length ? this.items[this.pos][0] : null;
  }

  next(): Interruption {
    return this.items[this.pos++][1];
  }
}
