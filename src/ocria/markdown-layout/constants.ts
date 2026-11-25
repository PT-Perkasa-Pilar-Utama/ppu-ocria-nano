// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/mod.rs (crates-v2.21.2, Apache-2.0): shared constants.

import { f32 } from "../rust.js";

/**
 * Minimum plausible text-row height in points. Floors a `bbox.height` before
 * it is multiplied into a band / tolerance window, so a degenerate near-zero
 * glyph box can't collapse that window to nothing. Shared by the table
 * HR-suppress headroom (`classify`) and outline y-tolerance (`headings`) so
 * the two stay in sync.
 */
export const MIN_ROW_HEIGHT_PT: number = f32(8.0);

/** `config::ImageMode` (serde lowercase): whether and how figures appear in the block list. */
export type ImageMode = "off" | "placeholder" | "embed";
