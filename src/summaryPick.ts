/** Lines are Talker block content (cleaned, no box markers). */

const DEFAULT_MAX = 120;

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
}

/** Dart / Flutter stack frame start (#0, #1, …). */
export function isDartStackFrameLine(line: string): boolean {
  return /^\s*\#\d+\s/.test(line);
}

function isSeparatorLine(trimmed: string): boolean {
  // Talker separators, underline rows — no letters/digits
  if (trimmed.length === 0) {
    return true;
  }
  if (/[a-zA-Z0-9\u4e00-\u9fff]/.test(trimmed)) {
    return false;
  }
  return /^[\s│┃┆┇┊┋║═─\-_:.\u2500-\u257f]+$/.test(trimmed);
}

function isIso8601TimestampLine(trimmed: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d/.test(trimmed);
}

/**
 * Prefer human-readable log text over leading stack traces / separators / ISO lines.
 * For HTTP/Talker blocks without `#n` frames, keep the **first** line (legacy behavior).
 * When Dart stack frames exist, the real message is usually **after** the last `#n` line.
 */
export function pickBestSummaryLine(cleanedLines: string[], maxLen: number = DEFAULT_MAX): string {
  const trimmed = cleanedLines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (trimmed.length === 0) {
    return '(empty block)';
  }

  const anyStack = trimmed.some(isDartStackFrameLine);
  if (!anyStack) {
    for (const t of trimmed) {
      if (!isSeparatorLine(t)) {
        return truncate(t, maxLen);
      }
    }
    return truncate(trimmed[0], maxLen);
  }

  let lastStackIdx = -1;
  for (let i = 0; i < trimmed.length; i++) {
    if (isDartStackFrameLine(trimmed[i])) {
      lastStackIdx = i;
    }
  }

  const tail = lastStackIdx >= 0 ? trimmed.slice(lastStackIdx + 1) : trimmed;
  if (tail.length === 0) {
    return truncate(trimmed[0], maxLen);
  }

  for (let i = tail.length - 1; i >= 0; i--) {
    const t = tail[i];
    if (isDartStackFrameLine(t) || isSeparatorLine(t) || isIso8601TimestampLine(t)) {
      continue;
    }
    if (/\[[^\]]+\]/.test(t)) {
      return truncate(t, maxLen);
    }
    if (t.length >= 3) {
      return truncate(t, maxLen);
    }
  }

  for (const t of tail) {
    if (!isDartStackFrameLine(t) && !isSeparatorLine(t) && !isIso8601TimestampLine(t)) {
      return truncate(t, maxLen);
    }
  }

  return truncate(trimmed[0], maxLen);
}
