import * as vscode from 'vscode';
import { LogEntry, ExtensionToWebviewMessage } from './types';

/**
 * Owns the log buffer and broadcasts ExtensionToWebviewMessage payloads to every
 * registered webview (sidebar + editor panels).
 */
export class LogViewerCoordinator {
  private buffer: LogEntry[] = [];
  private maxLogs: number;
  private collapseByDefault: boolean;
  private knownTagsGetter?: () => string[];
  private readonly webviews = new Set<vscode.Webview>();

  constructor() {
    const config = vscode.workspace.getConfiguration('flutterLogFold');
    this.maxLogs = config.get<number>('maxLogs', 500);
    this.collapseByDefault = config.get<boolean>('collapseByDefault', true);
  }

  setKnownTagsGetter(getter: () => string[]): void {
    this.knownTagsGetter = getter;
  }

  /** Same payload sequence as the webview `ready` handler: settings, then optional full batch. */
  replayState(webview: vscode.Webview): void {
    void webview.postMessage({
      command: 'settings',
      collapseByDefault: this.collapseByDefault,
      maxLogs: this.maxLogs,
    } satisfies ExtensionToWebviewMessage);
    if (this.buffer.length > 0) {
      void webview.postMessage({
        command: 'batch',
        entries: [...this.buffer],
        knownTags: this.knownTagsGetter?.(),
      } satisfies ExtensionToWebviewMessage);
    }
  }

  registerWebview(webview: vscode.Webview): vscode.Disposable {
    this.webviews.add(webview);
    this.replayState(webview);
    return new vscode.Disposable(() => {
      this.webviews.delete(webview);
    });
  }

  attachMessageBridge(webview: vscode.Webview): vscode.Disposable {
    return webview.onDidReceiveMessage((message: { command?: string }) => {
      if (message.command === 'ready') {
        this.replayState(webview);
      }
      if (message.command === 'clear') {
        this.clearAll();
      }
    });
  }

  broadcast(message: ExtensionToWebviewMessage): void {
    for (const w of this.webviews) {
      void w.postMessage(message);
    }
  }

  addEntry(entry: LogEntry): void {
    this.buffer.push(entry);
    while (this.buffer.length > this.maxLogs) {
      this.buffer.shift();
    }
    this.broadcast({ command: 'log', entry });
  }

  clearAll(): void {
    this.buffer = [];
    this.broadcast({ command: 'clear' });
  }

  updateSettings(): void {
    const config = vscode.workspace.getConfiguration('flutterLogFold');
    this.maxLogs = config.get<number>('maxLogs', 500);
    this.collapseByDefault = config.get<boolean>('collapseByDefault', true);
    while (this.buffer.length > this.maxLogs) {
      this.buffer.shift();
    }
    this.broadcast({
      command: 'settings',
      collapseByDefault: this.collapseByDefault,
      maxLogs: this.maxLogs,
    });
  }

  get bufferLength(): number {
    return this.buffer.length;
  }
}
