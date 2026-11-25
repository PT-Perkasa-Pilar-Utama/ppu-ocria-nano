/**
 * Convert a PDF: the text layer where it can be trusted, OCR elsewhere.
 * pdfium runs as a self-built WebAssembly module; nothing else to install.
 *
 *   bun examples/pdf.ts paper.pdf
 */

import { OcriaNanoService } from "../src";
import { convertPdf } from "../src/pdf";

const file = process.argv[2] ?? `${import.meta.dir}/../tests/fixtures/pages/digital.pdf`;
const service = new OcriaNanoService();
await service.initialize();

const pages = await convertPdf(service, await Bun.file(file).bytes(), { dpi: 250 });
for (const page of pages) {
  console.log(`--- page ${page.pageNumber}`);
  console.log(page.markdown);
}

await service.destroy();
