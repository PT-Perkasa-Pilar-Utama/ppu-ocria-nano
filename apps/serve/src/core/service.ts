import { existsSync } from "node:fs";
import { join } from "node:path";

import { MODEL_FILES, OcriaNanoService } from "ppu-ocria-nano";
import type { ModelFile, ModelSources } from "ppu-ocria-nano";
import { config } from "./config.js";
import { InferenceQueue } from "./queue.js";

/** Shared inference gate (one device, one budget). */
export const queue = new InferenceQueue(config.concurrency, config.maxQueueDepth);

// One warmed service, created on first use or at boot. Concurrent first
// requests share the same initialization.
let service: Promise<OcriaNanoService> | null = null;
let ready = false;

/**
 * The model files found in MODEL_DIR, or undefined to use the cached default
 * download. A file the folder lacks still downloads from the pinned release.
 */
function models(): ModelSources | undefined {
  const dir = config.modelDir;
  if (!dir) return undefined;
  const found = Object.entries(MODEL_FILES).flatMap(([role, pin]): [ModelFile, string][] =>
    existsSync(join(dir, pin.name))
      ? // SAFETY: Object.entries of MODEL_FILES yields its ModelFile keys.
        [[role as ModelFile, join(dir, pin.name)]]
      : []
  );
  return Object.fromEntries(found);
}

async function build(): Promise<OcriaNanoService> {
  const svc = new OcriaNanoService({
    session: { executionProviders: config.executionProviders },
    layout: config.layout,
    keepHeadersFooters: config.keepHeadersFooters,
    models: models(),
  });
  try {
    await svc.initialize();
  } catch (err) {
    // a failed warm-up is not kept, so the next request tries again
    service = null;
    throw err;
  }
  ready = true;
  return svc;
}

/** The warmed service; loads it on the first call. */
export function getService(): Promise<OcriaNanoService> {
  service ??= build();
  return service;
}

/** Warm the service. Call once at boot before serving. */
export async function initService(): Promise<void> {
  await getService();
}

/** Readiness: true once the models are loaded. */
export function isReady(): boolean {
  return ready;
}

/** Release the service. Call on shutdown. */
export async function shutdownService(): Promise<void> {
  ready = false;
  const pending = service;
  service = null;
  if (pending) await (await pending).destroy();
}
