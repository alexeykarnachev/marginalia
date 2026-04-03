import type { ToolRegistrar, ToolRegistrationHelpers, PDFOutlineItem } from './tools-shared';
import {
  READ_PAGES_MAX,
  SEARCH_BOOK_DEFAULT_LIMIT,
  SEARCH_BOOK_MAX_LIMIT,
  SEARCH_ALL_BOOKS_DEFAULT_LIMIT,
  SEARCH_ALL_BOOKS_MAX_LIMIT,
  CROSS_BOOK_SNIPPET_CONTEXT_CHARS,
  TOC_HEADING_MAX,
  TOC_SCAN_FIRST_PAGES,
  TOC_PAGE_TEXT_MAX_CHARS,
  TOC_PREVIEW_PAGES,
  TOC_PREVIEW_CHARS,
  TOC_HEADING_CONTEXT_CHARS,
} from './constants';

export function registerReadingTools(register: ToolRegistrar, helpers: ToolRegistrationHelpers): void {
  register({
    name: 'read_page',
    description: 'Read extracted text from a specific page of any book.',
    parameters: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Page number (1-based)' },
        book_id: { type: 'string', description: 'Book ID. Omit for current book.' },
      },
      required: ['page'],
    },
    handler: async ({ page, book_id }: { page: number; book_id?: string }) => {
      const bid = await helpers.resolveBookId(book_id);
      if (!bid) return 'Error: no book specified and no current book';
      const total = await helpers.getBookPageCount(bid);
      if (page < 1 || page > total) return `Error: page ${page} out of range (1-${total})`;
      const title = await helpers.resolveBookTitle(bid);
      const text = await helpers.getBookPageText(bid, page);
      return `[${title}, p.${page}/${total}]\n${text || '(no extractable text)'}`;
    },
  });

  register({
    name: 'read_pages',
    description:
      'Read a range of pages from any book. More efficient than multiple read_page calls. Max 20 pages per call.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'integer', description: 'Start page (1-based)' },
        to: { type: 'integer', description: 'End page (inclusive)' },
        book_id: { type: 'string', description: 'Book ID. Omit for current book.' },
      },
      required: ['from', 'to'],
    },
    handler: async ({ from, to, book_id }: { from: number; to: number; book_id?: string }) => {
      const bid = await helpers.resolveBookId(book_id);
      if (!bid) return 'Error: no book specified and no current book';
      const total = await helpers.getBookPageCount(bid);
      if (from < 1 || to > total || from > to) {
        return `Error: invalid range ${from}-${to} (book has ${total} pages)`;
      }
      const clamped = Math.min(to, from + READ_PAGES_MAX - 1);
      const title = await helpers.resolveBookTitle(bid);
      const parts: string[] = [];
      for (let i = from; i <= clamped; i++) {
        const text = await helpers.getBookPageText(bid, i);
        parts.push(`--- p.${i} ---\n${text || '(no extractable text)'}`);
      }
      let header = `[${title}, p.${from}-${clamped}/${total}]`;
      if (clamped < to) header += ` (capped at ${READ_PAGES_MAX} pages, requested up to ${to})`;
      return header + '\n\n' + parts.join('\n\n');
    },
  });

  register({
    name: 'get_table_of_contents',
    description:
      'Get the table of contents / chapter structure of a book. Tries PDF outline first, then scans early pages for a TOC.',
    parameters: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: 'Book ID. Omit for current book.' },
      },
    },
    handler: async ({ book_id }: { book_id?: string } = {}) => {
      const bid = await helpers.resolveBookId(book_id);
      if (!bid) return 'Error: no book specified and no current book';
      const title = await helpers.resolveBookTitle(bid);
      const total = await helpers.getBookPageCount(bid);

      try {
        const app = helpers.getPdfApp();
        const currentId = await helpers.getCurrentBookId();
        if (bid === currentId && app?.pdfDocument) {
          const outline = await app.pdfDocument.getOutline();
          if (outline && outline.length > 0) {
            const lines: string[] = [];
            function walk(items: PDFOutlineItem[], indent: string): void {
              for (const item of items) {
                lines.push(`${indent}${item.title}`);
                if (item.items) walk(item.items, indent + '  ');
              }
            }
            walk(outline, '');
            return `[${title}] Table of Contents (PDF outline):\n${lines.join('\n')}`;
          }
        }
      } catch {}

      const pages = await helpers.getAllPageTexts(bid);
      const headingPatterns = [
        /(?:^|\s)(Chapter|Part|Book|Section)\s+(\d+|[IVXLC]+(?:\s|$))/gi,
        /(?:^|\s)(\u0413\u043B\u0430\u0432\u0430|\u0427\u0430\u0441\u0442\u044C|\u0420\u0430\u0437\u0434\u0435\u043B)\s+(\d+|[IVXLC]+(?:\s|$))/gi,
        /(?:^|\s)\u00A7\s*\d+/g,
      ];

      const chapters: string[] = [];
      for (let i = 0; i < pages.length && chapters.length < TOC_HEADING_MAX; i++) {
        const text = pages[i];
        for (const re of headingPatterns) {
          re.lastIndex = 0;
          const m = re.exec(text);
          if (m) {
            const start = Math.max(0, m.index);
            const snippet = text.slice(start, start + TOC_HEADING_CONTEXT_CHARS).trim();
            chapters.push(`p.${i + 1}: ${snippet}`);
            break;
          }
        }
      }

      const tocWarning =
        "\n\nWARNING: Page numbers printed in the book's TOC may NOT match PDF page numbers. To navigate, use search_book to find the actual PDF page, or use the p.N numbers shown above (those ARE PDF page numbers).";

      if (chapters.length > 0) {
        return `[${title}] Chapter/section headings found (${total} pages):\n${chapters.join('\n')}${tocWarning}`;
      }

      const tocKeywords =
        /contents|table of contents|\u043E\u0433\u043B\u0430\u0432\u043B\u0435\u043D\u0438\u0435|\u0441\u043E\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u0435/i;
      for (let i = 0; i < Math.min(TOC_SCAN_FIRST_PAGES, pages.length); i++) {
        if (tocKeywords.test(pages[i])) {
          return `[${title}] Table of Contents page found (p.${i + 1}/${total}):\n${pages[i].slice(0, TOC_PAGE_TEXT_MAX_CHARS)}${tocWarning}`;
        }
      }

      const preview = pages
        .slice(0, TOC_PREVIEW_PAGES)
        .map((t, i) => `p.${i + 1}: ${t.slice(0, TOC_PREVIEW_CHARS)}`)
        .join('\n\n');
      return `[${title}] No structured TOC found (${total} pages). First pages:\n${preview}`;
    },
  });

  register({
    name: 'search_book',
    description:
      "Grep for a regex pattern across all pages of a book. Case-insensitive. Supports | (alternation), \\d, character classes, etc. Returns matching pages with snippets and match counts.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            "Regex pattern (e.g. 'guilt|conscience', 'theorem \\d+', 'Raskolnikov.*axe')",
        },
        book_id: { type: 'string', description: 'Book ID. Omit for current book.' },
        limit: { type: 'integer', description: 'Max results to return (default 20)' },
      },
      required: ['query'],
    },
    handler: async ({
      query,
      book_id,
      limit,
    }: {
      query: string;
      book_id?: string;
      limit?: number;
    }) => {
      const bid = await helpers.resolveBookId(book_id);
      if (!bid) return 'Error: no book specified and no current book';
      if (!query) return 'Error: empty query';
      const maxResults = Math.min(limit || SEARCH_BOOK_DEFAULT_LIMIT, SEARCH_BOOK_MAX_LIMIT);
      const title = await helpers.resolveBookTitle(bid);
      const pages = await helpers.getAllPageTexts(bid);
      const re = helpers.buildRegex(query);

      const results: string[] = [];
      let totalMatches = 0;
      let totalPages = 0;
      for (let i = 0; i < pages.length; i++) {
        const text = pages[i];
        const matches = [...text.matchAll(re)];
        if (matches.length > 0) {
          totalMatches += matches.length;
          totalPages++;
          if (results.length < maxResults) {
            const snippet = helpers.extractSnippet(text, matches[0]);
            const countSuffix = matches.length > 1 ? ` (${matches.length} matches on page)` : '';
            results.push(`p.${i + 1}${countSuffix}: ${snippet}`);
          }
        }
      }
      const header = `[${title}] grep /${query}/i`;
      const summary = `${totalMatches} total match(es) across ${totalPages} page(s)`;
      if (!results.length) return `${header} — no matches`;
      let output = `${header} — ${summary}`;
      if (results.length < totalPages) output += ` (showing first ${results.length} pages)`;
      return output + `:\n\n${results.join('\n\n')}`;
    },
  });

  register({
    name: 'search_all_books',
    description:
      'Grep for a regex pattern across ALL books in the library (or a subset). Returns results grouped by book.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Regex pattern' },
        book_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: only search these books. Omit to search all.',
        },
        limit_per_book: { type: 'integer', description: 'Max results per book (default 5)' },
      },
      required: ['query'],
    },
    handler: async ({
      query,
      book_ids,
      limit_per_book,
    }: {
      query: string;
      book_ids?: string[];
      limit_per_book?: number;
    }) => {
      if (!query) return 'Error: empty query';
      const maxPerBook = Math.min(limit_per_book || SEARCH_ALL_BOOKS_DEFAULT_LIMIT, SEARCH_ALL_BOOKS_MAX_LIMIT);
      const re = helpers.buildRegex(query);
      const books = await helpers.getAllBooksMeta();
      const targets = book_ids ? books.filter((b) => book_ids.includes(b.id)) : books;

      const sections: string[] = [];
      let grandTotal = 0;
      for (const book of targets) {
        const pages = await helpers.getAllPageTexts(book.id);
        const results: string[] = [];
        let bookMatches = 0;
        for (let i = 0; i < pages.length; i++) {
          const matches = [...pages[i].matchAll(re)];
          if (matches.length > 0) {
            bookMatches += matches.length;
            if (results.length < maxPerBook) {
              const snippet = helpers.extractSnippet(pages[i], matches[0], CROSS_BOOK_SNIPPET_CONTEXT_CHARS);
              results.push(`  p.${i + 1}: ${snippet}`);
            }
          }
        }
        grandTotal += bookMatches;
        if (bookMatches > 0) {
          let header = `[${book.title}] ${bookMatches} match(es)`;
          if (results.length < bookMatches) header += ` (showing ${results.length} pages)`;
          sections.push(header + ':\n' + results.join('\n'));
        }
      }
      const header = `grep /${query}/i across ${targets.length} book(s) — ${grandTotal} total match(es)`;
      return sections.length ? header + '\n\n' + sections.join('\n\n') : header + ' — no matches';
    },
  });
}
