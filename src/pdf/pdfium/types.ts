// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/pdfium/src/types.rs (crates-v2.21.2, Apache-2.0).

export type RectF = { left: number; top: number; right: number; bottom: number };

export type CharBox = { left: number; right: number; bottom: number; top: number };

export type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };

export type Color = { r: number; g: number; b: number; a: number };

export type TextRect = { left: number; top: number; right: number; bottom: number };
