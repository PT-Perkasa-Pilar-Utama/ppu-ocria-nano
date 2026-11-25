import type { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { errorResponse, jsonResponse, success } from "../../core/api-response.js";
import { readSingle } from "../../core/input.js";
import { runDetect } from "../../core/runner.js";
import { detectResultSchema, jsonDetectSchema } from "../../core/schemas.js";
import type { Env } from "../../core/types.js";

// Like /v1/ocr, this endpoint accepts BOTH multipart and JSON, so it is
// documented here and parses its body manually.
export function mount(app: Hono<Env>): void {
  app.post(
    "/v1/detect",
    describeRoute({
      tags: ["OCR"],
      summary: "Detect text lines in a single image (no recognition)",
      description:
        "Runs only the line detector and returns each line as a quad of four points " +
        "(top-left, top-right, bottom-right, bottom-left) in image pixels, plus the faint " +
        "short-token candidates. multipart/form-data with a `file` field, or JSON `{ source }`.",
      security: [{ Bearer: [] }],
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: { $ref: "#/components/schemas/DetectMultipartRequest" },
          },
          "application/json": { schema: resolver(jsonDetectSchema) },
        },
      },
      responses: {
        200: jsonResponse(
          "Detected lines. `metadata` carries `speed` (seconds) and `count`.",
          detectResultSchema
        ),
        400: errorResponse("Invalid input, unsupported image type, or source error."),
        413: errorResponse("Image exceeds MAX_UPLOAD_BYTES."),
        429: errorResponse("Rate limit or inference queue full."),
      },
    }),
    async (c) => {
      const { image } = await readSingle(c);
      const { result, meta } = await runDetect(image);
      return c.json(success(c, result, { speed: meta.ms / 1000, count: result.boxes.length }));
    }
  );
}
