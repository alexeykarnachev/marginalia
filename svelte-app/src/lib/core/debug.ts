// Debug utilities for diagnosing runtime state.

import { getAllBooksMeta, getAllFolders } from './db';
import { log } from './logger';

/** Copy raw IndexedDB contents (books_meta + folders, no PDF data) as JSON to clipboard.
 *  Bypasses the in-memory library state so it reflects on-disk truth. */
export async function copyDbDump(): Promise<{ books: number; folders: number }> {
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
  log('DB', `copied ${books.length} books, ${folders.length} folders to clipboard`);
  return { books: books.length, folders: folders.length };
}
