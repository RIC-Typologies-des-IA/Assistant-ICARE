import { mkdir, copyFile, cp } from "node:fs/promises";

const vendor = new URL("../vendor/", import.meta.url);
await mkdir(vendor, { recursive: true });
const assets = [
  ["../node_modules/markdown-it/dist/markdown-it.min.js", "markdown-it.min.js"],
  ["../node_modules/dompurify/dist/purify.min.js", "purify.min.js"],
  ["../node_modules/@highlightjs/cdn-assets/highlight.min.js", "highlight.min.js"],
  ["../node_modules/mermaid/dist/mermaid.min.js", "mermaid.min.js"]
];
for (const [source, destination] of assets) {
  await copyFile(new URL(source, import.meta.url), new URL(destination, vendor));
}
const pdfjs = new URL("../node_modules/pdfjs-dist/build/", import.meta.url);
await copyFile(new URL("pdf.mjs", pdfjs), new URL("pdf.mjs", vendor));
await copyFile(new URL("pdf.worker.mjs", pdfjs), new URL("pdf.worker.mjs", vendor));
await cp(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url), new URL("standard_fonts/", vendor), { recursive: true });
await cp(new URL("../node_modules/pdfjs-dist/cmaps/", import.meta.url), new URL("cmaps/", vendor), { recursive: true });
await copyFile(new URL("../node_modules/tesseract.js/dist/tesseract.min.js", import.meta.url), new URL("tesseract.min.js", vendor));
await copyFile(new URL("../node_modules/tesseract.js/dist/worker.min.js", import.meta.url), new URL("tesseract-worker.min.js", vendor));
const coreSource = new URL("../node_modules/tesseract.js-core/", import.meta.url);
const coreTarget = new URL("tesseract-core/", vendor);
await mkdir(coreTarget, { recursive: true });
for (const name of ["tesseract-core.wasm.js", "tesseract-core-simd.wasm.js", "tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"]) {
  await copyFile(new URL(name, coreSource), new URL(name, coreTarget));
}
const frenchData = new URL("../node_modules/@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz", import.meta.url);
await mkdir(new URL("tessdata/", vendor), { recursive: true });
await copyFile(frenchData, new URL("tessdata/fra.traineddata.gz", vendor));
console.log("Built pinned local Markdown, Mermaid, PDF.js and French OCR assets.");
