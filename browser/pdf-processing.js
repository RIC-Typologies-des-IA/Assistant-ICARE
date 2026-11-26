import * as pdfjsLib from "./vendor/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.mjs", import.meta.url).href;
const OCR_LANG = "fra";
const MIN_NATIVE_TEXT = 35;
const OCR_SCALE = 1.65;

function normalisePageText(items) {
  return items.map(item => item?.str || "").filter(Boolean).join(" ").replace(/[ \t]+/g, " ").trim();
}

export async function extractPdfText(buffer, { onProgress = () => {}, ocr = true, createOcrWorker = null } = {}) {
  const loadingTask = pdfjsLib.getDocument({ data: buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false });
  let pdf;
  let worker;
  const pages = [];
  let ocrPages = 0;
  try {
    pdf = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      let text = normalisePageText(textContent.items || []);
      if (text.length < MIN_NATIVE_TEXT && ocr) {
        if (!worker) {
          const factory = createOcrWorker || (async () => {
            if (!globalThis.Tesseract?.createWorker) throw new Error("Le moteur OCR n’est pas chargé. Rechargez l’application ou vérifiez les ressources locales.");
            return globalThis.Tesseract.createWorker(OCR_LANG, 1, {
              workerPath: new URL("./vendor/tesseract-worker.min.js", import.meta.url).href,
              corePath: new URL("./vendor/tesseract-core/", import.meta.url).href,
              langPath: new URL("./vendor/tessdata/", import.meta.url).href,
              workerBlobURL: false,
              gzip: true,
              logger: message => { if (message.status === "recognizing text") onProgress({ page: pageNumber, total: pdf.numPages, progress: message.progress || 0, stage: "ocr" }); }
            });
          });
          worker = await factory();
        }
        const viewport = page.getViewport({ scale: OCR_SCALE });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Impossible de créer le canevas nécessaire à l’OCR.");
        await page.render({ canvasContext: context, viewport }).promise;
        const result = await worker.recognize(canvas);
        const recognised = String(result?.data?.text || "").trim();
        if (recognised) { text = recognised; ocrPages++; }
        canvas.width = 0; canvas.height = 0;
      }
      pages.push({ page: pageNumber, text, source: text.length >= MIN_NATIVE_TEXT && normalisePageText(textContent.items || []).length >= MIN_NATIVE_TEXT ? "native" : (text ? "ocr" : "empty") });
      onProgress({ page: pageNumber, total: pdf.numPages, progress: 1, stage: "page" });
      page.cleanup();
    }
    const content = pages.map(item => item.text).filter(Boolean).join("\n\n");
    if (!content.trim()) throw new Error("Aucun texte n’a pu être extrait. Le PDF est peut-être protégé, vide ou composé d’images non reconnaissables.");
    return { content, pages, pageCount: pdf.numPages, ocrPages, source: ocrPages ? "native+ocr" : "native" };
  } finally {
    if (worker) await worker.terminate().catch(() => {});
    if (pdf) await pdf.destroy().catch(() => {});
    else await loadingTask.destroy().catch(() => {});
  }
}
