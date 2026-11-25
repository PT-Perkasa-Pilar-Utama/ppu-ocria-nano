// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/pdfium/src/library.rs (crates-v2.21.2, Apache-2.0).

import { Document } from "./document.js";
import { pdfiumErrorFromCode } from "./error.js";
import { Heap } from "./heap.js";
import type { LoadPdfiumOptions, PdfiumModule } from "./module.js";
import { loadPdfiumModule } from "./module.js";
import { installSystemFonts } from "./system-fonts.js";

/**
 * A pdfium session. pdfium is single-threaded: one `Library` owns one wasm
 * instance, so the Rust process-wide lock has nothing to guard here. Each
 * instance is independent.
 */
export class Library {
  readonly heap: Heap;

  private constructor(readonly m: PdfiumModule) {
    this.heap = new Heap(m);
  }

  /** `Library::init`: load the wasm module and `FPDF_InitLibrary`. */
  static async init(options: LoadPdfiumOptions = {}): Promise<Library> {
    const library = Library.fromModule(await loadPdfiumModule(options));
    installSystemFonts(library.m, options.fonts ?? []);
    return library;
  }

  /** A library over an already instantiated module. */
  static fromModule(m: PdfiumModule): Library {
    m._FPDF_InitLibrary();
    return new Library(m);
  }

  /**
   * `Library::load_document_from_bytes`. pdfium keeps reading `data` while the
   * document is open, so the document owns a heap copy and frees it on close.
   */
  loadDocumentFromBytes(data: Uint8Array, password: string | null): Document {
    const buffer = this.heap.write(data);
    const handle = this.heap.scoped((s) =>
      this.m._FPDF_LoadMemDocument(buffer, data.length, password === null ? 0 : s.cstr(password))
    );
    if (handle === 0) {
      this.heap.free(buffer);
      throw pdfiumErrorFromCode(this.m._FPDF_GetLastError());
    }
    return new Document(this, handle, buffer);
  }
}
