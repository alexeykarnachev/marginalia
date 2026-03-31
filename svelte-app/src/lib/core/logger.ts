// In-memory ring buffer logger. Last 1000 entries.

const MAX = 1000;
const lines: string[] = [];

export function log(tag: string, ...args: any[]) {
  const ts = new Date().toISOString().slice(11, 23);
  const msg = `[${ts}] [${tag}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`;
  lines.push(msg);
  if (lines.length > MAX) lines.shift();
}

export function getLogs(): string {
  return lines.join('\n');
}

export function copyLogs() {
  navigator.clipboard.writeText(getLogs()).catch(() => {});
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
