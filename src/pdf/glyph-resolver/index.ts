// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/glyph_resolver.rs (crates-v2.21.2, Apache-2.0).

// Optional out-of-tree glyph recovery hook: a richer recovery strategy than the built-in glyph-name
// and reverse-cmap passes (for example a glyph-outline to unicode database), consulted last, only
// for glyphs the built-in recovery could not decode.

/**
 * Font size, in points, at which glyph path segments are sampled before they are handed to a
 * `GlyphResolver`. Resolvers that key on a hash of the outline must sample at this size.
 */
export const GLYPH_RESOLVER_FONT_SIZE = 10;

/** One path segment of a glyph outline: `[segment_type, x, y]`, type LINETO=0, BEZIERTO=1, MOVETO=2. */
export type GlyphSegment = readonly [number, number, number];

/** Recovers the text of a glyph from its vector outline. */
export type GlyphResolver = {
  /** The replacement text (one or more chars, for a ligature), or null if the glyph is not recognized. */
  resolve(segments: readonly GlyphSegment[]): string | null;
};
