import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { getPlatform, setPlatform } from "ppu-ocv";

import { MODEL_FILES } from "../src/model-catalogue.js";
import type { ModelFile } from "../src/model-catalogue.js";
import { defaultModelUrl } from "../src/model-catalogue.js";
import { cachePathFor } from "../src/processor/model-cache.js";
import { loadParseGolden } from "./ocria/parse-golden.js";
import { installWebCanvas, uninstallWebCanvas } from "./web-canvas-polyfill.js";

/**
 * Unit tests for the web support module structure.
 * These tests verify that the web entry point exports are correctly wired up
 * and that the web services can be imported without pulling in Node-specific deps.
 */

// Importing the web entry (below, dynamically) calls ppu-ocv's process-global
// setPlatform(webPlatform). Save the platform before this file's tests and
// restore it after, so node test files that run later in the same `bun test`
// process aren't left on the web path (createImageBitmap is not defined).
let savedPlatform: ReturnType<typeof getPlatform>;
beforeAll(() => {
  savedPlatform = getPlatform();
});
afterAll(() => {
  setPlatform(savedPlatform);
});

describe("Web entry", () => {
  test("exports OcriaNanoService, the one-shots and the shared helpers", async () => {
    const mod = await import("../src/web/index.js");
    expect(typeof mod.OcriaNanoService).toBe("function");
    expect(typeof mod.ocr).toBe("function");
    expect(typeof mod.detect).toBe("function");
    expect(typeof mod.toPage).toBe("function");
    expect(typeof mod.formatText).toBe("function");
    expect(mod.MODEL_REVISION).toBe("11f092be242844361666e8bac97da168b0f4a299");
  });

  test("a new service is not initialized; destroy() is safe before initialize()", async () => {
    const { OcriaNanoService } = await import("../src/web/index.js");
    const service = new OcriaNanoService();
    expect(service.isInitialized()).toBe(false);
    await service.destroy();
    await expect(service.convert(new ArrayBuffer(8))).rejects.toThrow("initialize()");
  });

  test("the browser platform tells canvases from other values", async () => {
    const { WebPlatformProvider } = await import("../src/web/platform.web.js");
    const platform = new WebPlatformProvider();
    expect(platform.isCanvas({ getContext: () => null })).toBe(true);
    expect(platform.isCanvas({ width: 2, height: 2 })).toBe(false);
    expect(platform.isCanvas(null)).toBe(false);
  });
});

/** Source text of value imports (not `import type`) from the modules a browser build cannot have. */
const NODE_ONLY_IMPORT =
  /^import (?!type )[^;]*?from "(fs|fs\/promises|path|os|node:[^"]+|onnxruntime-node|@napi-rs\/canvas)";/m;
const PLATFORM_IMPORT =
  /^import (?!type )[^;]*?from "(fs|path|os|node:[^"]+|onnxruntime-(node|web|react-native)|ppu-ocv[^"]*)";/m;

describe("Web code does not import Node-only modules", () => {
  const files = [
    "./src/web/index.ts",
    "./src/web/platform.web.ts",
    "./src/web/ocria-nano.service.web.ts",
    "./src/core/ocria-nano.service.ts",
    "./src/core/model-loader.ts",
    "./src/core/page.ts",
    "./src/exports.ts",
    "./src/model-catalogue.ts",
    "./src/utils.ts",
  ];

  test.each(files)("%s", async (file) => {
    expect(await Bun.file(file).text()).not.toMatch(NODE_ONLY_IMPORT);
  });

  test("the pipeline in src/ocria imports nothing platform-specific", async () => {
    let checked = 0;
    for (const file of new Bun.Glob("src/ocria/**/*.ts").scanSync(".")) {
      expect(await Bun.file(file).text()).not.toMatch(PLATFORM_IMPORT);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });
});

/** Every model file as bytes from the warmed disk cache: a browser cannot read file paths. */
function cachedModelBytes(): Partial<Record<ModelFile, ArrayBuffer>> {
  // SAFETY: Object.keys of a Record<ModelFile, _> lists exactly its ModelFile keys.
  const roles = Object.keys(MODEL_FILES) as ModelFile[];
  return Object.fromEntries(
    roles.map((role) => {
      const b = readFileSync(cachePathFor(defaultModelUrl(role)));
      return [role, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)];
    })
  );
}

describe("Web OcriaNanoService reads a page", () => {
  test("onnxruntime-web and the canvas polyfill give LiteParse's markdown", async () => {
    installWebCanvas();
    try {
      const { OcriaNanoService } = await import("../src/web/index.js");
      const service = new OcriaNanoService({ models: cachedModelBytes() });
      await service.initialize();
      try {
        const png = readFileSync("tests/fixtures/pages/table.png");
        const page = await service.convert(
          png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
        );
        expect(page.dpi).toBe(150);
        expect(page.markdown).toBe(loadParseGolden("table").text);
      } finally {
        await service.destroy();
      }
    } finally {
      uninstallWebCanvas();
    }
  }, 120000);
});

describe("WebGPU execution-provider detection", () => {
  test("isWebGpuAvailable is exported", async () => {
    const mod = await import("../src/web/index.js");
    expect(mod.isWebGpuAvailable).toBeDefined();
    expect(typeof mod.isWebGpuAvailable).toBe("function");
  });

  test("getDefaultWebExecutionProviders is exported", async () => {
    const mod = await import("../src/web/index.js");
    expect(mod.getDefaultWebExecutionProviders).toBeDefined();
    expect(typeof mod.getDefaultWebExecutionProviders).toBe("function");
  });

  test("isWebGpuAvailable returns false in Node/Bun (no navigator.gpu)", async () => {
    const { isWebGpuAvailable } = await import("../src/web/index.js");
    const result = await isWebGpuAvailable();
    expect(result).toBe(false);
  });

  test("getDefaultWebExecutionProviders falls back to ['wasm'] in Node/Bun", async () => {
    const { getDefaultWebExecutionProviders } = await import("../src/web/index.js");
    const providers = await getDefaultWebExecutionProviders();
    expect(providers).toEqual(["wasm"]);
  });

  test("isWebGpuAvailable detects WebGPU when navigator.gpu is present", async () => {
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    const mockAdapter = { features: new Set() };
    (globalThis as { navigator?: unknown }).navigator = {
      gpu: {
        requestAdapter: async () => mockAdapter,
      },
    };

    try {
      const { isWebGpuAvailable } = await import("../src/web/index.js");
      const result = await isWebGpuAvailable();
      expect(result).toBe(true);
    } finally {
      if (originalNavigator === undefined) {
        delete (globalThis as { navigator?: unknown }).navigator;
      } else {
        (globalThis as { navigator?: unknown }).navigator = originalNavigator;
      }
    }
  });

  test("isWebGpuAvailable returns false when requestAdapter rejects", async () => {
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    (globalThis as { navigator?: unknown }).navigator = {
      gpu: {
        requestAdapter: async () => {
          throw new Error("nope");
        },
      },
    };

    try {
      const { isWebGpuAvailable } = await import("../src/web/index.js");
      const result = await isWebGpuAvailable();
      expect(result).toBe(false);
    } finally {
      if (originalNavigator === undefined) {
        delete (globalThis as { navigator?: unknown }).navigator;
      } else {
        (globalThis as { navigator?: unknown }).navigator = originalNavigator;
      }
    }
  });

  test("isWebGpuAvailable returns false when requestAdapter returns null (e.g., no hardware)", async () => {
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    (globalThis as { navigator?: unknown }).navigator = {
      gpu: {
        requestAdapter: async () => null,
      },
    };

    try {
      const { isWebGpuAvailable } = await import("../src/web/index.js");
      const result = await isWebGpuAvailable();
      expect(result).toBe(false);
    } finally {
      if (originalNavigator === undefined) {
        delete (globalThis as { navigator?: unknown }).navigator;
      } else {
        (globalThis as { navigator?: unknown }).navigator = originalNavigator;
      }
    }
  });

  test("getDefaultWebExecutionProviders prefers WebGPU first when available", async () => {
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    (globalThis as { navigator?: unknown }).navigator = {
      gpu: {
        requestAdapter: async () => ({ features: new Set() }),
      },
    };

    try {
      const { getDefaultWebExecutionProviders } = await import("../src/web/index.js");
      const providers = await getDefaultWebExecutionProviders();
      expect(providers).toEqual(["webgpu", "wasm"]);
    } finally {
      if (originalNavigator === undefined) {
        delete (globalThis as { navigator?: unknown }).navigator;
      } else {
        (globalThis as { navigator?: unknown }).navigator = originalNavigator;
      }
    }
  });
});
