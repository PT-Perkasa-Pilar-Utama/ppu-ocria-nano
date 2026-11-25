// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Replaces the raw-pointer handling of liteparse crates/pdfium (crates-v2.21.2, Apache-2.0).

import type { PdfiumModule } from "./module.js";

/** Allocations freed together when a pdfium call sequence ends. */
export class Scratch {
  private readonly pointers: number[] = [];

  constructor(private readonly heap: Heap) {}

  /** `size` zeroed bytes. */
  alloc(size: number): number {
    const p = this.heap.malloc(size);
    this.heap.m.HEAPU8.fill(0, p, p + size);
    this.pointers.push(p);
    return p;
  }

  /** A NUL-terminated UTF-8 copy of `s`. */
  cstr(s: string): number {
    const bytes = new TextEncoder().encode(s);
    const p = this.alloc(bytes.length + 1);
    this.heap.m.HEAPU8.set(bytes, p);
    return p;
  }

  release(): void {
    for (const p of this.pointers) this.heap.m._free(p);
    this.pointers.length = 0;
  }
}

/** Typed access to the module's linear memory. */
export class Heap {
  constructor(readonly m: PdfiumModule) {}

  malloc(size: number): number {
    const p = this.m._malloc(Math.max(size, 1));
    if (p === 0) throw new Error(`pdfium heap exhausted allocating ${size} bytes`);
    return p;
  }

  free(p: number): void {
    this.m._free(p);
  }

  /** Run `fn` with a scratch area that is freed afterwards. */
  scoped<T>(fn: (s: Scratch) => T): T {
    const s = new Scratch(this);
    try {
      return fn(s);
    } finally {
      s.release();
    }
  }

  i32(p: number): number {
    return this.m.HEAP32[p >> 2];
  }

  u32(p: number): number {
    return this.m.HEAPU32[p >> 2];
  }

  f32(p: number): number {
    return this.m.HEAPF32[p >> 2];
  }

  f64(p: number): number {
    return this.m.HEAPF64[p >> 3];
  }

  /** A copy of `n` bytes at `p`. */
  bytes(p: number, n: number): Uint8Array {
    return this.m.HEAPU8.slice(p, p + n);
  }

  /** Copy `data` into a new allocation the caller frees. */
  write(data: Uint8Array): number {
    const p = this.malloc(data.length);
    this.m.HEAPU8.set(data, p);
    return p;
  }

  /** UTF-16LE text of `units` code units at `p` (`String::from_utf16_lossy`). */
  utf16(p: number, units: number): string {
    const view = new Uint16Array(this.m.HEAPU8.buffer, p, units);
    return new TextDecoder("utf-16le", { ignoreBOM: true }).decode(view);
  }
}
