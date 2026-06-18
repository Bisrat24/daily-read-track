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
  const pdfjs: any = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url" as any)).default;
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
  const buf = await file.arrayBuffer();

  // Primary path: parse the EPUB zip directly so we don't depend on
  // epub.js's section loader (which is fragile in some browsers / on mobile).
  try {
    const JSZipMod: any = await import("jszip");
    const JSZip = JSZipMod.default ?? JSZipMod;
    const zip = await JSZip.loadAsync(buf);

    // Find container.xml -> rootfile (the OPF)
    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) throw new Error("Missing container.xml");
    const containerXml = await containerFile.async("string");
    const rootMatch = containerXml.match(/full-path="([^"]+)"/);
    if (!rootMatch) throw new Error("Missing rootfile path");
    const opfPath = rootMatch[1];
    const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

    const opfFile = zip.file(opfPath);
    if (!opfFile) throw new Error("Missing OPF");
    const opfXml = await opfFile.async("string");

    // manifest: id -> href
    const manifest = new Map<string, string>();
    for (const m of opfXml.matchAll(/<item\b[^>]*\/>/g)) {
      const tag = m[0];
      const id = tag.match(/\bid="([^"]+)"/)?.[1];
      const href = tag.match(/\bhref="([^"]+)"/)?.[1];
      const mediaType = tag.match(/\bmedia-type="([^"]+)"/)?.[1] ?? "";
      if (id && href && /xhtml|html/.test(mediaType)) manifest.set(id, href);
    }
    // spine order
    const spineRefs = [...opfXml.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => m[1]);

    const parser = new DOMParser();
    const parts: string[] = [];
    for (const ref of spineRefs) {
      const href = manifest.get(ref);
      if (!href) continue;
      const path = (opfDir + href).split("#")[0];
      const f = zip.file(path);
      if (!f) continue;
      try {
        const xml = await f.async("string");
        const doc = parser.parseFromString(xml, "application/xhtml+xml");
        const text = (doc.body?.textContent ?? doc.documentElement?.textContent ?? "").trim();
        if (text) parts.push(text);
      } catch {
        /* skip broken section */
      }
    }

    let title = file.name.replace(/\.epub$/i, "");
    const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/);
    if (titleMatch?.[1]) title = titleMatch[1].trim();

    const words = toWords(parts.join("\n\n"));
    if (words.length) return { title, words };
    // fall through to epub.js fallback
  } catch {
    /* fall through to epub.js */
  }

  // Fallback: epub.js
  const ePubMod: any = await import("epubjs");
  const ePub = ePubMod.default ?? ePubMod;
  const book = ePub(buf);
  await book.ready;
  const spine: any = book.spine;
  const items: any[] = spine?.spineItems ?? [];
  const parts: string[] = [];
  for (const item of items) {
    try {
      const doc = await item.load(book.load.bind(book));
      const text =
        (doc?.body?.textContent ?? doc?.documentElement?.textContent ?? "") as string;
      if (text?.trim()) parts.push(text);
      item.unload();
    } catch {
      /* skip */
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
