// Debug utilities for diagnosing runtime state.

import { getAllBooksMeta, getAllFolders } from './db';
import { log } from './logger';

/** Dump raw IndexedDB contents (books_meta + folders, no PDF data) as JSON to clipboard.
 *  Bypasses the in-memory library state so it reflects on-disk truth. */
export async function dumpIndexedDB() {
  try {
    const [books, folders] = await Promise.all([getAllBooksMeta(), getAllFolders()]);
    const payload = {
      timestamp: new Date().toISOString(),
      books_count: books.length,
      folders_count: folders.length,
      books,
      folders,
    };
    const json = JSON.stringify(payload, null, 2);
    await navigator.clipboard.writeText(json);
    log('DB', `dumped ${books.length} books, ${folders.length} folders to clipboard`);
    alert(`Dumped ${books.length} books, ${folders.length} folders to clipboard.`);
  } catch (err) {
    log('DB', 'dumpIndexedDB failed:', err);
    alert('Dump failed: ' + (err as Error).message);
  }
}
