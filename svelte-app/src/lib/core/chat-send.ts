// Shared sendChatMessage function — used by both LibraryApp and ViewerApp

import type { ChatMessage } from '../types';
import { settings } from '../state/settings.svelte';
import type { ChatState } from '../state/chat.svelte';
import { buildLibraryContext } from './tools';
import { agentLoop } from './agent';
import { buildApiMessages } from './prompt';
import { humanizeToolAction } from './ui-helpers';

export interface SendChatConfig {
  /** Build the system prompt from library context */
  buildSystemPrompt: (context: any) => string;
  /** localStorage key for saving chat (e.g. '_library' or bookId) */
  storageKey: string;
  /** Called before the agent loop (e.g. to clear cached selection) */
  onBeforeSend?: () => void;
  /** Called after a successful agent loop (e.g. to refresh library) */
  onAfterSend?: () => void | Promise<void>;
  /** Whether to add a tool activity summary message after tool calls */
  addToolSummary?: boolean;
}

export async function sendChatMessage(
  chatState: ChatState,
  text: string,
  config: SendChatConfig,
): Promise<void> {
  if (!settings.apiKey) {
    alert('Set your OpenRouter API key in Settings first.');
    return;
  }

  chatState.addMessage({ role: 'user', content: text });
  chatState.setSending(true);
  chatState.resetToolActivity();

  try {
    const context = await buildLibraryContext();
    config.onBeforeSend?.();

    const system = config.buildSystemPrompt(context);
    const apiMessages = buildApiMessages(system, chatState.messages, chatState.summary);

    const result = await agentLoop(settings.apiKey, settings.model, apiMessages as ChatMessage[], {
      onDelta: (_delta: string, full: string) => {
        chatState.handleDelta(full);
      },
      onToolCall: (name: string, args: any) => {
        chatState.addToolActivity(humanizeToolAction(name, args));
      },
      onThinking: () => {},
      onUsage: (usage: any, model: string) => {
        chatState.trackUsage(usage, model);
      },
    });

    // Finalize tool activity as a system message if configured
    if (config.addToolSummary && chatState.toolActivity.length > 0) {
      const ta = chatState.toolActivity;
      const summary = ta.length <= 2
        ? ta.join(' -> ')
        : `${ta[0]} -> ... -> ${ta[ta.length - 1]} (${ta.length} steps)`;
      chatState.addMessage({ role: 'system', content: summary });
    }
    chatState.resetToolActivity();

    // Ensure final content is present.
    // handleDelta already created the assistant message during streaming.
    // Only add/update if streaming didn't produce a message.
    if (result.content) {
      const msgs = chatState.messages;
      const hasAssistantMsg = msgs.some(m => m.role === 'assistant');
      if (!hasAssistantMsg) {
        chatState.addMessage({ role: 'assistant', content: result.content });
      }
    }

    await config.onAfterSend?.();
  } catch (err: any) {
    chatState.addMessage({ role: 'system', content: 'Error: ' + err.message });
  }

  chatState.setSending(false);
  chatState.resetToolActivity();
  chatState.saveToStorage(config.storageKey);
}
