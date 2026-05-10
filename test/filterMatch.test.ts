import { describe, it, expect } from 'vitest';
import { matchesFilters, stripAnsi } from '../src/filterMatch';
import { LogEntry } from '../src/types';

function entry(partial: Partial<LogEntry> & Pick<LogEntry, 'id' | 'lines'>): LogEntry {
  return {
    type: 'plain',
    timestamp: '',
    summary: '',
    category: 'info',
    source: 'flutter',
    ...partial,
  } as LogEntry;
}

describe('stripAnsi', () => {
  it('removes ANSI SGR sequences like main.js', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
    expect(stripAnsi('no codes')).toBe('no codes');
  });
});

describe('matchesFilters', () => {
  it('matches flutter source regardless of showSystemLogs', () => {
    const e = entry({ id: 1, lines: ['hello'], source: 'flutter' });
    const chips = new Map<string, boolean>([['info', true]]);
    expect(matchesFilters(e, '', chips, false)).toBe(true);
    expect(matchesFilters(e, '', chips, true)).toBe(true);
  });

  it('hides system source unless showSystemLogs', () => {
    const e = entry({ id: 1, lines: ['sys'], source: 'system', category: 'info' });
    const chips = new Map<string, boolean>([['info', true]]);
    expect(matchesFilters(e, '', chips, false)).toBe(false);
    expect(matchesFilters(e, '', chips, true)).toBe(true);
  });

  it('treats missing category key as visible (get !== false)', () => {
    const e = entry({ id: 1, lines: ['x'], category: 'customTag', source: 'flutter' });
    const chips = new Map<string, boolean>([['all', true]]);
    expect(matchesFilters(e, '', chips, false)).toBe(true);
  });

  it('hides when category chip is explicitly false', () => {
    const e = entry({ id: 1, lines: ['x'], category: 'error', source: 'flutter' });
    const chips = new Map<string, boolean>([
      ['all', true],
      ['error', false],
    ]);
    expect(matchesFilters(e, '', chips, false)).toBe(false);
  });

  it('normalizes warning to warn', () => {
    const e = entry({ id: 1, lines: ['w'], category: 'warning', source: 'flutter' });
    const chipsWarnOn = new Map<string, boolean>([['warn', true]]);
    expect(matchesFilters(e, '', chipsWarnOn, false)).toBe(true);
    const chipsWarnOff = new Map<string, boolean>([['warn', false]]);
    expect(matchesFilters(e, '', chipsWarnOff, false)).toBe(false);
  });

  it('matches filter text on ANSI-stripped lowercase lines', () => {
    const e = entry({ id: 1, lines: ['\x1b[32mHello World\x1b[0m'], category: 'info', source: 'flutter' });
    const chips = new Map<string, boolean>([['info', true]]);
    expect(matchesFilters(e, 'hello world', chips, false)).toBe(true);
    expect(matchesFilters(e, 'missing', chips, false)).toBe(false);
  });

  it('empty filter text skips text constraint', () => {
    const e = entry({ id: 1, lines: ['anything'], category: 'debug', source: 'flutter' });
    const chips = new Map<string, boolean>([['debug', true]]);
    expect(matchesFilters(e, '', chips, false)).toBe(true);
  });

  it('defaults missing source to flutter (runtime)', () => {
    const base = entry({ id: 1, lines: ['a'], category: 'info' });
    const e = { ...base, source: undefined } as unknown as LogEntry;
    const chips = new Map<string, boolean>([['info', true]]);
    expect(matchesFilters(e, '', chips, false)).toBe(true);
  });
});
