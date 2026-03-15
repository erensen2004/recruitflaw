import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

const OCR_MAX_PAGES = 2;
const OCR_RENDER_SCALE = 1.25;

function isMeaningfulPdfText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }

  if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(normalized)) {
    return false;
  }

  const letters = normalized.match(/\p{L}/gu) ?? [];
  return letters.length >= 24;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to create OCR image blob"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

export async function extractPdfTextInBrowser(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createWorker } = await import("tesseract.js");

  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  try {
    const textChunks: string[] = [];

    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .trim();

      if (pageText) {
        textChunks.push(pageText);
      }
    }

    const textLayer = textChunks.join("\n\n").trim();
    if (isMeaningfulPdfText(textLayer)) {
      return textLayer;
    }

    const worker = await createWorker("eng", 1, {
      langPath: "/ocr",
      gzip: true,
    });

    try {
      const ocrChunks: string[] = [];
      const pageCount = Math.min(pdf.numPages, OCR_MAX_PAGES);

      for (let pageIndex = 1; pageIndex <= pageCount; pageIndex += 1) {
        const page = await pdf.getPage(pageIndex);
        const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);

        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Failed to create OCR canvas context");
        }

        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const blob = await canvasToBlob(canvas);
        const result = await worker.recognize(blob);
        const text = result.data.text.trim();
        if (text) {
          ocrChunks.push(text);
        }
      }

      const ocrText = ocrChunks.join("\n\n").trim();
      if (!isMeaningfulPdfText(ocrText)) {
        throw new Error("Scanned PDF OCR extracted no readable text");
      }

      return ocrText;
    } finally {
      await worker.terminate();
    }
  } finally {
    await pdf.destroy();
  }
}
