import { mkdir, copyFile } from "node:fs/promises";

await mkdir(new URL("../vendor/", import.meta.url), { recursive: true });
await copyFile(
  new URL("../node_modules/markdown-it/dist/markdown-it.min.js", import.meta.url),
  new URL("../vendor/markdown-it.min.js", import.meta.url)
);
await copyFile(
  new URL("../node_modules/dompurify/dist/purify.min.js", import.meta.url),
  new URL("../vendor/purify.min.js", import.meta.url)
);
console.log("Built local Markdown-it and DOMPurify browser assets.");
