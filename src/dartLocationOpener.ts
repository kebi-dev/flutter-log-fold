import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface PackageConfigPackage {
  name: string;
  rootUri: string;
  packageUri?: string;
}

function tryResolvePackageFile(
  workspaceRootFsPath: string,
  packageName: string,
  pathUnderLib: string,
): vscode.Uri | undefined {
  const configPath = path.join(workspaceRootFsPath, '.dart_tool', 'package_config.json');
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch {
    return undefined;
  }
  let cfg: { packages?: PackageConfigPackage[] };
  try {
    cfg = JSON.parse(raw) as { packages?: PackageConfigPackage[] };
  } catch {
    return undefined;
  }
  const pkg = cfg.packages?.find((p) => p.name === packageName);
  if (!pkg) {
    return undefined;
  }
  let root: vscode.Uri;
  try {
    root = vscode.Uri.parse(pkg.rootUri);
  } catch {
    return undefined;
  }
  const pkgUri = (pkg.packageUri ?? 'lib/').replace(/\\/g, '/');
  return vscode.Uri.joinPath(root, pkgUri, pathUnderLib.replace(/\\/g, '/'));
}

/**
 * Resolve `package:name/path/file.dart` using each workspace folder's `.dart_tool/package_config.json`.
 */
export function resolvePackageDartUri(
  folders: readonly vscode.WorkspaceFolder[] | undefined,
  packageName: string,
  pathWithinPackage: string,
): vscode.Uri | undefined {
  if (!folders?.length) {
    return undefined;
  }
  for (const folder of folders) {
    const uri = tryResolvePackageFile(folder.uri.fsPath, packageName, pathWithinPackage);
    if (uri) {
      return uri;
    }
  }
  return undefined;
}

export async function openDartPackageLocation(
  packageName: string,
  relativePath: string,
  line: number,
  column: number,
): Promise<void> {
  const safeLine = Number.isFinite(line) && line > 0 ? Math.floor(line) : 0;
  const safeCol = Number.isFinite(column) && column > 0 ? Math.floor(column) : 1;
  if (!packageName || !relativePath || safeLine < 1) {
    void vscode.window.showWarningMessage('Invalid source location.');
    return;
  }

  const uri = resolvePackageDartUri(vscode.workspace.workspaceFolders, packageName, relativePath);
  if (!uri) {
    void vscode.window.showWarningMessage(
      `Could not resolve package:${packageName}/${relativePath}. Ensure the workspace root contains .dart_tool/package_config.json.`,
    );
    return;
  }

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const pos = new vscode.Position(safeLine - 1, Math.max(0, safeCol - 1));
    await vscode.window.showTextDocument(doc, {
      selection: new vscode.Range(pos, pos),
      preserveFocus: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void vscode.window.showWarningMessage(`Could not open ${uri.fsPath}: ${msg}`);
  }
}
