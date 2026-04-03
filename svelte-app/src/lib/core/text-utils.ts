// Text utilities — regex building and snippet extraction for search tools.

import { SEARCH_SNIPPET_CONTEXT_CHARS } from './constants';

/** Build a case-insensitive regex, falling back to escaped literal on invalid patterns. */
export function buildRegex(query: string): RegExp {
  try {
    return new RegExp(query, 'gi');
  } catch {
    return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  }
}

/** Extract a snippet of text around a regex match with surrounding context. */
export function extractSnippet(text: string, match: RegExpMatchArray, contextChars = SEARCH_SNIPPET_CONTEXT_CHARS): string {
  const start = Math.max(0, match.index! - contextChars);
  const end = Math.min(text.length, match.index! + match[0].length + contextChars);
  return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
}
