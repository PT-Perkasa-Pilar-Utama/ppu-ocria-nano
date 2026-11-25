/**
 * Read a page with ppu-ocria-nano: the whole pipeline in one call, then the
 * OCR stages on their own.
 *
 *   bun examples/index.ts [image]
 *
 * The first run downloads the models (about 36 MB with LayoutNet) and caches
 * them in ~/.cache/ppu-ocria-nano. Subsequent runs read from disk.
 */

import { OcriaNanoService, formatText } from "../src";

const file = process.argv[2] ?? `${import.meta.dir}/../tests/fixtures/pages/two-column.png`;
const image = await Bun.file(file).arrayBuffer();

const service = new OcriaNanoService();
await service.initialize();

// The whole pipeline: detect, recognize, merge, project, lay out, markdown.
const page = await service.convert(image);
console.log(page.markdown);
console.log(
  `\n${page.items.length} lines, ${page.blocks.length} blocks, ${page.width}x${page.height} pt at ${page.dpi} dpi`
);
console.log(formatText([page.parsed]).slice(0, 200));

// The OCR stage alone: text lines with confidence and pixel boxes.
const lines = await service.recognize(image);
for (const line of lines.slice(0, 3)) {
  console.log(`${line.confidence.toFixed(2)} [${line.bbox.join(", ")}] ${line.text}`);
}

// The detector alone: line quads, with no text read.
const { boxes, faint } = await service.detect(image);
console.log(`${boxes.length} line quads, ${faint.length} faint candidates`);

await service.destroy();
