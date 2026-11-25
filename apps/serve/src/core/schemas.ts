import * as v from "valibot";

const positiveInt = v.pipe(v.number(), v.integer(), v.minValue(1));

/** Per-request options shared by every input shape. `maxPages` applies to PDFs. */
export const ocrOptionsSchema = v.object({
  maxPages: v.optional(positiveInt),
});
export type OcrOptions = v.InferOutput<typeof ocrOptionsSchema>;

// Multipart fields arrive as strings; coerce them to the JSON option types.
const formNumber = v.pipe(v.string(), v.transform(Number), v.number());

/** The same options read from multipart form fields. */
export const multipartOcrOptionsSchema = v.object({
  maxPages: v.optional(v.pipe(formNumber, v.integer(), v.minValue(1))),
});

// A 1x1 PNG as a data: URI - a valid, runnable example so Scalar's "Send"
// works out of the box (it decodes, finds no text, returns an empty result).
const EXAMPLE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const source = v.pipe(
  v.string(),
  v.minLength(1),
  v.description(
    "An image or PDF as a `data:` URI or an allowlisted https URL. Local paths are rejected."
  ),
  v.metadata({ example: EXAMPLE_IMAGE })
);

/** JSON body for single-image OCR. */
export const jsonOcrSchema = v.pipe(
  v.object({ ...ocrOptionsSchema.entries, source }),
  v.metadata({ ref: "OcrJsonRequest" })
);

/** JSON body for detection-only inference. */
export const jsonDetectSchema = v.pipe(
  v.object({ source }),
  v.metadata({ ref: "DetectJsonRequest" })
);

/** JSON body for batch / async / stream OCR. */
export const batchOcrSchema = v.pipe(
  v.object({
    ...ocrOptionsSchema.entries,
    sources: v.pipe(
      v.array(v.pipe(v.string(), v.minLength(1))),
      v.minLength(1),
      v.description("data: URIs or https URLs.")
    ),
    concurrency: v.optional(positiveInt),
    settle: v.optional(v.boolean()),
  }),
  v.metadata({
    ref: "BatchRequest",
    example: { sources: [EXAMPLE_IMAGE], settle: true },
  })
);
export type BatchOcrBody = v.InferOutput<typeof batchOcrSchema>;

export const taskIdParamsSchema = v.object({
  id: v.pipe(v.string(), v.metadata({ example: crypto.randomUUID() })),
});

// --- Multipart bodies (documentation only - parsed manually) ---
// Plain OpenAPI objects: the file field has no schema-library shape, and these
// bodies never pass through a validator.

const multipartOptions = {
  maxPages: { type: "integer" as const, minimum: 1 },
};
const binaryFile = { type: "string" as const, format: "binary" };

/** Multipart body for single-image OCR. */
export const multipartOcrSchema = {
  type: "object" as const,
  properties: { file: binaryFile, ...multipartOptions },
  required: ["file"],
};

/** Multipart body for detection-only inference. */
export const multipartDetectSchema = {
  type: "object" as const,
  properties: { file: binaryFile },
  required: ["file"],
};

// --- Response schemas ---

const box = v.object({ x: v.number(), y: v.number(), width: v.number(), height: v.number() });
const itemSchema = v.object({
  ...box.entries,
  text: v.string(),
  rotation: v.number(),
  confidence: v.nullable(v.number()),
  fontName: v.nullable(v.string()),
  fontSize: v.nullable(v.number()),
});
const cellSchema = v.object({
  text: v.string(),
  bbox: v.nullable(box),
  colspan: v.nullable(v.number()),
  rowspan: v.nullable(v.number()),
  itemIndices: v.array(v.number()),
});
const blockSchema = v.object({
  kind: v.string(),
  text: v.nullable(v.string()),
  level: v.nullable(v.number()),
  bold: v.boolean(),
  italic: v.boolean(),
  ordered: v.nullable(v.boolean()),
  marker: v.nullable(v.string()),
  lines: v.nullable(v.array(v.string())),
  lang: v.nullable(v.string()),
  header: v.nullable(v.array(cellSchema)),
  rows: v.nullable(v.array(v.array(cellSchema))),
  headerRows: v.nullable(v.number()),
  bbox: v.nullable(box),
  itemIndices: v.array(v.number()),
});
/** A page as the API returns it: `Page` without the `parsed` stage value. */
const pageSchema = v.object({
  pageNumber: v.number(),
  width: v.number(),
  height: v.number(),
  dpi: v.nullable(v.number()),
  markdown: v.string(),
  text: v.string(),
  items: v.array(itemSchema),
  blocks: v.array(blockSchema),
});
export const ocrResultSchema = v.pipe(
  v.object({ pages: v.array(pageSchema) }),
  v.metadata({ ref: "OcrResult" })
);

const point = v.tuple([v.number(), v.number()]);
const quad = v.tuple([point, point, point, point]);
export const detectResultSchema = v.pipe(
  v.object({ boxes: v.array(quad), faint: v.array(quad) }),
  v.metadata({ ref: "DetectResult" })
);

export const batchResultSchema = v.pipe(
  v.object({ results: v.array(v.unknown()) }),
  v.metadata({ ref: "BatchResult" })
);

export const taskAcceptedSchema = v.pipe(
  v.object({ taskId: v.string(), status: v.string() }),
  v.metadata({ ref: "TaskAccepted" })
);

export const taskStatusSchema = v.pipe(
  v.object({
    id: v.string(),
    status: v.picklist(["queued", "running", "done", "failed", "cancelled"]),
    updatedAt: v.number(),
  }),
  v.metadata({ ref: "TaskStatus" })
);

export const modelsSchema = v.pipe(
  v.object({
    version: v.string(),
    revision: v.string(),
    files: v.array(
      v.object({ role: v.string(), name: v.string(), size: v.number(), sha256: v.string() })
    ),
    layout: v.boolean(),
    keepHeadersFooters: v.boolean(),
    executionProviders: v.array(v.string()),
  }),
  v.metadata({ ref: "Models" })
);
