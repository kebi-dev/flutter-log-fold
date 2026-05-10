import * as vscode from 'vscode';
import { LogViewerCoordinator } from './logViewerCoordinator';
import { buildLogViewerHtml } from './logViewerHtml';

export class LogPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'flutterLogFold.logView';

  private view?: vscode.WebviewView;
  private readonly extensionUri: vscode.Uri;
  private readonly coordinator: LogViewerCoordinator;
  private viewDisposables: vscode.Disposable[] = [];

  constructor(extensionUri: vscode.Uri, coordinator: LogViewerCoordinator) {
    this.extensionUri = extensionUri;
    this.coordinator = coordinator;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.viewDisposables.forEach((d) => d.dispose());
    this.viewDisposables = [];

    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'webview')],
    };

    webviewView.webview.html = buildLogViewerHtml(webviewView.webview, this.extensionUri);

    const registration = this.coordinator.registerWebview(webviewView.webview);
    this.viewDisposables.push(registration);

    const bridge = this.coordinator.attachMessageBridge(webviewView.webview);
    this.viewDisposables.push(bridge);

    this.viewDisposables.push(
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible && this.coordinator.bufferLength > 0) {
          this.coordinator.replayState(webviewView.webview);
        }
      }),
    );

    webviewView.onDidDispose(() => {
      this.viewDisposables.forEach((d) => d.dispose());
      this.viewDisposables = [];
      this.view = undefined;
    });
  }
}
