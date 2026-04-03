import { getBook, updateBookMeta } from '../lib/core/db';

export interface ViewerSessionOptions {
  getPdfIframe: () => HTMLIFrameElement | undefined;
  getCurrentBookId: () => string;
  setCurrentBookId: (bookId: string) => void;
  applyThemeToIframe: () => void;
  onPdfReady?: () => void;
  captureSelection: () => void;
  onBookMissing: () => void;
  onBookLoaded: (title: string) => void;
  onIndexingStatus: (status: string) => void;
  isLoadCurrent: (loadToken: number) => boolean;
}

const PDF_INIT_POLL_MS = 100;
const PDF_INIT_TIMEOUT_MS = 15000;
const PDF_DOC_POLL_MS = 500;
const PDF_DOC_TIMEOUT_MS = 30000;
const INDEXING_STATUS_CLEAR_MS = 2000;
const INDEXING_FAIL_CLEAR_MS = 3000;
const INDEXING_PROGRESS_INTERVAL = 10;

export interface ViewerPdfApp {
  initializedPromise?: Promise<void>;
  pdfDocument?: {
    getPage: (num: number) => Promise<{ getTextContent: () => Promise<{ items: { str: string }[] }> }>;
    numPages: number;
  };
  pdfViewer?: {
    spreadMode: number;
  };
  pagesCount?: number;
  eventBus?: {
    on: (event: string, handler: () => void) => void;
    off?: (event: string, handler: () => void) => void;
  };
  open: (options: { url: string }) => void;
}

export interface ViewerSession {
  getPdfApp: () => ViewerPdfApp | undefined;
  loadPdf: (targetBookId?: string) => Promise<void>;
  cleanup: () => void;
}

export function createViewerSession(options: ViewerSessionOptions): ViewerSession {
  let activePdfUrl: string | null = null;
  let activeIframeDoc: Document | null = null;
  let activePdfApp: ViewerPdfApp | null = null;
  let documentInitHandler: (() => void) | null = null;
  let pdfLoadToken = 0;

  function getPdfApp(): ViewerPdfApp | undefined {
    const iframeWindow = options.getPdfIframe()?.contentWindow as (Window & { PDFViewerApplication?: ViewerPdfApp }) | null;
    return iframeWindow?.PDFViewerApplication;
  }

  function cleanup(): void {
    pdfLoadToken++;

    if (activeIframeDoc) {
      activeIframeDoc.removeEventListener('mouseup', options.captureSelection);
      activeIframeDoc.removeEventListener('touchend', options.captureSelection);
      activeIframeDoc = null;
    }

    if (activePdfApp && documentInitHandler) {
      activePdfApp.eventBus?.off?.('documentinit', documentInitHandler);
    }
    activePdfApp = null;
    documentInitHandler = null;

    if (activePdfUrl) {
      URL.revokeObjectURL(activePdfUrl);
      activePdfUrl = null;
    }
  }

  async function indexBookInBackground(bookId: string, loadToken: number): Promise<void> {
    const app = getPdfApp();
    if (!app?.pdfDocument) {
      options.onIndexingStatus('Waiting for PDF...');
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (app?.pdfDocument) {
            clearInterval(check);
            resolve();
          }
        }, PDF_DOC_POLL_MS);
        setTimeout(() => {
          clearInterval(check);
          resolve();
        }, PDF_DOC_TIMEOUT_MS);
      });
    }
    if (!app?.pdfDocument || !options.isLoadCurrent(loadToken)) {
      options.onIndexingStatus('');
      return;
    }

    try {
      const pdfDocument = app.pdfDocument;
      const total = pdfDocument.numPages || app.pagesCount || 0;
      const pages: string[] = [];
      for (let i = 1; i <= total; i++) {
        if (!options.isLoadCurrent(loadToken) || options.getCurrentBookId() !== bookId) {
          options.onIndexingStatus('');
          return;
        }
        if (i === 1 || i % INDEXING_PROGRESS_INTERVAL === 0) {
          options.onIndexingStatus(`Indexing ${i}/${total}...`);
        }
        const page = await pdfDocument.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item: { str: string }) => item.str).join(' '));
      }
      if (!options.isLoadCurrent(loadToken) || options.getCurrentBookId() !== bookId) {
        options.onIndexingStatus('');
        return;
      }
      await updateBookMeta(bookId, { pages });
      options.onIndexingStatus(`Indexed ${total} pages`);
      setTimeout(() => options.onIndexingStatus(''), INDEXING_STATUS_CLEAR_MS);
    } catch (err) {
      console.warn('Indexing failed:', err);
      options.onIndexingStatus('Indexing failed');
      setTimeout(() => options.onIndexingStatus(''), INDEXING_FAIL_CLEAR_MS);
    }
  }

  async function loadPdf(targetBookId = options.getCurrentBookId()): Promise<void> {
    const loadToken = ++pdfLoadToken;
    cleanup();
    pdfLoadToken = loadToken;
    options.setCurrentBookId(targetBookId);

    const book = await getBook(targetBookId);
    if (!book) {
      options.onBookMissing();
      return;
    }

    options.onBookLoaded(book.title);

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        const app = getPdfApp();
        if (app?.initializedPromise) {
          clearInterval(check);
          resolve();
        }
      }, PDF_INIT_POLL_MS);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, PDF_INIT_TIMEOUT_MS);
    });

    const app = getPdfApp();
    if (!app) return;

    const blob = book.data instanceof Blob ? book.data : new Blob([book.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    if (!options.isLoadCurrent(loadToken)) {
      URL.revokeObjectURL(url);
      return;
    }

    await app.initializedPromise;
    if (!options.isLoadCurrent(loadToken)) {
      URL.revokeObjectURL(url);
      return;
    }

    if (app.pdfViewer) app.pdfViewer.spreadMode = 0;
    documentInitHandler = () => {
      if (app.pdfViewer) app.pdfViewer.spreadMode = 0;
    };
    app.eventBus?.on('documentinit', documentInitHandler);

    activePdfUrl = url;
    activePdfApp = app;
    app.open({ url });

    try {
      const iframeDoc = options.getPdfIframe()?.contentDocument;
      if (iframeDoc) {
        iframeDoc.addEventListener('mouseup', options.captureSelection);
        iframeDoc.addEventListener('touchend', options.captureSelection);
        activeIframeDoc = iframeDoc;
      }
    } catch {}

    options.applyThemeToIframe();
    options.onPdfReady?.();

    if (!book.pages) {
      void indexBookInBackground(targetBookId, loadToken);
    }
  }

  return { getPdfApp, loadPdf, cleanup };
}
