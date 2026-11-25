// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/error.rs (crates-v2.21.2, Apache-2.0): the two variants the OCR merge returns.

/** `LiteParseError`: `message` is the Rust `Display` text, including the variant's prefix. */
export class LiteParseError extends Error {
  readonly kind: "Ocr" | "Other";

  constructor(kind: "Ocr" | "Other", detail: string) {
    super(kind === "Ocr" ? `OCR failed: ${detail}` : detail);
    this.kind = kind;
    this.name = "LiteParseError";
  }
}
