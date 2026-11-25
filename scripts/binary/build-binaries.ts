// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Compiles the CLI into standalone executables with `bun build --compile`.
 *
 * Per target it (1) seeds the target's `@napi-rs/canvas` native binding into
 * `node_modules/@napi-rs/canvas/` so bun's bundler can embed it (the platform
 * packages are npm optional deps, so only the host's is installed), then
 * (2) generates a small entry that embeds onnxruntime's shared libraries and
 * preloads them (see `native-preload.ts`), then (3) compiles.
 *
 * Usage: bun scripts/binary/build-binaries.ts
 *   [--all | --target <key> ...]
 * Defaults to the host platform's target. Output lands in `.bin-build/`.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const OUT_DIR = join(ROOT, ".bin-build");

export type BinaryTarget = {
  /** Artifact key, e.g. `linux-x64` -> `ppu-ocria-nano-linux-x64`. */
  key: string;
  /** `--target` value for `bun build --compile`. */
  bunTarget: string;
  /** Subdir of `onnxruntime-node/bin/napi-v6/` holding this target's libs. */
  ortDir: string;
  /** Shared libraries to embed; the binding dlopens them by name. */
  ortLibs: string[];
  /** The library the binding links against directly; preloaded first. */
  ortMain: string;
  /** npm package carrying this target's `@napi-rs/canvas` binding. */
  skiaPkg: string;
  /** Binding file name, also the loader's local-file fallback name. */
  skiaNode: string;
  exeSuffix: string;
};

/** Platform keys the release builds cover. */
export type TargetKey = "darwin-arm64" | "linux-x64" | "linux-arm64" | "windows-x64";

// `satisfies` is the rule's preferred form, but isolatedDeclarations cannot
// infer an exported literal built from other bindings, so the annotation stays.
// oxlint-disable-next-line anti-slop/no-known-value-widening
export const TARGETS: Record<TargetKey, BinaryTarget> = {
  "darwin-arm64": {
    key: "darwin-arm64",
    bunTarget: "bun-darwin-arm64",
    ortDir: "darwin/arm64",
    ortLibs: ["libonnxruntime.1.dylib"],
    ortMain: "libonnxruntime.1.dylib",
    skiaPkg: "@napi-rs/canvas-darwin-arm64",
    skiaNode: "skia.darwin-arm64.node",
    exeSuffix: "",
  },
  "linux-x64": {
    key: "linux-x64",
    bunTarget: "bun-linux-x64",
    ortDir: "linux/x64",
    ortLibs: ["libonnxruntime.so.1"],
    ortMain: "libonnxruntime.so.1",
    skiaPkg: "@napi-rs/canvas-linux-x64-gnu",
    skiaNode: "skia.linux-x64-gnu.node",
    exeSuffix: "",
  },
  "linux-arm64": {
    key: "linux-arm64",
    bunTarget: "bun-linux-arm64",
    ortDir: "linux/arm64",
    ortLibs: ["libonnxruntime.so.1"],
    ortMain: "libonnxruntime.so.1",
    skiaPkg: "@napi-rs/canvas-linux-arm64-gnu",
    skiaNode: "skia.linux-arm64-gnu.node",
    exeSuffix: "",
  },
  // Only onnxruntime.dll, the binding's link target. The DirectML trio
  // (DirectML.dll, dxil.dll, dxcompiler.dll, ~38 MB) is delay-loaded solely
  // for the dml execution provider, which the CLI never requests (cpu
  // default). If a future provider option needs it, add the trio back here.
  "windows-x64": {
    key: "windows-x64",
    bunTarget: "bun-windows-x64",
    ortDir: "win32/x64",
    ortLibs: ["onnxruntime.dll"],
    ortMain: "onnxruntime.dll",
    skiaPkg: "@napi-rs/canvas-win32-x64-msvc",
    skiaNode: "skia.win32-x64-msvc.node",
    exeSuffix: ".exe",
  },
};

/** Target key for the machine this script runs on, or null if unsupported. */
export function currentTargetKey(): TargetKey | null {
  const key = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  return isTargetKey(key) ? key : null;
}

/** Narrows a platform-arch string to a key TARGETS actually carries. */
function isTargetKey(key: string): key is TargetKey {
  return key in TARGETS;
}

/**
 * Source of the generated per-target entry. Embeds the target's onnxruntime
 * shared libraries, preloads them, then hands off to the regular CLI entry.
 * Bun resolves `process.platform`/`process.arch` in dependencies against
 * `--target`, so the right `.node` bindings embed themselves.
 */
export function entrySource(
  target: BinaryTarget,
  ortVersion: string,
  pdfiumWasm: string | null = null
): string {
  const imports = target.ortLibs
    .map(
      (lib, i) =>
        `import lib${i} from "../node_modules/onnxruntime-node/bin/napi-v6/${target.ortDir}/${lib}" with { type: "file" };`
    )
    .join("\n");
  const fileMap = target.ortLibs.map((lib, i) => `"${lib}": lib${i}`).join(", ");
  // PDF input: the binary has no node_modules, so pdfium.wasm rides inside it, and pdfium.mjs
  // is bundled (a runtime import() cannot find a file next to a compiled binary).
  const pdfImport = pdfiumWasm
    ? `\nimport pdfiumWasmFile from "../${pdfiumWasm}" with { type: "file" };` +
      `\nimport createPdfium from "../${pdfiumWasm.replace(/\.wasm$/, ".mjs")}";` +
      `\nimport { registerPdfiumFactory } from "../src/pdf/pdfium/module.ts";`
    : "";
  const pdfEnv = pdfiumWasm
    ? "\nprocess.env.PPU_OCRIA_NANO_PDFIUM_WASM ||= pdfiumWasmFile;\nregisterPdfiumFactory(createPdfium);"
    : "";
  return `// Generated by scripts/binary/build-binaries.ts - do not edit.
${imports}${pdfImport}
import { preloadOnnxRuntime } from "../scripts/binary/native-preload.js";

await preloadOnnxRuntime({ ${fileMap} }, "${target.ortMain}", "${ortVersion}-${target.key}");${pdfEnv}
await import("../src/cli/index.js");
`;
}

function readPkgVersion(pkgDir: string): string {
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8")) as {
    version: string;
  };
  return pkg.version;
}

/**
 * Ensures `node_modules/@napi-rs/canvas/<skiaNode>` exists so the loader's
 * local-file fallback resolves at bundle time. Copies from the installed
 * platform package when present (the host's own), otherwise downloads the
 * version-matched platform package from the npm registry.
 */
async function seedSkiaBinding(target: BinaryTarget): Promise<void> {
  const canvasDir = join(ROOT, "node_modules", "@napi-rs", "canvas");

  // Exclusive seeding: bun embeds every statically resolvable `.node` in the
  // loader regardless of target, so a binding left behind by a previous
  // target's build would bloat this binary by ~30 MB per stale file.
  for (const stale of readdirSync(canvasDir)) {
    if (stale.startsWith("skia.") && stale.endsWith(".node") && stale !== target.skiaNode) {
      rmSync(join(canvasDir, stale));
    }
  }

  const dest = join(canvasDir, target.skiaNode);
  if (existsSync(dest)) return;

  const installed = join(ROOT, "node_modules", target.skiaPkg, target.skiaNode);
  if (existsSync(installed)) {
    await Bun.write(dest, Bun.file(installed));
    return;
  }

  const version = readPkgVersion(canvasDir);
  const bare = target.skiaPkg.replace("@napi-rs/", "");
  const url = `https://registry.npmjs.org/${target.skiaPkg}/-/${bare}-${version}.tgz`;
  console.log(`  fetching ${target.skiaPkg}@${version}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const tgz = join(OUT_DIR, "deps", `${bare}-${version}.tgz`);
  mkdirSync(join(OUT_DIR, "deps"), { recursive: true });
  await Bun.write(tgz, res);

  const extractDir = join(OUT_DIR, "deps", bare);
  mkdirSync(extractDir, { recursive: true });
  // Async spawn throughout: Bun.spawnSync busy-spins when stdout is a pipe
  // (non-TTY shells, some CI log collectors), pinning a core forever.
  const tar = Bun.spawn(["tar", "xzf", tgz, "-C", extractDir]);
  if ((await tar.exited) !== 0) throw new Error(`tar xzf ${tgz} failed`);
  await Bun.write(dest, Bun.file(join(extractDir, "package", target.skiaNode)));
}

/**
 * Temporarily hides the installed `@napi-rs/canvas-*` platform packages while
 * `fn` runs. The loader requires them by literal package name and bun embeds
 * every statically resolvable binding regardless of `--target`, so the host's
 * ~30 MB binding would ride along in every cross-compiled binary. With the
 * packages hidden, only the seeded local-file fallback resolves.
 */
async function withPlatformPackagesHidden<T>(fn: () => Promise<T>): Promise<T> {
  const napiDir = join(ROOT, "node_modules", "@napi-rs");
  const stash = join(OUT_DIR, "pkg-stash");
  mkdirSync(stash, { recursive: true });
  const hidden = readdirSync(napiDir).filter((d) => d.startsWith("canvas-"));
  for (const d of hidden) renameSync(join(napiDir, d), join(stash, d));
  try {
    return await fn();
  } finally {
    for (const d of hidden) renameSync(join(stash, d), join(napiDir, d));
  }
}

/**
 * Where scripts/pdfium/build.sh leaves the pdfium wasm (and pdfium.mjs beside it), relative to
 * the repository root. Until the file exists the binary is built without PDF input.
 */
const PDFIUM_WASM = ".pdfium-build/pdfium.wasm";

async function build(target: BinaryTarget, version: string, ortVersion: string): Promise<string> {
  await seedSkiaBinding(target);

  const entry = join(OUT_DIR, `entry-${target.key}.ts`);
  const pdfium = existsSync(join(ROOT, PDFIUM_WASM)) ? PDFIUM_WASM : null;
  if (!pdfium)
    console.warn(
      `  ${PDFIUM_WASM} not found (run scripts/pdfium/build.sh): this binary reads images only`
    );
  writeFileSync(entry, entrySource(target, ortVersion, pdfium));

  const outfile = join(OUT_DIR, `ppu-ocria-nano-${target.key}${target.exeSuffix}`);
  const compile = async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "build",
        "--compile",
        `--target=${target.bunTarget}`,
        "--define",
        `process.env.PPU_BINARY_VERSION="${version}"`,
        entry,
        "--outfile",
        outfile,
      ],
      { cwd: ROOT, stdout: "inherit", stderr: "inherit" }
    );
    return proc.exited;
  };
  const exitCode = await withPlatformPackagesHidden(compile);
  if (exitCode !== 0) throw new Error(`bun build --compile failed for ${target.key}`);
  return outfile;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let keys: string[];
  if (args.includes("--all")) {
    keys = Object.keys(TARGETS);
  } else if (args.includes("--target")) {
    keys = args.filter((a) => a in TARGETS);
    if (keys.length === 0) {
      console.error(`Usage: --target <${Object.keys(TARGETS).join(" | ")}>`);
      process.exit(2);
    }
  } else {
    const host = currentTargetKey();
    if (!host) {
      console.error(`Unsupported host ${process.platform}-${process.arch}; use --target.`);
      process.exit(2);
    }
    keys = [host];
  }

  mkdirSync(OUT_DIR, { recursive: true });

  // One process per target: each build mutates node_modules (seed, hide) and
  // spawns a compiler, and a fresh process per build keeps every iteration
  // starting from a clean runtime state.
  if (keys.length > 1) {
    for (const key of keys) {
      const child = Bun.spawn(["bun", import.meta.path, "--target", key], {
        stdout: "inherit",
        stderr: "inherit",
      });
      if ((await child.exited) !== 0) process.exit(1);
    }
    process.exit(0);
  }

  const version = readPkgVersion(ROOT);
  const ortVersion = readPkgVersion(join(ROOT, "node_modules", "onnxruntime-node"));
  const [target] = Object.values(TARGETS).filter((t) => keys.includes(t.key));
  if (!target) process.exit(2);

  console.log(`building ${target.key} (v${version}, ort ${ortVersion})`);
  const out = await build(target, version, ortVersion);
  console.log(`  -> ${out}`);
}
