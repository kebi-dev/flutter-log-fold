import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LogParser } from '../src/LogParser';
import { LogEntry, BlockPatterns, ParserSettings, PRESETS } from '../src/types';

// ── Helpers ──────────────────────────────────────────────────────────

const TALKER: BlockPatterns = PRESETS.talker;
const PRETTY: BlockPatterns = PRESETS.pretty;

const DEFAULT_SETTINGS: ParserSettings = {
  talkerBlocFormat: true,
  talkerRouteFormat: true,
  talkerStripTimestamp: true,
  maxBlockLines: 50_000,
};

function collect(
  patterns = TALKER,
  lineStrip = '',
  settings = DEFAULT_SETTINGS,
): { entries: LogEntry[]; parser: LogParser } {
  const entries: LogEntry[] = [];
  const parser = new LogParser(patterns, lineStrip, settings, (e) => entries.push(e));
  return { entries, parser };
}

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf-8');
}

// ── 1. ANSI normalization ────────────────────────────────────────────

describe('ANSI normalization', () => {
  it('converts macOS literal \\^[ to real ESC byte', () => {
    const { entries, parser } = collect();
    // \\^[ is how macOS debug adapter sends ESC
    parser.processOutput('\\^[[31mred text\\^[[0m\n');
    parser.flush();

    expect(entries).toHaveLength(1);
    // detectLine should have ANSI stripped
    expect(entries[0].summary).toBe('red text');
    // displayLine should have real ANSI codes
    expect(entries[0].lines[0]).toContain('\x1b[31m');
  });

  it('strips ANSI from detectLine but preserves in displayLine', () => {
    const { entries, parser } = collect();
    parser.processOutput('\x1b[32mgreen output\x1b[0m\n');
    parser.flush();

    expect(entries).toHaveLength(1);
    expect(entries[0].summary).toBe('green output');
    expect(entries[0].lines[0]).toContain('\x1b[32m');
  });
});

// ── 2. Source detection ──────────────────────────────────────────────

describe('source detection', () => {
  it('detects I/flutter prefix as source=flutter', () => {
    const { entries, parser } = collect();
    parser.processOutput('I/flutter ( 1234): hello world\n');
    expect(entries[0].source).toBe('flutter');
    expect(entries[0].summary).toBe('hello world');
  });

  it('detects I/SomeTag prefix as source=system', () => {
    const { entries, parser } = collect();
    parser.processOutput('I/SomeTag ( 1234): system message\n');
    expect(entries[0].source).toBe('system');
  });

  it('detects flutter: prefix as source=flutter', () => {
    const { entries, parser } = collect();
    parser.processOutput('flutter: ios message\n');
    expect(entries[0].source).toBe('flutter');
    expect(entries[0].summary).toBe('ios message');
  });

  it('detects plain text as source=system', () => {
    const { entries, parser } = collect();
    parser.processOutput('plain text line\n');
    expect(entries[0].source).toBe('system');
  });

  it('treats Flutter launch / build tooling lines as source=flutter (visible without SYS)', () => {
    const { entries, parser } = collect();
    parser.processOutput('Launching lib/main.dart on Pixel 6a in debug mode...\n');
    parser.processOutput('✓ Built build/app/outputs/flutter-apk/app-debug.apk\n');
    expect(entries).toHaveLength(2);
    expect(entries[0].source).toBe('flutter');
    expect(entries[0].summary).toContain('Launching lib/main.dart');
    expect(entries[1].source).toBe('flutter');
    expect(entries[1].summary).toContain('Built build/app');
  });
});

// ── 3. Block detection ───────────────────────────────────────────────

describe('block detection', () => {
  it('collects lines between ┌── and └── into a single block entry', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      '┌──────────\n│ line 1\n│ line 2\n└──────────\n',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('talker-block');
  });

  it('detects pretty preset (╔══/╚══) blocks', () => {
    const { entries, parser } = collect(PRETTY);
    parser.processOutput(
      '╔══════════\n║ request data\n╚══════════\n',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('talker-block');
  });

  it('flushes incomplete block on flush()', () => {
    const { entries, parser } = collect();
    parser.processOutput('┌──────────\n│ content\n');
    expect(entries).toHaveLength(0);
    parser.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('talker-block');
  });

  it('emits previous block when new block starts', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      '┌──────────\n│ block 1\n┌──────────\n│ block 2\n└──────────\n',
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe('talker-block');
    expect(entries[1].type).toBe('talker-block');
  });

  it('force-emits block when maxBlockLines exceeded', () => {
    const settings: ParserSettings = { ...DEFAULT_SETTINGS, maxBlockLines: 3 };
    const { entries, parser } = collect(TALKER, '', settings);
    // Start block + 3 content lines = 4 lines total, exceeds maxBlockLines=3
    parser.processOutput(
      '┌──────────\n│ line1\n│ line2\n│ line3\n│ line4\n',
    );
    // Block force-emitted at boundary; │line4 arrives after reset → plain
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe('talker-block');
    expect(entries[1].type).toBe('plain');
  });
});

// ── 4. Marker line recognition ───────────────────────────────────────

describe('marker line recognition', () => {
  it('excludes ┌────── from content lines', () => {
    const { entries, parser } = collect();
    parser.processOutput('┌──────────\n│ content\n└──────────\n');
    expect(entries[0].lines).not.toContainEqual(
      expect.stringContaining('┌──'),
    );
  });

  it('excludes └────── from content lines', () => {
    const { entries, parser } = collect();
    parser.processOutput('┌──────────\n│ content\n└──────────\n');
    // display lines should not include the end marker
    expect(entries[0].lines).not.toContainEqual(
      expect.stringContaining('└──'),
    );
  });

  it('handles [Talker] ┌────── as marker (macOS fix)', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      '[Talker] ┌──────────\n[Talker] │ [info] | 10:00:00 1ms | hello\n[Talker] └──────────\n',
    );
    // The block start line with [Talker] prefix should be treated as marker
    // and excluded from cleaned content lines
    expect(entries).toHaveLength(1);
    // content should not have separator dashes as summary
    expect(entries[0].summary).not.toMatch(/^[-─]+$/);
  });

  it('handles [SomeTag] ┌────── as marker (any tag prefix)', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      '[SomeTag] ┌──────────\n│ content here\n└──────────\n',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].summary).toBe('content here');
  });

  it('includes │ content lines (not markers)', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      '┌──────────\n│ actual content\n└──────────\n',
    );
    expect(entries[0].summary).toContain('actual content');
  });
});

// ── 5. Block content cleaning ────────────────────────────────────────

describe('block content cleaning', () => {
  it('strips │ prefix from content lines', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      '┌──────────\n│ my content\n└──────────\n',
    );
    // The cleaned detect line feeds into summary
    expect(entries[0].summary).toBe('my content');
  });

  it('strips indented │ prefix', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      '┌──────────\n         │ indented content\n└──────────\n',
    );
    expect(entries[0].summary).toBe('indented content');
  });

  it('preserves ANSI codes in display lines', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      '┌──────────\n\x1b[31m│ red content\x1b[0m\n└──────────\n',
    );
    // display lines keep ANSI
    const displayLine = entries[0].lines[0];
    expect(displayLine).toContain('\x1b[31m');
  });
});

// ── 6. Summary generation ────────────────────────────────────────────

describe('summary generation', () => {
  it('uses talkerDefault fallback: [info] | HH:MM:SS ms | message → [info] message', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      '┌──────────\n│ [info] | 10:47:20 258ms | App init\n└──────────\n',
    );
    expect(entries[0].summary).toBe('[info] App init');
  });

  it('formats bloc-transition blocks', () => {
    const { entries, parser } = collect();
    parser.processOutput(fixture('bloc-transition.txt'));
    const transition = entries.find((e) => e.summary.includes('bloc-transition'));
    expect(transition).toBeDefined();
    expect(transition!.summary).toBe(
      '[bloc-transition] CounterCubit | CounterState(count: 0) -> CounterState(count: 1)',
    );
  });

  it('falls back to extractSummary when no tag on first line', () => {
    const { entries, parser } = collect();
    parser.processOutput('┌──────────\n│ just some text\n└──────────\n');
    expect(entries[0].summary).toBe('just some text');
  });

  it('returns (empty block) for all-empty content', () => {
    const { entries, parser } = collect();
    // Block with only markers and whitespace content
    parser.processOutput('┌──────────\n│ \n│  \n└──────────\n');
    expect(entries[0].summary).toBe('(empty block)');
  });

  it('truncates long lines to 120 chars + ...', () => {
    const { entries, parser } = collect();
    const longText = 'A'.repeat(200);
    parser.processOutput(`┌──────────\n│ ${longText}\n└──────────\n`);
    expect(entries[0].summary).toHaveLength(123); // 120 + '...'
    expect(entries[0].summary).toMatch(/\.\.\.$/);
  });
});

// ── 7. Category detection ────────────────────────────────────────────

describe('category detection', () => {
  it('[info] tag → category=info', () => {
    const { entries, parser } = collect();
    parser.processOutput('┌──────────\n│ [info] | 10:00:00 1ms | msg\n└──────────\n');
    expect(entries[0].category).toBe('info');
  });

  it('[error] tag → category=error', () => {
    const { entries, parser } = collect();
    parser.processOutput('┌──────────\n│ [error] | 10:00:00 1ms | fail\n└──────────\n');
    expect(entries[0].category).toBe('error');
  });

  it('[bloc-transition] tag → category=bloc (Talker base before hyphen)', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      '┌──────────\n│ [bloc-transition] | 10:00:00 1ms |\n│ X changed\n│ CURRENT state: A\n│ NEXT state: B\n└──────────\n',
    );
    expect(entries[0].category).toBe('bloc');
    expect(parser.getKnownTags()).toContain('bloc');
  });

  it('{{H5 参数}} tag → dynamic category with normalized key', () => {
    const { entries, parser } = collect();
    parser.processOutput('{{H5 参数}} key=value\n');
    expect(entries[0].category).toBe('h5_参数');
    expect(parser.getKnownTags()).toContain('h5_参数');
  });

  it('plain: explicit tag category kept when lineStripPattern strips the tag token', () => {
    const { entries, parser } = collect(TALKER, '\\{\\{GoRouter\\}\\}');
    parser.processOutput('{{GoRouter}} hello\n');
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('gorouter');
  });

  it('block: explicit tag on 2nd content line still sets dynamic category', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      '┌──────────\n│ \n│  {{logpath}} routed request\n└──────────\n',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('logpath');
    expect(parser.getKnownTags()).toContain('logpath');
  });

  it('plain: GoRouter-style tree lines inherit prior {{GoRouter}} category', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      '  {{GoRouter}} setting initial location /login_page\n' +
        '  {{GoRouter}} Full paths for routes:\n' +
        '├─/ (Widget)\n' +
        '│ └─/login_page (Widget)\n',
    );
    expect(entries).toHaveLength(4);
    entries.forEach((e) => expect(e.category).toBe('gorouter'));
    expect(parser.getKnownTags()).toContain('gorouter');
  });

  it('plain: multiple explicit tags on one line — last non-severity wins (GoRouter after UrlParser)', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      '  {{UrlParser}}  {{GoRouter}} setting initial location /login_page\n',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('gorouter');
    expect(parser.getKnownTags()).toContain('gorouter');
    expect(parser.getKnownTags()).toContain('urlparser');
  });

  it('plain: bracketed list literal is not treated as a dynamic tag', () => {
    const { entries, parser } = collect();
    parser.processOutput('goodRoadTypeList=[1, 2, 3] {{GoRouter}} location update\n');
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('info');
    expect(parser.getKnownTags()).not.toContain('gorouter');
    expect(parser.getKnownTags()).not.toContain('1,_2,_3');
  });

  it('plain: mid-line double-brace payload is not treated as a dynamic tag', () => {
    const { entries, parser } = collect();
    parser.processOutput('payload {{GoRouter}} should stay plain\n');
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('info');
    expect(parser.getKnownTags()).not.toContain('gorouter');
  });

  it('plain: line-start double-brace tag without leading whitespace is treated as a dynamic tag', () => {
    const { entries, parser } = collect();
    parser.processOutput('{{GoRouter}} should be tagged\n');
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('gorouter');
    expect(parser.getKnownTags()).toContain('gorouter');
  });

  it('plain: bracketed payload without leading whitespace is not treated as a tag', () => {
    const { entries, parser } = collect();
    parser.processOutput('payload[not-a-tag] still plain\n');
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('info');
    expect(parser.getKnownTags()).not.toContain('not-a-tag');
  });

  it('plain: single-bracket tag no longer counts as a dynamic tag', () => {
    const { entries, parser } = collect();
    parser.processOutput('[GoRouter] hello\n');
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('info');
    expect(parser.getKnownTags()).not.toContain('gorouter');
  });

  it('plain: ASCII-pipe prefixed tree lines inherit {{GoRouter}} category', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      '  {{GoRouter}} Full paths for routes:\n' +
        '| ├─/ (Widget)\n' +
        '| └─/login_page (Widget)\n',
    );
    expect(entries).toHaveLength(3);
    entries.forEach((e) => expect(e.category).toBe('gorouter'));
  });

  it('plain: "| #n stack" lines do not inherit {{GoRouter}}; sticky tag clears', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      '  {{GoRouter}} msg\n' +
        '| #1 StatefulElement.build (framework.dart:1:1)\n' +
        'plain after stack\n',
    );
    expect(entries).toHaveLength(3);
    expect(entries[0].category).toBe('gorouter');
    expect(entries[1].category).not.toBe('gorouter');
    expect(entries[2].category).toBe('info');
  });

  it('CRITICAL keyword → category=critical', () => {
    const { entries, parser } = collect();
    parser.processOutput('CRITICAL error in system\n');
    expect(entries[0].category).toBe('critical');
  });

  it('Exception keyword → category=error', () => {
    const { entries, parser } = collect();
    parser.processOutput('Exception thrown during build\n');
    expect(entries[0].category).toBe('error');
  });

  it('WARNING keyword → category=warn', () => {
    const { entries, parser } = collect();
    parser.processOutput('WARNING: low memory\n');
    expect(entries[0].category).toBe('warn');
  });

  it('plain line no tag → category=info (default)', () => {
    const { entries, parser } = collect();
    parser.processOutput('just a normal log line\n');
    expect(entries[0].category).toBe('info');
  });
});

// ── 8. Platform fixtures (end-to-end) ────────────────────────────────

describe('platform fixtures', () => {
  it('Android fixture: all blocks parsed, source=flutter, correct summaries', () => {
    const { entries, parser } = collect();
    parser.processOutput(fixture('android-talker.txt'));

    // 3 blocks
    expect(entries).toHaveLength(3);
    entries.forEach((e) => {
      expect(e.source).toBe('flutter');
      expect(e.type).toBe('talker-block');
    });

    expect(entries[0].summary).toBe('[info] App initialized');
    expect(entries[1].summary).toBe('[error] Network timeout');
    expect(entries[2].summary).toBe(
      '[bloc-transition] AuthCubit | Unauthenticated -> Authenticated',
    );
  });

  it('macOS fixture: [Talker] only on first line, content properly cleaned', () => {
    const { entries, parser } = collect();
    parser.processOutput(fixture('macos-talker.txt'));

    expect(entries).toHaveLength(3);
    entries.forEach((e) => expect(e.type).toBe('talker-block'));

    // [Talker] only appears on the ┌ marker line (skipped by isMarkerLine).
    // Content lines have spaces before │ → prefix stripped normally.
    // talkerDefault strips timestamp from [info]/[debug] headers.
    expect(entries[0].summary).toBe('[info] App started on macOS');
    expect(entries[1].summary).toBe('[debug] Route changed');
    // [http-response] has no timestamp pattern → extractSummary fallback
    expect(entries[2].summary).toBe('[http-response] [POST] https://api.demo.net/oauth/token');
  });

  it('iOS fixture: flutter: stripped, source=flutter, correct summaries', () => {
    const { entries, parser } = collect();
    parser.processOutput(fixture('ios-talker.txt'));

    expect(entries).toHaveLength(2);
    entries.forEach((e) => {
      expect(e.source).toBe('flutter');
      expect(e.type).toBe('talker-block');
    });

    expect(entries[0].summary).toBe('[info] App started on iOS');
    expect(entries[1].summary).toBe('[warn] Low memory warning');
  });

  it('pretty-dio fixture: both blocks parsed, correct summaries', () => {
    const { entries, parser } = collect(PRETTY);
    parser.processOutput(fixture('pretty-dio.txt'));
    expect(entries).toHaveLength(2);
    entries.forEach((e) => expect(e.type).toBe('talker-block'));
    expect(entries[0].summary).toBe('Request: GET https://api.example.com/users');
    expect(entries[1].summary).toBe('Response: 200 OK');
  });
});

// ── 9. lineStripPattern ──────────────────────────────────────────────

describe('lineStripPattern', () => {
  it('custom regex strips prefix from detectLine', () => {
    const { entries, parser } = collect(TALKER, '^\\[\\d+\\]\\s*');
    parser.processOutput('[12345] some log message\n');
    expect(entries[0].summary).toBe('some log message');
  });

  it('invalid regex → no crash, no stripping', () => {
    const { entries, parser } = collect(TALKER, '([invalid');
    parser.processOutput('normal line\n');
    expect(entries).toHaveLength(1);
    expect(entries[0].summary).toBe('normal line');
  });
});

// ── 10. Block interruption ───────────────────────────────────────────

describe('block interruption', () => {
  it('system log line mid-block emitted as separate plain entry', () => {
    const { entries, parser } = collect();
    parser.processOutput(
      'I/flutter ( 1234): ┌──────────\n' +
      'I/flutter ( 1234): │ content\n' +
      'W/BillingClient( 5678): billing check\n' +
      'I/flutter ( 1234): │ more content\n' +
      'I/flutter ( 1234): └──────────\n',
    );

    // Should have the system line as plain + the block
    const plainEntries = entries.filter((e) => e.type === 'plain');
    const blockEntries = entries.filter((e) => e.type === 'talker-block');

    expect(plainEntries).toHaveLength(1);
    expect(plainEntries[0].source).toBe('system');

    expect(blockEntries).toHaveLength(1);
    expect(blockEntries[0].source).toBe('flutter');
  });
});

// ── 11. Plain lines ──────────────────────────────────────────────────

describe('plain lines', () => {
  it('line outside block → type=plain', () => {
    const { entries, parser } = collect();
    parser.processOutput('standalone log message\n');
    expect(entries[0].type).toBe('plain');
    expect(entries[0].summary).toBe('standalone log message');
  });

  it('long plain line → summary truncated', () => {
    const { entries, parser } = collect();
    const longLine = 'X'.repeat(200);
    parser.processOutput(longLine + '\n');
    expect(entries[0].summary).toHaveLength(123);
    expect(entries[0].summary).toMatch(/\.\.\.$/);
  });

  it('preserves blank lines between log lines', () => {
    const { entries, parser } = collect();
    parser.processOutput('first line\n\nthird line\n');
    expect(entries).toHaveLength(3);
    expect(entries[0].summary).toBe('first line');
    expect(entries[1].summary).toBe('');
    expect(entries[1].lines).toEqual(['']);
    expect(entries[2].summary).toBe('third line');
  });

  it('buffers partial plain lines across output chunks', () => {
    const { entries, parser } = collect();
    parser.processOutput('partial');
    expect(entries).toHaveLength(0);
    parser.processOutput(' line\nnext line\n');
    expect(entries).toHaveLength(2);
    expect(entries[0].summary).toBe('partial line');
    expect(entries[1].summary).toBe('next line');
  });

  it('flush emits a final partial line without trailing newline', () => {
    const { entries, parser } = collect();
    parser.processOutput('last line without newline');
    expect(entries).toHaveLength(0);
    parser.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0].summary).toBe('last line without newline');
  });

  it('buffers partial block content across output chunks', () => {
    const { entries, parser } = collect();
    parser.processOutput('┌──────────\n│ hello');
    expect(entries).toHaveLength(0);
    parser.processOutput(' world\n└──────────\n');
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('talker-block');
    expect(entries[0].summary).toBe('hello world');
  });
});

// ── 12. updatePatterns / updateSettings ──────────────────────────────

describe('updatePatterns / updateSettings', () => {
  it('switch preset mid-stream → new patterns used', () => {
    const { entries, parser } = collect(TALKER);
    // First block with talker preset
    parser.processOutput('┌──────────\n│ talker block\n└──────────\n');
    expect(entries).toHaveLength(1);

    // Switch to pretty preset
    parser.updatePatterns(PRETTY, '');
    parser.processOutput('╔══════════\n║ pretty block\n╚══════════\n');
    expect(entries).toHaveLength(2);
    expect(entries[1].summary).toBe('pretty block');
  });

  it('disable bloc formatters → bloc blocks use extractSummary/fallback', () => {
    const { entries, parser } = collect();

    // Disable bloc formatters
    parser.updateSettings({
      ...DEFAULT_SETTINGS,
      talkerBlocFormat: false,
    });

    parser.processOutput(
      '┌──────────\n│ [bloc-transition] | 10:00:00 1ms |\n│ X changed\n│ CURRENT state: A\n│ NEXT state: B\n└──────────\n',
    );

    // Without bloc formatter, falls back to talkerDefault which strips timestamp
    expect(entries[0].summary).not.toContain('CounterCubit |');
    // Should use talkerDefault fallback: [bloc-transition]
    expect(entries[0].summary).toBe('[bloc-transition]');
  });
});
