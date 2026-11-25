// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/tex_math/mod.rs (crates-v2.21.2, Apache-2.0).

// LaTeX from the glyphs of TeX-generated PDF pages, without a model.
//
// Math glyphs are recognised by their font (Computer Modern / Latin Modern / tx / px / AMS /
// Euler / rsfs math fonts); glyphs with no Unicode are read through TeX's fixed encodings
// (OML / OMS / OMX); sub/superscripts come from glyph size and baseline shift; fractions,
// overlines and square roots come from thin rules (see `structures.ts`).
//
// Only born-digital TeX is covered: a page needs a TeX-encoded math font before anything is
// emitted. Ported from the `bench/math_proto` prototype; comments marked "Note:" carry its traps.

export * from "./accents.js";
export * from "./build.js";
export * from "./encodings.js";
export * from "./encodings-oms.js";
export * from "./encodings-omx.js";
export * from "./fonts.js";
export * from "./glyphs.js";
export * from "./helpers.js";
export * from "./lines.js";
export * from "./page.js";
export * from "./rule.js";
export * from "./spans.js";
export * from "./structures.js";
export * from "./structures-parts.js";
export * from "./tables.js";
export * from "./types.js";
