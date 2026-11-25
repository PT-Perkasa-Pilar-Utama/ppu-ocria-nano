/**
 * Whether `ppu-ocria-nano/pdf` exports `convertPdf`. The PDF entry lands apart
 * from the rest of the library; tests that read a PDF skip until it does, and
 * the 501 test runs until then.
 */
export const pdfReady: boolean = await import("ppu-ocria-nano/pdf").then(
  (mod: Record<string, unknown>) => typeof mod.convertPdf === "function",
  () => false
);
