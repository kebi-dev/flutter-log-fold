import * as vscode from 'vscode';
import * as crypto from 'crypto';

export function buildLogViewerHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', 'style.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', 'main.js'));
  const nonce = getNonce();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Flutter Logs</title>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-row">
      <button id="btn-clear" title="Clear all logs">Clear</button>
      <button id="btn-collapse" title="Collapse all blocks">Collapse All</button>
      <button id="btn-expand" title="Expand all blocks">Expand All</button>
      <input type="text" id="input-filter" placeholder="Filter..." title="Filter logs by text (case-insensitive)" aria-label="Filter logs">
      <span id="counter" class="counter">0 / 0</span>
    </div>
    <div class="chip-bar" id="chip-bar">
      <button type="button" class="chip chip-toggle active" data-category="all" role="switch" aria-checked="true" aria-label="All log categories">
        <span class="chip-label">ALL</span>
        <span class="chip-track" aria-hidden="true"><span class="chip-thumb"></span></span>
      </button>
      <span class="chip-separator" id="chip-separator"></span>
      <button type="button" class="chip chip-toggle source-chip" data-source="system" id="chip-system" role="switch" aria-checked="false" aria-label="Show Android system logs" title="Show system logs (Choreographer, etc.)">
        <span class="chip-label">SYS</span>
        <span class="chip-track" aria-hidden="true"><span class="chip-thumb"></span></span>
      </button>
    </div>
  </div>
  <div id="log-container" class="log-container"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  return crypto.randomBytes(16).toString('base64url');
}
