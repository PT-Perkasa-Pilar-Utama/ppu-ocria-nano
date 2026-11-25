// Assembles playground/dist/ for Cloudflare (Workers static assets): index.html,
// the _headers file that sets COOP/COEP (cross-origin isolation -> multithreaded
// WASM, no service worker), and the library's compiled browser dependency tree. Everything else
// (onnxruntime-web, ppu-ocv, bidi-js, models) loads from CDNs via the import map.
//
// Run `bun task build` first so ../lib exists. If it's missing the demo
// still works via its jsdelivr fallback import, just with one 404 + warning.
import { cp, mkdir, rm, stat } from "node:fs/promises";

import { SAMPLES } from "./samples.js";

const here = import.meta.dir; // playground/
const repo = `${here}/..`;
const dist = `${here}/dist`;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const files = ["index.html", "_headers"];
for (const f of files) await cp(`${here}/${f}`, `${dist}/${f}`);

// The sample chips fetch ./samples/<name>, so the demo does not depend on a public repo.
await mkdir(`${dist}/samples`, { recursive: true });
for (const [name, source] of Object.entries(SAMPLES)) {
  await cp(`${repo}/${source}`, `${dist}/samples/${name}`);
}

// `ppu-ocria-nano/pdf` loads pdfium.mjs and pdfium.wasm from lib/pdf/, which `bun task build`
// copies there from scripts/pdfium/build.sh's output; the cp below carries them along.
const lib = `${repo}/lib`;
const shipped: string[] = [...files, "samples/"];
try {
  await stat(`${lib}/web/index.js`);
  // lib/web imports shared modules from ../core, ../constants, and other sibling
  // paths, so copying only lib/web leaves broken ESM imports in production.
  await cp(lib, `${dist}/lib`, { recursive: true });
  shipped.push("lib/");
  await stat(`${lib}/pdf/pdfium.wasm`).catch(() => {
    console.warn(
      "lib/pdf/pdfium.wasm not found - run scripts/pdfium/build.sh, then `bun task build`. The demo cannot read PDFs."
    );
  });
} catch {
  console.warn(
    "lib/web/index.js not found - run `bun task build` first. The demo will fall back to the jsdelivr CDN import."
  );
}

console.log("Assembled playground/dist/ for Cloudflare:", shipped.join(", "));
