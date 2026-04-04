import {
  SYSTEM_PROMPT,
  BOOK_PROMPT_HEADER,
  CHAT_PROMPT_HEADER,
  renderPrompt,
} from './prompt';
import type { LibraryContext } from '../types';

function appendSection(base: string, header: string, value: string | null | undefined): string {
  if (!value?.trim()) return base;
  return `${base}\n\n${header}\n${value.trim()}`;
}

export function buildReadingAssistantPrompt(
  context: LibraryContext,
  bookPrompt: string,
  chatPrompt: string,
): string {
  let system = renderPrompt(SYSTEM_PROMPT, context as unknown as Record<string, string>);
  system = appendSection(system, BOOK_PROMPT_HEADER, bookPrompt);
  system = appendSection(system, CHAT_PROMPT_HEADER, chatPrompt);
  return system;
}

export function buildLibraryAssistantPrompt(
  chatPrompt: string,
): string {
  let system = `You are Marginalia, an AI library assistant. Help the user manage and explore their book library.
You have access to tools for searching, organizing, and reading books.
Use the get_library tool to see the full library tree when needed.
Respond in the user's language. Be concise.`;
  system = appendSection(system, CHAT_PROMPT_HEADER, chatPrompt);
  return system;
}
