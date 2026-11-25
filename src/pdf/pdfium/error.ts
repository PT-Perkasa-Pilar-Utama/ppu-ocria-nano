// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/pdfium/src/error.rs (crates-v2.21.2, Apache-2.0).

export type PdfiumErrorKind =
  | "Unknown"
  | "FileNotFound"
  | "InvalidFormat"
  | "PasswordRequired"
  | "UnsupportedSecurity"
  | "PageNotFound"
  | "OperationFailed";

const MESSAGES: Record<PdfiumErrorKind, string> = {
  Unknown: "unknown pdfium error",
  FileNotFound: "file not found",
  InvalidFormat: "invalid PDF format",
  PasswordRequired: "password required",
  UnsupportedSecurity: "unsupported security handler",
  PageNotFound: "page not found",
  OperationFailed: "operation failed",
};

/** A pdfium failure; `kind` is the Rust `PdfiumError` variant. */
export class PdfiumError extends Error {
  constructor(readonly kind: PdfiumErrorKind) {
    super(MESSAGES[kind]);
    this.name = "PdfiumError";
  }
}

// FPDF_ERR_* from fpdfview.h, as FPDF_GetLastError reports them.
const ERR_FILE = 2;
const ERR_FORMAT = 3;
const ERR_PASSWORD = 4;
const ERR_SECURITY = 5;
const ERR_PAGE = 6;

/** `PdfiumError::from_last_error` for an `FPDF_GetLastError` code. */
export function pdfiumErrorFromCode(code: number): PdfiumError {
  switch (code) {
    case ERR_FILE:
      return new PdfiumError("FileNotFound");
    case ERR_FORMAT:
      return new PdfiumError("InvalidFormat");
    case ERR_PASSWORD:
      return new PdfiumError("PasswordRequired");
    case ERR_SECURITY:
      return new PdfiumError("UnsupportedSecurity");
    case ERR_PAGE:
      return new PdfiumError("PageNotFound");
    default:
      return new PdfiumError("Unknown");
  }
}
