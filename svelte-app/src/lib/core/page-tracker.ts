// Page navigation history tracker.
// Tracks page changes in the PDF viewer and maintains a history stack.

import { MAX_PAGE_HISTORY } from './constants';
import { getPdfApp } from '../state/viewer-hooks';
import type { PDFViewerApp } from './tools-shared';

const pageHistory: number[] = [];
let _lastTrackedPage: number | null = null;
let _pageTrackingApp: PDFViewerApp | null = null;
let _pageTrackingHandler: (() => void) | null = null;
let _suppressNextTrackedPageChange = false;

export function trackPageChange(): void {
  const app = getPdfApp();
  if (!app) return;
  const current = app.page!;
  if (current !== _lastTrackedPage) {
    if (_lastTrackedPage !== null) {
      if (_suppressNextTrackedPageChange) {
        _suppressNextTrackedPageChange = false;
      } else {
        pageHistory.push(_lastTrackedPage);
        if (pageHistory.length > MAX_PAGE_HISTORY) pageHistory.shift();
      }
    }
    _lastTrackedPage = current;
  }
}

export function getPageHistory(): number[] {
  return [...pageHistory];
}

export function clearPageHistory(): void {
  pageHistory.length = 0;
  _lastTrackedPage = null;
  _suppressNextTrackedPageChange = false;
}

export function disposePageTracking(): void {
  if (_pageTrackingApp && _pageTrackingHandler) {
    _pageTrackingApp.eventBus?.off?.('pagechanging', _pageTrackingHandler);
  }
  _pageTrackingApp = null;
  _pageTrackingHandler = null;
  _suppressNextTrackedPageChange = false;
}

export function initPageTracking(): void {
  const app = getPdfApp();
  if (app) {
    _lastTrackedPage = app.page!;
    if (_pageTrackingApp !== app) {
      disposePageTracking();
      _pageTrackingApp = app;
      _pageTrackingHandler = () => trackPageChange();
      app.eventBus?.on('pagechanging', _pageTrackingHandler);
    }
  }
}

export function setSuppressNextTrackedPageChange(value: boolean): void {
  _suppressNextTrackedPageChange = value;
}

/** The raw history array — passed to tool registration helpers for go_back tool. */
export { pageHistory };
