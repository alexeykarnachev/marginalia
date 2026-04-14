// In-memory ring buffer logger. Last 1000 entries.

const MAX = 1000;
const lines: string[] = [];

export function log(tag: string, ...args: any[]) {
  const ts = new Date().toISOString().slice(11, 23);
  const msg = `[${ts}] [${tag}] ${args.map(a => {
    if (a instanceof Error || (a && typeof a === 'object' && 'message' in a)) {
      const stack = a.stack ? '\n' + a.stack.split('\n').slice(0, 3).join('\n') : '';
      return `${a.name || 'Error'}: ${a.message}${stack}`;
    }
    if (typeof a === 'object') try { return JSON.stringify(a); } catch { return String(a); }
    return String(a);
  }).join(' ')}`;
  lines.push(msg);
  if (lines.length > MAX) lines.shift();
}

export function getLogs(): string {
  return lines.join('\n');
}

export function copyLogs() {
  navigator.clipboard.writeText(getLogs()).catch(() => {});
}

/** Dump raw IndexedDB contents (books_meta + folders, no PDF data) as JSON to clipboard.
 *  Bypasses the in-memory library state so it reflects on-disk truth.
 *  Uses dynamic import to avoid a circular dep (db.ts imports log from here). */
export async function dumpIndexedDB() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { getAllBooksMeta, getAllFolders } = await import(/* @vite-ignore */ './db');
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
  } catch (err) {
    log('DB', 'dumpIndexedDB failed:', err);
    alert('Dump failed: ' + (err as Error).message);
  }
}

// Intercept console.warn to capture pdf.js warnings
const origWarn = console.warn;
console.warn = (...args: any[]) => {
  log('WARN', ...args);
  origWarn.apply(console, args);
};

// Intercept errors
window.addEventListener('error', (e) => log('ERROR', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', (e) => log('REJECT', e.reason));
