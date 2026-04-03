export interface Book {
  id: string;
  title: string;
  filename: string;
  data: ArrayBuffer | Blob;
  size: number;
  pages: string[] | null;
  folder_id: string | null;
  archived?: boolean;
  createdAt?: number;
}

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  createdAt?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
  _compressed?: boolean;
}

export interface ChatStats {
  inputTokens: number;
  outputTokens: number;
  cost: number;
  lastContextTokens: number;
  model: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: object;
  handler: (args: any) => Promise<string>;
}

export interface AgentCallbacks {
  onThinking?: (iteration: number) => void;
  onDelta?: (delta: string, fullContent: string) => void;
  onToolCall?: (name: string, args: any) => void;
  onToolResult?: (name: string, args: any, result: string) => void;
  onUsage?: (usage: any, model: string) => void;
}

export interface LibraryContext {
  page: number;
  totalPages: number;
  title: string;
  selection: string;
  time: string;
  pageText: string;
  pageHistory: string;
  libraryTree: string;
  focusContext: string;
  currentBookId: string;
  currentBookTitle: string;
  bookCount: number;
  folderCount: number;
  totalSize: number;
  totalPageCount: number;
}
