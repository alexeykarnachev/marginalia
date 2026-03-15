// Prompt rendering, API message building, token estimation, and auto-compaction

import type { ChatMessage } from '../types';
import { simpleLLMCall } from './agent';
import {
  RECENT_MSG_COUNT,
  MAX_OLD_ASSISTANT_CHARS,
  MAX_OLD_USER_CHARS,
  MIN_MESSAGES_FOR_COMPACT,
} from './constants';

export const SYSTEM_PROMPT = `You are Marginalia, an AI reading assistant.

## Environment
You are embedded in a static web application (Marginalia) that runs entirely in the browser.
The user has a personal library of books (PDFs) organized in folders.
Your responses are rendered with **Markdown** and **LaTeX** support (KaTeX).

## Library
{{libraryTree}}

## Current focus
{{focusContext}}
{{#pageHistory}}

## Page history
{{pageHistory}}
{{/pageHistory}}
{{#selection}}

## Selected text
\`\`\`
{{selection}}
\`\`\`
{{/selection}}
{{#pageText}}

## Current page content
{{pageText}}
{{/pageText}}

## Tools
All read/search tools accept an optional book_id — you can access ANY book without switching.
- **Read**: read_page, read_pages (range, max 20)
- **Search**: search_book (regex grep), search_all_books (cross-library grep). Supports regex: | for alternation, \\d+, character classes, etc.
- **Navigate**: go_to_page, go_back, open_book
- **Book info**: get_table_of_contents
- **Library**: create/rename/move/delete folders and books (batch operations available)
If you need to re-read a page you read earlier in this turn, just call read_page again.

## Rules
- **Tool use is mandatory for actions**: NEVER claim you performed an action (created folder, moved book, renamed, searched, read) without calling the corresponding tool. If you cannot do something, say so honestly.
- **Grounding**: Base all claims about book content on tool results from this conversation. When you supplement with general knowledge, you MUST label it explicitly ("Based on general knowledge..."). When asked to read, search, or check a book — ALWAYS use tools, never answer from memory alone.
- **Language**: Always respond in the language the user writes in. Even when discussing foreign-language books, your response body must be in the user's language. Brief original-language quotes are fine.
- **Identity**: You are a reading assistant. Maintain a professional tone. Do not roleplay as characters or adopt novelty voices unless the user explicitly asks.
- **Tool results are hidden**: The user CANNOT see tool inputs or outputs — only your response text. Never say "see above", "as shown in the search results", or reference tool output as if the user can read it. Include all relevant information directly in your response.
- **Conciseness**: Match response length to the question. For search results with many matches, show top 5-7 and summarize the rest.
- **Accuracy**: When organizing books into categories, verify facts before acting. If unsure about a book's genre, author nationality, or classification, say so rather than guessing wrong. Kafka is not English, Homer is not modern, etc.
- **Ambiguity**: When user instructions are vague ("make it cleaner", "organize"), explain your plan before executing. For clear instructions, act immediately.
- **LaTeX**: Use KaTeX-compatible syntax for math.

## IMPORTANT — follow strictly
- **Page references**: When citing pages, ALWAYS use [p.N] format (e.g. [p.42], [p.10-15]). These render as clickable navigation links. NEVER write "page 42", "стр. 42", "с. 42", "p.42" — ONLY [p.N].
  - CORRECT: "See [p.42]" / "Exercises on [p.22-25]" / "Перешёл на [p.10]"
  - WRONG: "page 42" / "стр. 22" / "p.42" / "страницу 10" / "(page 10)"
- **PDF vs printed page numbers**: Page numbers printed inside a book (e.g. in its table of contents) often do NOT match PDF page numbers. NEVER use printed page numbers in [p.N] links. Use search_book to find the actual PDF page number first, then reference that.
- **Book-specific instructions**: If a "Book-specific instructions" section appears below, follow it strictly — it overrides your default behavior for style, language, format, and tone.`;

// getBookPrompt / setBookPrompt are in settings.svelte.ts — use those

export { RECENT_MSG_COUNT, MAX_OLD_ASSISTANT_CHARS, MAX_OLD_USER_CHARS } from './constants';

/**
 * Render a Handlebars-style template with {{var}} and {{#block}}...{{/block}} syntax.
 */
export function renderPrompt(template: string, context: Record<string, string>): string {
  let result = template;
  for (const [key, val] of Object.entries(context)) {
    const blockRe = new RegExp(`\\{\\{#${key}\\}\\}([\\s\\S]*?)\\{\\{/${key}\\}\\}`, 'g');
    result = result.replace(blockRe, val ? '$1' : '');
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val || '');
  }
  return result.trim();
}

/**
 * Build API messages with context management:
 * 1. System prompt (always)
 * 2. Compacted summary of old conversation (if exists)
 * 3. Older messages with trimmed assistant responses
 * 4. Recent messages in full (last RECENT_MSG_COUNT)
 */
export function buildApiMessages(
  systemPrompt: string,
  messages: ChatMessage[],
  summary: string | null,
): ChatMessage[] {
  const convMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant');
  const result: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

  // Inject summary of compacted history
  if (summary) {
    result.push({ role: 'assistant', content: 'Previous conversation summary:\n' + summary });
  }

  // Split into recent (full) and older (trimmed)
  const recent = convMessages.slice(-RECENT_MSG_COUNT);
  const older = convMessages.slice(0, -RECENT_MSG_COUNT);

  // Trim older messages (both user and assistant)
  for (const m of older) {
    const limit = m.role === 'user' ? MAX_OLD_USER_CHARS : MAX_OLD_ASSISTANT_CHARS;
    if (m.content && m.content.length > limit) {
      result.push({ role: m.role, content: m.content.slice(0, limit) + '\n...[trimmed]' });
    } else {
      result.push({ role: m.role, content: m.content });
    }
  }

  // Recent messages in full
  for (const m of recent) {
    result.push({ role: m.role, content: m.content });
  }

  return result;
}

/**
 * Compact older messages into a summary via LLM call.
 * Returns new messages array and summary string.
 */
export async function compactMessages(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  existingSummary: string | null,
): Promise<{ messages: ChatMessage[]; summary: string }> {
  const convMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant');
  if (convMessages.length < MIN_MESSAGES_FOR_COMPACT) {
    return { messages, summary: existingSummary || '' };
  }

  // Split: summarize the older portion, keep recent verbatim
  const recent = convMessages.slice(-RECENT_MSG_COUNT);
  const older = convMessages.slice(0, -RECENT_MSG_COUNT);

  if (older.length < 2) {
    return { messages, summary: existingSummary || '' };
  }

  // Build summarization prompt
  const previousSummary = existingSummary
    ? `Previous summary:\n${existingSummary}\n\n`
    : '';
  const historyText = older.map(m => `${m.role}: ${m.content}`).join('\n\n');

  const compactPrompt: ChatMessage[] = [
    {
      role: 'system',
      content: `Summarize this reading assistant conversation into a structured reference.
Preserve ALL of:
- Page numbers and citations mentioned
- Key conclusions and analysis
- Book titles and IDs referenced
- Folder/library changes made
- Any specific facts or arguments discussed
Format as a bulleted list grouped by topic. Be specific, cite pages.
${previousSummary}Conversation to summarize:`,
    },
    { role: 'user', content: historyText },
  ];

  const data = await simpleLLMCall(apiKey, model, compactPrompt);
  const summary = data.choices?.[0]?.message?.content || '';
  if (!summary) throw new Error('Empty summary');

  // Keep only recent messages + a compaction notice
  const nonSystemRecent = convMessages.slice(-RECENT_MSG_COUNT);
  const newMessages: ChatMessage[] = [
    { role: 'system', content: `Conversation compacted (${older.length} messages summarized)` },
    ...nonSystemRecent,
  ];

  return { messages: newMessages, summary };
}
