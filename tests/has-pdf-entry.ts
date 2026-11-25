// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Whether `src/pdf/index.ts` imports and exports `convertPdf`. The PDF entry
 * lands apart from the rest of the library: tests that read a PDF use
 * `test.skipIf(!pdfReady)` and run once it does.
 */
export const pdfReady: boolean = await import("../src/pdf/index.js").then(
  (mod: Record<string, unknown>) => typeof mod.convertPdf === "function",
  () => false
);
