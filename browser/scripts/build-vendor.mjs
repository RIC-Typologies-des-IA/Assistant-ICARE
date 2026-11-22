import { mkdir, copyFile } from "node:fs/promises";

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
console.log("Built pinned local Markdown, DOMPurify, Highlight.js and Mermaid assets.");
