import type { OcriaNanoService, Page } from "ppu-ocria-nano";
import { HttpError } from "./errors.js";

/** The PDF entry's `convertPdf`, as this server calls it. */
export type ConvertPdf = (
  service: OcriaNanoService,
  bytes: ArrayBuffer,
  options: { dpi?: number; maxPages?: number; password?: string }
) => Promise<Page[]>;

const notAvailable = (why: string): HttpError =>
  new HttpError(501, "not_implemented", `PDF input is not available in this build: ${why}`);

function hasConvertPdf(mod: unknown): mod is { convertPdf: ConvertPdf } {
  return (
    typeof mod === "object" &&
    mod !== null &&
    "convertPdf" in mod &&
    typeof mod.convertPdf === "function"
  );
}

/**
 * `convertPdf` from `ppu-ocria-nano/pdf`, loaded on the first PDF so an image-only
 * deployment never loads pdfium. A 501 when the entry is missing or lacks the export.
 */
export async function requirePdf(): Promise<ConvertPdf> {
  let mod: unknown;
  try {
    mod = await import("ppu-ocria-nano/pdf");
  } catch (err) {
    throw notAvailable(err instanceof Error ? err.message : String(err));
  }
  if (!hasConvertPdf(mod)) throw notAvailable("ppu-ocria-nano/pdf has no convertPdf export");
  return mod.convertPdf;
}
