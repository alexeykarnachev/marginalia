export interface ChatMenuActions {
  editBookPrompt?: () => void;
  editChatPrompt?: () => void;
  configureTools: () => void;
  compact: () => void;
}

export interface ChatMenuItem {
  label: string;
  onClick: () => void;
}

export function buildChatMenuItems(actions: ChatMenuActions): ChatMenuItem[] {
  const items: ChatMenuItem[] = [];

  if (actions.editBookPrompt) {
    items.push({ label: 'Edit book prompt', onClick: actions.editBookPrompt });
  }
  if (actions.editChatPrompt) {
    items.push({ label: 'Edit chat prompt', onClick: actions.editChatPrompt });
  }

  items.push({ label: 'Configure tools', onClick: actions.configureTools });
  items.push({ label: 'Compact', onClick: actions.compact });
  return items;
}
