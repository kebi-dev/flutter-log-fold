import { describe, it, expect } from 'vitest';
import { getDebugOutputText } from '../src/debugOutput';

describe('getDebugOutputText', () => {
  it('returns output text for any debug output category', () => {
    expect(getDebugOutputText({
      type: 'event',
      event: 'output',
      body: {
        output: 'telemetry-like output',
      },
    })).toBe('telemetry-like output');
  });

  it('ignores non-output events', () => {
    expect(getDebugOutputText({
      type: 'event',
      event: 'terminated',
      body: {
        output: 'ignored',
      },
    })).toBeNull();
  });

  it('ignores missing and empty output payloads', () => {
    expect(getDebugOutputText({
      type: 'event',
      event: 'output',
      body: {},
    })).toBeNull();

    expect(getDebugOutputText({
      type: 'event',
      event: 'output',
      body: {
        output: '',
      },
    })).toBeNull();
  });
});
