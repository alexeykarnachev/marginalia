// Shared pdf.js loader — used by BookCard (covers) and indexer (text extraction)
// Loads pdf.js once, caches globally.

const POLL_MS = 50;
const TIMEOUT_MS = 5000;

let loading: Promise<any> | null = null;

export function getPdfjsLib(): Promise<any> {
  if ((globalThis as any).pdfjsLib) return Promise.resolve((globalThis as any).pdfjsLib);
  if (loading) return loading;

  loading = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = './pdfjs/build/pdf.mjs';
    script.type = 'module';
    script.onload = () => {
      const check = setInterval(() => {
        if ((globalThis as any).pdfjsLib) {
          clearInterval(check);
          (globalThis as any).pdfjsLib.GlobalWorkerOptions.workerSrc = './pdfjs/build/pdf.worker.mjs';
          resolve((globalThis as any).pdfjsLib);
        }
      }, POLL_MS);
      setTimeout(() => { clearInterval(check); resolve(null); }, TIMEOUT_MS);
    };
    script.onerror = () => { loading = null; resolve(null); };
    document.head.appendChild(script);
  });

  return loading;
}
