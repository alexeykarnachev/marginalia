import type { ToolRegistrar, ToolRegistrationHelpers } from './tools-shared';

export function registerNavigationTools(register: ToolRegistrar, helpers: ToolRegistrationHelpers): void {
  register({
    name: 'go_to_page',
    description: 'Navigate the reader to a specific page of the current book.',
    parameters: {
      type: 'object',
      properties: { page: { type: 'integer', description: 'Page number (1-based)' } },
      required: ['page'],
    },
    handler: async ({ page }: { page: number }) => {
      const app = helpers.getPdfApp();
      const total = app?.pagesCount || 0;
      if (page < 1 || page > total) return `Error: page ${page} out of range (1-${total})`;
      const current = app?.page || 1;
      if (current !== page) {
        if (app?.pdfLinkService) {
          app.pdfLinkService.goToPage(page);
        } else if (app) {
          app.page = page;
        }
      }
      return `Navigated to page ${page}` + (current !== page ? ` (was on page ${current})` : '');
    },
  });

  register({
    name: 'go_back',
    description: 'Navigate back to the previous page in history.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      const app = helpers.getPdfApp();
      const current = app?.page || '?';
      if (helpers.pageHistory.length === 0) {
        return `No previous page in history (currently on page ${current})`;
      }
      const prev = helpers.pageHistory.pop()!;
      helpers.setSuppressNextTrackedPageChange(true);
      if (app?.pdfLinkService) {
        app.pdfLinkService.goToPage(prev);
      } else if (app) {
        app.page = prev;
      }
      return `Returned to page ${prev} (was on page ${current})`;
    },
  });

  register({
    name: 'open_book',
    description:
      'Open a different book from the library in the reader. This navigates the user to that book.',
    parameters: {
      type: 'object',
      properties: { book_id: { type: 'string', description: 'Book ID to open' } },
      required: ['book_id'],
    },
    handler: async ({ book_id }: { book_id: string }) => {
      const book = await helpers.getBookMeta(book_id);
      if (!book) return `Error: book "${book_id}" not found`;
      helpers.getOnBookChange()?.(book_id);
      return `Opened "${book.title}"`;
    },
  });
}
