// Book indexer — extracts page text from PDF using pdf.js
// Works standalone (no viewer iframe needed)

import { getBook, getBookMeta, updateBookMeta } from './db';
import { getPdfjsLib } from './pdfjs-loader';

/**
 * Index a book: extract text from all pages and save to IndexedDB.
 * Skips if already indexed. Calls onProgress with status strings.
 */
export async function indexBook(
  bookId: string,
  onProgress?: (status: string) => void,
): Promise<void> {
  // Check metadata first to avoid loading full PDF if already indexed
  const meta = await getBookMeta(bookId);
  if (!meta || meta.pages) return; // already indexed or not found

  const book = await getBook(bookId);
  if (!book) return;

  const pdfjsLib = await getPdfjsLib();
  if (!pdfjsLib) return;

  try {
    const blob = book.data instanceof Blob ? book.data : new Blob([book.data], { type: 'application/pdf' });
    const buf = await blob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

    const total = pdf.numPages;
    const pages: string[] = [];
    for (let i = 1; i <= total; i++) {
      if (i === 1 || i % 10 === 0) {
        onProgress?.(`Indexing ${i}/${total}...`);
      }
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item: { str: string }) => item.str).join(' '));
    }

    // Only update the pages field in metadata — no need to re-read the full PDF
    await updateBookMeta(bookId, { pages });
    onProgress?.(`Indexed ${total} pages`);
  } catch (err) {
    console.warn('Indexing failed:', err);
    onProgress?.('Indexing failed');
  }
}
