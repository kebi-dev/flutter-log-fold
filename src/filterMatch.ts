import { LogEntry } from './types';

const ANSI_ESCAPE = /\x1b\[[0-9;]*[a-zA-Z]/g;

/** Mirrors webview/main.js stripAnsi for search text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

function normalizeCategory(category: string): string {
  return category === 'warning' ? 'warn' : category;
}

/**
 * Mirrors applyFilters / applyFilterToElement in webview/main.js:
 * flutter entries always match source; system entries match when showSystemLogs;
 * category chip map treats missing key like active (get !== false);
 * text filter matches stripped-lowercase body (lines joined by newline).
 */
export function matchesFilters(
  entry: LogEntry,
  filterTextLower: string,
  activeCategories: Map<string, boolean>,
  showSystemLogs: boolean,
): boolean {
  const source = entry.source ?? 'flutter';
  const category = normalizeCategory(entry.category || 'info');

  const sourceMatch = source === 'flutter' || showSystemLogs;
  const categoryMatch = activeCategories.get(category) !== false;
  const rawText = (entry.lines ?? []).join('\n');
  const searchText = stripAnsi(rawText).toLowerCase();
  const textMatch = !filterTextLower || searchText.includes(filterTextLower);

  return sourceMatch && categoryMatch && textMatch;
}
