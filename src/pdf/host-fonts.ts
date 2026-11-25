// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// A native pdfium substitutes the host's Arial, Times New Roman and Courier New
// for the standard-14 fonts a PDF names without embedding, so LiteParse's
// boxes depend on those fonts. On a server runtime the wasm build reads the
// same files, so it lays pages out as LiteParse does on that host. Browsers
// have no font files to read: pass `fonts` yourself, or get pdfium's built-in
// fonts (boxes within about 0.6 pt).
// ponytail: the three families only, from the folders below; port pdfium's
// own folder scan if a host's substitutes prove to differ from these.

import type { SystemFont } from "./pdfium/system-fonts.js";

const FAMILIES = ["Arial", "Times New Roman", "Courier New"] as const;
const STYLES = ["", " Bold", " Italic", " Bold Italic"] as const;

/** Windows file names, by family and style (in STYLES order). */
const WINDOWS_FILES: Readonly<Record<(typeof FAMILIES)[number], readonly string[]>> = {
  Arial: ["arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"],
  "Times New Roman": ["times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"],
  "Courier New": ["cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf"],
};

type NodeFs = { existsSync: (p: string) => boolean; readFileSync: (p: string) => Uint8Array };

function isServerRuntime(): boolean {
  return typeof globalThis.process?.versions?.node === "string";
}

/** The candidate paths of one face on this host, most likely first. */
function candidates(family: (typeof FAMILIES)[number], style: number, platform: string): string[] {
  const name = `${family}${STYLES[style]}`;
  if (platform === "darwin") {
    return [`/System/Library/Fonts/Supplemental/${name}.ttf`, `/Library/Fonts/${name}.ttf`];
  }
  if (platform === "win32") {
    const dir = globalThis.process?.env?.WINDIR ?? "C:\\Windows";
    return [`${dir}\\Fonts\\${WINDOWS_FILES[family][style]}`];
  }
  return [`/usr/share/fonts/truetype/msttcorefonts/${name.replaceAll(" ", "_")}.ttf`];
}

/**
 * The standard-14 substitutes installed on this host (Node, Bun, Deno), as
 * `convertPdf` passes them to pdfium by default. Empty in a browser, or when
 * none is installed.
 */
export function hostFonts(): Promise<SystemFont[]> {
  // read once per process: twelve TrueType files, needed on every convertPdf call
  found ??= readHostFonts();
  return found;
}

let found: Promise<SystemFont[]> | undefined;

async function readHostFonts(): Promise<SystemFont[]> {
  if (!isServerRuntime()) return [];
  const fs: NodeFs = await import("node:fs");
  const platform = globalThis.process?.platform ?? "";
  const out: SystemFont[] = [];
  for (const family of FAMILIES) {
    STYLES.forEach((style, i) => {
      const path = candidates(family, i, platform).find((p) => fs.existsSync(p));
      if (path)
        out.push({ name: `${family}${style}`, data: new Uint8Array(fs.readFileSync(path)) });
    });
  }
  return out;
}
