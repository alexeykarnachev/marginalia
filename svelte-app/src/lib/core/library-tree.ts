// Build a text representation of the library folder/book tree.
// Pure function — no DB access, no side effects.

import type { BookMeta, Folder } from '../types';

function formatSize(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

export function buildLibraryTree(books: BookMeta[], folders: Folder[]): string {
  function buildTree(parentId: string | null, indent: string): string[] {
    const lines: string[] = [];
    for (const f of folders.filter((f) => (f.parent_id || null) === parentId)) {
      lines.push(`${indent}[folder] ${f.name} (id: ${f.id})`);
      lines.push(...buildTree(f.id, indent + '  '));
    }
    for (const b of books.filter((b) => (b.folder_id || null) === parentId)) {
      const pages = b.pages ? b.pages.length : '?';
      const size = formatSize(b.size || 0);
      const tag = b.archived ? '[book, archived]' : '[book]';
      lines.push(`${indent}${tag} ${b.title} (${pages} pages, ${size}, id: ${b.id})`);
    }
    return lines;
  }
  const treeLines = buildTree(null, '');
  return treeLines.length ? treeLines.join('\n') : '(empty library)';
}

export { formatSize };
