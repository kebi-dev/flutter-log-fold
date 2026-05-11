import * as vscode from 'vscode';
import * as crypto from 'crypto';

export function buildLogViewerHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const codiconsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'webview', 'codicons', 'codicon.css'),
  );
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', 'style.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', 'main.js'));
  const nonce = getNonce();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${codiconsUri}" rel="stylesheet">
  <link href="${styleUri}" rel="stylesheet">
  <title>Flutter Logs</title>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-row">
      <div class="toolbar-actions">
        <button type="button" id="btn-clear" class="toolbar-btn-icon" title="Clear all logs" aria-label="Clear all logs">
          <span class="codicon codicon-clear-all" aria-hidden="true"></span>
        </button>
        <button type="button" id="btn-collapse" class="toolbar-btn-icon" title="Collapse all blocks" aria-label="Collapse all blocks">
          <span class="codicon codicon-collapse-all" aria-hidden="true"></span>
        </button>
        <button type="button" id="btn-expand" class="toolbar-btn-icon" title="Expand all blocks" aria-label="Expand all blocks">
          <span class="codicon codicon-expand-all" aria-hidden="true"></span>
        </button>
        <button type="button" id="btn-new-viewer" class="toolbar-btn-icon" title="Open another Flutter Logs tab with the same live stream (filters are independent)" aria-label="Open another Flutter Logs viewer">
          <span class="codicon codicon-multiple-windows" aria-hidden="true"></span>
        </button>
      </div>
      <div class="filter-find-cluster">
        <div class="filter-input-wrap">
          <span class="codicon codicon-search filter-input-glyph" aria-hidden="true"></span>
          <input type="text" id="input-filter" placeholder="Filter" title="Filter logs by text (case-insensitive). With matches: ⌘G / Ctrl+G next, ⇧⌘G / Shift+Ctrl+G previous." aria-label="Filter logs">
        </div>
        <div id="filter-find-nav" class="filter-find-nav" hidden>
          <span id="filter-match-counter" class="filter-match-counter" aria-live="polite"></span>
          <button type="button" id="btn-filter-prev" class="toolbar-btn-icon filter-find-btn" title="Previous match (⇧⌘G / Shift+Ctrl+G)" aria-label="Previous filter match">
            <span class="codicon codicon-arrow-up" aria-hidden="true"></span>
          </button>
          <button type="button" id="btn-filter-next" class="toolbar-btn-icon filter-find-btn" title="Next match (⌘G / Ctrl+G)" aria-label="Next filter match">
            <span class="codicon codicon-arrow-down" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <span id="counter" class="counter">0 / 0</span>
    </div>
      <div class="chip-bar-scroll">
      <div class="chip-bar" id="chip-bar">
        <div class="chip-mutex-shell" role="radiogroup" aria-label="Log level or tag (one selection)">
          <div class="chip-bar-row chip-bar-row-level">
            <div class="chip-filter-group" id="chip-filter-group"></div>
            <span class="chip-separator" id="chip-separator"></span>
            <button type="button" class="chip chip-toggle source-chip" data-source="system" id="chip-system" role="switch" aria-checked="false" aria-label="Show Android system logs" title="Show system logs (Choreographer, etc.)">
              <span class="codicon codicon-vm chip-icon" aria-hidden="true"></span>
              <span class="chip-label">SYS</span>
              <span class="chip-track" aria-hidden="true"><span class="chip-thumb"></span></span>
            </button>
          </div>
          <div class="chip-dynamic-section">
            <div class="chip-dynamic-group" id="chip-dynamic-group"></div>
          </div>
        </div>
      </div>
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
