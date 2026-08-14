// Client-only PDF + EPUB text extractors. All heavy libs are dynamically
// imported so they never run during SSR.

export type Chapter = {
  title: string;
  /** Word index where this chapter starts. */
  start: number;
};

export type ParsedBook = {
  title: string;
  words: string[];
  chapters?: Chapter[];
};

const WORD_RE = /\S+/g;

function toWords(text: string): string[] {
  return (text.match(WORD_RE) ?? []).filter(Boolean);
}

function countWords(text: string): number {
  return toWords(text).length;
}

/** Normalize + de-dupe chapter markers, dropping trivial ones. */
export function tidyChapters(chapters: Chapter[], totalWords: number): Chapter[] {
  const cleaned = chapters
    .map((c) => ({
      title: (c.title || "Chapter").replace(/\s+/g, " ").trim().slice(0, 80),
      start: Math.max(0, Math.min(totalWords - 1, Math.round(c.start))),
    }))
    .sort((a, b) => a.start - b.start);
  const out: Chapter[] = [];
  for (const c of cleaned) {
    const prev = out[out.length - 1];
    // Skip markers that sit almost on top of the previous one.
    if (prev && c.start - prev.start < 120) continue;
    out.push(c);
  }
  if (out.length && out[0].start > 0) out.unshift({ title: "Start", start: 0 });
  return out.length > 1 ? out : [];
}

/** Fallback segmentation for books with no usable chapter metadata. */
export function syntheticChapters(totalWords: number): Chapter[] {
  if (totalWords < 1500) return [{ title: "Part 1", start: 0 }];
  const target = 3000;
  const count = Math.max(2, Math.min(40, Math.round(totalWords / target)));
  const size = Math.ceil(totalWords / count);
  const out: Chapter[] = [];
  for (let i = 0; i < count; i++) out.push({ title: `Part ${i + 1}`, start: i * size });
  return out;
}

export async function parsePdf(file: File): Promise<ParsedBook> {
  const pdfjs: any = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url" as any)).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  // Word offset at the start of each page (0-based page index).
  const pageWordStart: number[] = [];
  let running = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .join(" ");
    pageWordStart.push(running);
    running += countWords(text);
    parts.push(text);
  }
  const words = toWords(parts.join("\n\n"));

  // Chapters from the PDF outline (bookmarks), mapped to word offsets via pages.
  let chapters: Chapter[] = [];
  try {
    const outline: any[] = (await doc.getOutline()) ?? [];
    const flat: Chapter[] = [];
    const walk = async (nodes: any[], depth: number) => {
      for (const node of nodes) {
        try {
          let dest = node.dest;
          if (typeof dest === "string") dest = await doc.getDestination(dest);
          const ref = Array.isArray(dest) ? dest[0] : null;
          if (ref) {
            const pageIndex = await doc.getPageIndex(ref);
            flat.push({ title: node.title ?? "Chapter", start: pageWordStart[pageIndex] ?? 0 });
          }
        } catch {
          /* skip unresolvable bookmark */
        }
        if (depth < 1 && node.items?.length) await walk(node.items, depth + 1);
      }
    };
    await walk(outline, 0);
    chapters = tidyChapters(flat, words.length);
  } catch {
    /* no outline */
  }
  if (!chapters.length) chapters = syntheticChapters(words.length);

  const title = file.name.replace(/\.pdf$/i, "");
  return { title, words, chapters };
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
    const rawChapters: Chapter[] = [];
    let offset = 0;
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
        if (!text) continue;
        // Section title: first heading, else <title>, else file name.
        const heading =
          doc.querySelector("h1, h2, h3")?.textContent?.trim() ||
          doc.querySelector("title")?.textContent?.trim() ||
          path.split("/").pop()?.replace(/\.x?html?$/i, "") ||
          "Chapter";
        rawChapters.push({ title: heading, start: offset });
        offset += countWords(text);
        parts.push(text);
      } catch {
        /* skip broken section */
      }
    }

    let title = file.name.replace(/\.epub$/i, "");
    const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/);
    if (titleMatch?.[1]) title = titleMatch[1].trim();

    const words = toWords(parts.join("\n\n"));
    if (words.length) {
      let chapters = tidyChapters(rawChapters, words.length);
      if (!chapters.length) chapters = syntheticChapters(words.length);
      return { title, words, chapters };
    }
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
  const rawChapters: Chapter[] = [];
  let offset = 0;
  for (const item of items) {
    try {
      const doc = await item.load(book.load.bind(book));
      const text =
        (doc?.body?.textContent ?? doc?.documentElement?.textContent ?? "") as string;
      if (text?.trim()) {
        const heading =
          doc?.querySelector?.("h1, h2, h3")?.textContent?.trim() ||
          doc?.querySelector?.("title")?.textContent?.trim() ||
          `Section ${rawChapters.length + 1}`;
        rawChapters.push({ title: heading, start: offset });
        offset += countWords(text);
        parts.push(text);
      }
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
  const words = toWords(parts.join("\n\n"));
  let chapters = tidyChapters(rawChapters, words.length);
  if (!chapters.length) chapters = syntheticChapters(words.length);
  return { title, words, chapters };
}

export async function parseFile(file: File): Promise<ParsedBook> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return parsePdf(file);
  if (name.endsWith(".epub")) return parseEpub(file);
  throw new Error("Unsupported file type. Please upload a PDF or EPUB.");
}
