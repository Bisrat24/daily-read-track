// Client-only PDF + EPUB text extractors. All heavy libs are dynamically
// imported so they never run during SSR.

export type ParsedBook = {
  title: string;
  words: string[];
};

const WORD_RE = /\S+/g;

function toWords(text: string): string[] {
  return (text.match(WORD_RE) ?? []).filter(Boolean);
}

export async function parsePdf(file: File): Promise<ParsedBook> {
  const pdfjs = await import("pdfjs-dist");
  // Use the bundled worker as a URL.
  // @ts-expect-error - vite ?url import
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .join(" ");
    parts.push(text);
  }
  const title = file.name.replace(/\.pdf$/i, "");
  return { title, words: toWords(parts.join("\n\n")) };
}

export async function parseEpub(file: File): Promise<ParsedBook> {
  const ePubMod: any = await import("epubjs");
  const ePub = ePubMod.default ?? ePubMod;
  const buf = await file.arrayBuffer();
  const book = ePub(buf);
  await book.ready;
  const spine: any = book.spine;
  const items: any[] = spine?.spineItems ?? [];
  const parts: string[] = [];
  for (const item of items) {
    try {
      const doc = await item.load(book.load.bind(book));
      const text = (doc?.body?.innerText ?? doc?.documentElement?.textContent ?? "") as string;
      if (text) parts.push(text);
      item.unload();
    } catch {
      /* skip broken section */
    }
  }
  let title = file.name.replace(/\.epub$/i, "");
  try {
    const meta = await book.loaded.metadata;
    if (meta?.title) title = meta.title;
  } catch {}
  return { title, words: toWords(parts.join("\n\n")) };
}

export async function parseFile(file: File): Promise<ParsedBook> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return parsePdf(file);
  if (name.endsWith(".epub")) return parseEpub(file);
  throw new Error("Unsupported file type. Please upload a PDF or EPUB.");
}
