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

/** Write text to clipboard using ClipboardItem with a Promise, so iOS Safari
 *  accepts it even when the data is resolved after an async gap.
 *  The key: the ClipboardItem is created SYNCHRONOUSLY during the user gesture,
 *  and iOS honors the Promise inside it. */
export function copyTextViaPromise(textPromise: Promise<string>): Promise<void> {
  const blobPromise = textPromise.then(text => new Blob([text], { type: 'text/plain' }));
  const item = new ClipboardItem({ 'text/plain': blobPromise });
  return navigator.clipboard.write([item]);
}
