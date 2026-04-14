// Debug utilities for diagnosing runtime state.

import { getAllBooksMeta, getAllFolders } from './db';
import { log } from './logger';

/** Build a JSON string with the raw IndexedDB contents (books_meta + folders, no PDF data).
 *  Bypasses the in-memory library state so it reflects on-disk truth. */
export async function buildDbDump(): Promise<{ json: string; books: number; folders: number }> {
  const [books, folders] = await Promise.all([getAllBooksMeta(), getAllFolders()]);
  const payload = {
    timestamp: new Date().toISOString(),
    books_count: books.length,
    folders_count: folders.length,
    books,
    folders,
  };
  const json = JSON.stringify(payload, null, 2);
  log('DB', `built dump: ${books.length} books, ${folders.length} folders`);
  return { json, books: books.length, folders: folders.length };
}

/** Try to write text to clipboard. Returns true on success, false on failure
 *  (e.g. iOS Safari gesture/permission restrictions). */
export async function tryCopyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    log('DEBUG', 'navigator.clipboard.writeText failed:', err);
  }
  // Fallback: hidden textarea + execCommand('copy'). Deprecated but still works on iOS
  // when async clipboard API is blocked.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (err) {
    log('DEBUG', 'execCommand copy fallback failed:', err);
    return false;
  }
}
