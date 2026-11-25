import type { Hono } from "hono";
import { MODEL_FILES, MODEL_REVISION, MODEL_VERSION } from "ppu-ocria-nano";
import type { ModelFile } from "ppu-ocria-nano";
import { describeRoute } from "hono-openapi";
import { jsonResponse, success } from "../../core/api-response.js";
import { config } from "../../core/config.js";
import { modelsSchema } from "../../core/schemas.js";
import type { Env } from "../../core/types.js";

export function mount(app: Hono<Env>): void {
  app.get(
    "/v1/models",
    describeRoute({
      tags: ["System"],
      summary: "The pinned OCRia-nano-1 files and the server settings",
      security: [{ Bearer: [] }],
      responses: { 200: jsonResponse("ok", modelsSchema) },
    }),
    (c) =>
      c.json(
        success(c, {
          version: MODEL_VERSION,
          revision: MODEL_REVISION,
          // SAFETY: the keys of MODEL_FILES are its ModelFile roles.
          files: (Object.keys(MODEL_FILES) as ModelFile[]).map((role) => ({
            role,
            ...MODEL_FILES[role],
          })),
          layout: config.layout,
          keepHeadersFooters: config.keepHeadersFooters,
          executionProviders: config.executionProviders,
        }),
        200
      )
  );
}
