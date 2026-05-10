import { describe, it, expect } from 'vitest';
import { pickBestSummaryLine, isDartStackFrameLine } from '../src/summaryPick';

describe('summaryPick', () => {
  it('detects Dart stack frame lines', () => {
    expect(isDartStackFrameLine('#0 foo (package:a/b.dart:1:2)')).toBe(true);
    expect(isDartStackFrameLine('  #12 bar')).toBe(true);
    expect(isDartStackFrameLine('hello')).toBe(false);
  });

  it('prefers human message after stack and separators', () => {
    const lines = [
      '#0 closure (package:auth/src/ws.dart:53:20)',
      '#1 async (dart:async/future.dart:1:1)',
      '────────────────────',
      '2024-05-10T16:22:24.439+09:00',
      '[ws] 登录完成',
    ];
    expect(pickBestSummaryLine(lines, 200)).toContain('[ws]');
    expect(pickBestSummaryLine(lines, 200)).toContain('登录');
  });

  it('uses first non-meta line when no trailing message', () => {
    const lines = ['────────────────', 'Something happened'];
    expect(pickBestSummaryLine(lines, 120)).toBe('Something happened');
  });

  it('falls back to first line when everything looks like stack', () => {
    const lines = ['#0 only (package:x/y.dart:1:1)'];
    expect(pickBestSummaryLine(lines, 120)).toContain('#0');
  });
});
