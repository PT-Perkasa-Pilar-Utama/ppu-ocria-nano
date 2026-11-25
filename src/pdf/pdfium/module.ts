// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Replaces liteparse crates/pdfium-sys (crates-v2.21.2, Apache-2.0): the emscripten module of LiteParse's pdfium.

import type { SystemFont } from "./system-fonts.js";

/**
 * Every pdfium C function takes and returns numbers on wasm32: handles and
 * pointers are heap offsets, `double` and `float` pass as JS numbers. The
 * names listed in scripts/pdfium/exports.txt are the ones the module exports.
 */
export type PdfiumFn = (...args: number[]) => number;

export type PdfiumModule = {
  [fn: `_FPDF${string}`]: PdfiumFn;
  [fn: `_FORM${string}`]: PdfiumFn;
  _malloc(size: number): number;
  /** Register a JavaScript function as a wasm function pointer (`signature` is emscripten's, `iii` and so on). */
  addFunction(fn: (...args: number[]) => number | void, signature: string): number;
  _free(ptr: number): void;
  /** The heap views are replaced when memory grows: read them off the module on every access. */
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  HEAPU16: Uint16Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
};

export type ModuleFactory = (options?: {
  wasmBinary?: ArrayBuffer | Uint8Array;
  locateFile?: (file: string) => string;
}) => Promise<PdfiumModule>;

export type LoadPdfiumOptions = {
  /** The pdfium.wasm bytes, when the runtime cannot fetch or read the file next to pdfium.mjs. */
  wasm?: ArrayBuffer | Uint8Array;
  /** Where pdfium.wasm is served (a browser behind a CDN or a bundler that moves it). */
  wasmUrl?: string | URL;
  /** Fonts pdfium may substitute for the standard-14 fonts (see system-fonts.ts). */
  fonts?: readonly SystemFont[];
  /** Finer control than `wasmUrl`: map each file the module asks for to a URL. */
  locateFile?: (file: string) => string;
};

/** The compiled binary embeds pdfium.wasm and points here, since it has no files beside it. */
const WASM_ENV = "PPU_OCRIA_NANO_PDFIUM_WASM";

// The published package keeps pdfium.mjs next to index.js; a checkout builds it into
// .pdfium-build/ (scripts/pdfium/build.sh).
const PACKAGE_MODULE = "../pdfium.mjs";
const CHECKOUT_MODULE = "../../../.pdfium-build/pdfium.mjs";

let registered: ModuleFactory | null = null;

/** Use `factory` as the pdfium module (a compiled binary bundles pdfium.mjs, which a runtime `import()` cannot find). */
export function registerPdfiumFactory(factory: ModuleFactory): void {
  registered = factory;
}

async function importFactory(): Promise<ModuleFactory> {
  if (registered !== null) return registered;
  let first: unknown;
  for (const path of [PACKAGE_MODULE, CHECKOUT_MODULE]) {
    try {
      const mod: { default: ModuleFactory } = await import(
        /* @vite-ignore */ new URL(path, import.meta.url).href
      );
      return mod.default;
    } catch (error) {
      first ??= error;
    }
  }
  throw new Error(
    "pdfium.mjs not found next to the package; run scripts/pdfium/build.sh in a checkout",
    { cause: first }
  );
}

/** The wasm bytes the environment names, when it names a file. */
async function wasmFromEnv(): Promise<Uint8Array | undefined> {
  const file = globalThis.process?.env?.[WASM_ENV];
  if (!file) return undefined;
  const { readFile } = await import("node:fs/promises");
  return new Uint8Array(await readFile(file));
}

/** Instantiate LiteParse's pdfium (WebAssembly). Instances are independent; reuse one per thread. */
export async function loadPdfiumModule(options: LoadPdfiumOptions = {}): Promise<PdfiumModule> {
  const factory = await importFactory();
  const { wasmUrl } = options;
  const locateFile =
    options.locateFile ??
    (wasmUrl === undefined
      ? undefined
      : (file: string): string => (file.endsWith(".wasm") ? String(wasmUrl) : file));
  return factory({ wasmBinary: options.wasm ?? (await wasmFromEnv()), locateFile });
}
