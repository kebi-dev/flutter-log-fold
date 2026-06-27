# Flutter Log Fold — Agent Guide

## Mission

Build and maintain a VS Code extension that makes Flutter debug logs readable by folding noisy multi-line blocks, preserving signal, and keeping performance stable during long debug sessions.

## Tech Stack

- TypeScript (strict mode)
- VS Code extension host APIs
- Webview UI (`webview/`)
- Build: `esbuild`
- Tests: `vitest`

## Repo Map

- `src/extension.ts`: activation, command wiring, debug stream integration
- `src/parser/`: line parsing, block detection, formatter integration
- `src/formatters/`: Talker and tag-based summary formatting
- `webview/`: log viewer UI, filters, JSON tree, ANSI rendering
- `test/`: parser and behavior tests

## Working Rules

1. Preserve existing behavior unless a change is explicitly requested.
2. Keep parsing and formatting logic deterministic and testable.
3. Avoid expensive per-line work in hot paths (debug stream can be high volume).
4. Keep settings backward compatible under `flutterLogFold.*`.
5. For feature work, add/adjust tests in `test/` that cover edge cases.

## Local Commands

- Install deps: `npm install`
- Type check: `npm run typecheck`
- Build: `npm run build`
- Test: `npm run test`
- Package VSIX: `npm run package`

## PR Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] Settings/docs updated when behavior changes
- [ ] No unrelated refactors bundled with feature/fix
