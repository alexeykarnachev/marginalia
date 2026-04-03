// Viewer hooks — mutable singletons set by ViewerApp on mount, read by tools.
// These bridge the viewer iframe state to the tool system.

import type { PDFViewerApp } from '../core/tools-shared';

// --- PDF app accessor ---
let _pdfAppGetter: (() => PDFViewerApp | null) | null = null;

export function setPdfAppGetter(getter: (() => PDFViewerApp | null) | null): void {
  _pdfAppGetter = getter;
}

export function getPdfApp(): PDFViewerApp | undefined {
  if (_pdfAppGetter) {
    return _pdfAppGetter() ?? undefined;
  }
  return (window as unknown as { PDFViewerApplication?: PDFViewerApp }).PDFViewerApplication;
}

// --- Current book ID ---
let _currentBookIdFn: (() => string | null) | null = null;

export function setCurrentBookIdFn(fn: (() => string | null) | null): void {
  _currentBookIdFn = fn;
}

export function getCurrentBookId(): string | null {
  return _currentBookIdFn ? _currentBookIdFn() : null;
}

// --- Cached selection ---
let _cachedSelection = '';

export function setCachedSelection(selection: string): void {
  _cachedSelection = selection;
}

export function getCachedSelection(): string {
  return _cachedSelection;
}

// --- Page history callback ---
let _getPageHistoryFn: (() => number[]) | null = null;

export function setGetPageHistoryFn(fn: (() => number[]) | null): void {
  _getPageHistoryFn = fn;
}

export function getPageHistoryFromViewer(): number[] {
  return _getPageHistoryFn ? _getPageHistoryFn() : [];
}

// --- Book change callback (used by open_book tool) ---
let _onBookChangeFn: ((bookId: string) => void) | null = null;

export function setOnBookChangeFn(fn: ((bookId: string) => void) | null): void {
  _onBookChangeFn = fn;
}

export function getOnBookChangeFn(): ((bookId: string) => void) | null {
  return _onBookChangeFn;
}
