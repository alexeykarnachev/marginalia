// Shared UI helper functions (non-reactive)

export function humanizeToolAction(name: string, args: Record<string, any>): string {
  switch (name) {
    case 'read_page': return `Reading page ${args.page}...`;
    case 'read_pages': return `Reading pages ${args.from}-${args.to}...`;
    case 'search_book': return `Searching for "${args.query}"...`;
    case 'search_all_books': return `Searching all books for "${args.query}"...`;
    case 'go_to_page': return `Going to page ${args.page}...`;
    case 'go_back': return 'Going back...';
    case 'open_book': return 'Opening book...';
    case 'get_table_of_contents': return 'Getting table of contents...';
    case 'rename_book': return `Renaming to "${args.new_title}"...`;
    case 'move_book': return 'Moving book...';
    case 'delete_book': return 'Deleting book...';
    case 'create_folder': return `Creating folder "${args.name}"...`;
    case 'rename_folder': return `Renaming folder to "${args.new_name}"...`;
    case 'delete_folder': return 'Deleting folder...';
    case 'move_folder': return 'Moving folder...';
    case 'batch_move_books': return `Moving ${args.book_ids?.length || '?'} books...`;
    case 'batch_rename_books': return `Renaming ${args.renames?.length || '?'} books...`;
    default: return `${name}...`;
  }
}
