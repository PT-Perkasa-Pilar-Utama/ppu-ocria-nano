import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path/posix";

import tsconfig from "../tsconfig.json";

// Constants
const ROOTDIR = resolve(import.meta.dir, "..");
const SOURCEDIR = `${ROOTDIR}/src`;
const OUTDIR = join(ROOTDIR, tsconfig.compilerOptions.declarationDir);

// Remove old content
if (existsSync(OUTDIR)) rmSync(OUTDIR, { recursive: true });

// Emit all .d.ts in one native tsc pass (tsconfig.build.json scopes it to
// src/ rooted at lib/). typescript 7 dropped the transpileDeclaration JS API
// this script previously used, but its Go tsc emits identical output.
const tsc = Bun.spawnSync(["bunx", "tsc", "-p", join(ROOTDIR, "tsconfig.build.json")], {
  cwd: ROOTDIR,
  stdout: "inherit",
  stderr: "inherit",
});
if (tsc.exitCode !== 0) process.exit(tsc.exitCode ?? 1);

// Transpile files concurrently
const transpiler = new Bun.Transpiler({
  loader: "ts",
  target: "node",

  // Lighter output
  minifyWhitespace: true,
  treeShaking: true,
});

for (const path of new Bun.Glob("**/*.ts").scanSync(SOURCEDIR)) {
  const srcPath = `${SOURCEDIR}/${path}`;

  const pathExtStart = path.lastIndexOf(".");
  const outPathNoExt = `${OUTDIR}/${path.substring(0, pathExtStart >>> 0)}`;

  const buf = await Bun.file(srcPath).text();
  const res = transpiler.transformSync(buf);
  if (res.length !== 0) {
    let js = res.replace(/const /g, "let ");

    // Preserve a leading shebang the transpiler strips, then mark the bin
    // executable so `npx`/`bunx ppu-ocria-nano` can run it directly.
    const shebang = buf.startsWith("#!") ? buf.slice(0, buf.indexOf("\n")) : null;
    if (shebang && !js.startsWith("#!")) js = `${shebang}\n${js}`;

    const outFile = `${outPathNoExt}.js`;
    await Bun.write(outFile, js);
    if (shebang) chmodSync(outFile, 0o755);
  } else {
    // A types-only module transpiles to nothing, but `export * from "./types.js"` elsewhere still
    // imports it at run time: leave an empty module behind.
    await Bun.write(`${outPathNoExt}.js`, "export {};\n");
  }
}

// pdfium for `ppu-ocria-nano/pdf`: the module, its wasm and the licenses of pdfium and the
// libraries it links, next to pdf/index.js (scripts/pdfium/build.sh makes them).
const PDFIUM_BUILD = `${ROOTDIR}/.pdfium-build`;
if (existsSync(`${PDFIUM_BUILD}/pdfium.wasm`)) {
  mkdirSync(`${OUTDIR}/pdf`, { recursive: true });
  for (const file of ["pdfium.mjs", "pdfium.wasm", "VERSION"]) {
    cpSync(
      `${PDFIUM_BUILD}/${file}`,
      `${OUTDIR}/pdf/${file === "VERSION" ? "pdfium.VERSION" : file}`
    );
  }
  cpSync(`${PDFIUM_BUILD}/licenses`, `${OUTDIR}/pdf/licenses`, { recursive: true });
} else {
  console.warn("pdfium not built (run scripts/pdfium/build.sh): the package will not read PDFs.");
}
