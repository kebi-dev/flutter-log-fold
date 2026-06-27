import * as vscode from 'vscode';
import { LogParser } from './LogParser';
import { LogPanelProvider } from './LogPanelProvider';
import { LogViewerCoordinator } from './logViewerCoordinator';
import { buildLogViewerHtml } from './logViewerHtml';
import { BlockPatterns, ParserSettings, PRESETS } from './types';

let coordinator: LogViewerCoordinator;
let parser: LogParser;

export function activate(context: vscode.ExtensionContext) {
  coordinator = new LogViewerCoordinator();
  const patterns = resolvePatterns();
  const lineStripPattern = vscode.workspace.getConfiguration('flutterLogFold').get<string>('lineStripPattern', '');

  parser = new LogParser(patterns, lineStripPattern, resolveParserSettings(), (entry) => {
    coordinator.addEntry(entry);
  });

  coordinator.setKnownTagsGetter(() => parser.getKnownTags());

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      LogPanelProvider.viewType,
      new LogPanelProvider(context.extensionUri, coordinator),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flutterLogFold.show', () => showMainLogView()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flutterLogFold.clear', () => {
      coordinator.clearAll();
    }),
  );

  let activeViewerPanels = 0;

  context.subscriptions.push(
    vscode.commands.registerCommand('flutterLogFold.newViewer', () => {
      const config = vscode.workspace.getConfiguration('flutterLogFold');
      const maxPanels = config.get<number>('maxViewerPanels', 10);
      if (activeViewerPanels >= maxPanels) {
        void vscode.window.showWarningMessage(
          `Maximum number of Flutter log viewer panels (${maxPanels}) reached. Increase flutterLogFold.maxViewerPanels to open more.`,
        );
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        'flutterLogFold.viewer',
        'Flutter Logs',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview')],
        },
      );

      panel.webview.html = buildLogViewerHtml(panel.webview, context.extensionUri);

      activeViewerPanels++;
      const registration = coordinator.registerWebview(panel.webview);
      const bridge = coordinator.attachMessageBridge(panel.webview);

      panel.onDidDispose(() => {
        activeViewerPanels--;
        bridge.dispose();
        registration.dispose();
      });
    }),
  );

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterTrackerFactory('dart', {
      createDebugAdapterTracker(session: vscode.DebugSession) {
        const autoOpen = vscode.workspace.getConfiguration('flutterLogFold').get<boolean>('autoOpen', true);
        if (autoOpen) {
          void showMainLogView();
        }

        return {
          onDidSendMessage(message: any) {
            if (
              message.type === 'event' &&
              message.event === 'output' &&
              message.body?.output
            ) {
              const category = message.body.category as string | undefined;
              // Include missing / important — Dart adapter sometimes omits category on tooling lines.
              if (
                category === undefined ||
                category === '' ||
                category === 'stdout' ||
                category === 'stderr' ||
                category === 'console' ||
                category === 'important'
              ) {
                parser.processOutput(message.body.output);
              }
            }
          },
        };
      },
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('flutterLogFold')) {
        const newPatterns = resolvePatterns();
        const newLineStrip = vscode.workspace.getConfiguration('flutterLogFold').get<string>('lineStripPattern', '');
        parser.updatePatterns(newPatterns, newLineStrip);
        parser.updateSettings(resolveParserSettings());
        coordinator.updateSettings();
      }
    }),
  );
}

async function showMainLogView(): Promise<void> {
  await vscode.commands.executeCommand('workbench.view.extension.flutterLogFold');
  await vscode.commands.executeCommand('flutterLogFold.logView.focus');
}

function resolvePatterns(): BlockPatterns {
  const config = vscode.workspace.getConfiguration('flutterLogFold');
  const preset = config.get<string>('preset', 'talker');

  if (preset !== 'custom' && PRESETS[preset]) {
    return PRESETS[preset];
  }

  const blockStart = config.get<string>('blockStart', '┌──');
  const blockEnd = config.get<string>('blockEnd', '└──');
  const blockContentPrefix = config.get<string>('blockContentPrefix', '│');

  return {
    blockStart: blockStart || '┌──',
    blockEnd: blockEnd || '└──',
    blockContentPrefix: blockContentPrefix || '│',
  };
}

function resolveParserSettings(): ParserSettings {
  const config = vscode.workspace.getConfiguration('flutterLogFold');
  return {
    talkerBlocFormat: config.get<boolean>('talkerBlocFormat', true),
    talkerRouteFormat: config.get<boolean>('talkerRouteFormat', true),
    talkerStripTimestamp: config.get<boolean>('talkerStripTimestamp', true),
    maxBlockLines: config.get<number>('maxBlockLines', 50000),
  };
}

export function deactivate() {
  parser?.flush();
}