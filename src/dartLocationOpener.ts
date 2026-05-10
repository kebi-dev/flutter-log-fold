import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface PackageConfigPackage {
  name: string;
  rootUri: string;
  packageUri?: string;
}

/** Directory containing package_config.json (the `.dart_tool` folder). */
function resolvePackageRootUri(pkg: PackageConfigPackage, packageConfigJsonPath: string): vscode.Uri {
  const packageConfigDir = path.dirname(packageConfigJsonPath);
  let raw = pkg.rootUri.trim().replace(/\\/g, '/');

  if (raw === '' || raw === '.') {
    return vscode.Uri.file(path.normalize(path.join(packageConfigDir, '..')));
  }

  // Absolute URI (file:, etc.)
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) {
    try {
      return vscode.Uri.parse(raw, true);
    } catch {
      return vscode.Uri.file(path.normalize(path.join(packageConfigDir, raw)));
    }
  }

  // Relative to the directory that contains package_config.json (.dart_tool/)
  const fsPath = path.normalize(path.join(packageConfigDir, raw));
  return vscode.Uri.file(fsPath);
}

function collectWorkspaceSearchRoots(workspaceFsPath: string): string[] {
  const roots = new Set<string>();
  roots.add(workspaceFsPath);
  try {
    const entries = fs.readdirSync(workspaceFsPath, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) {
        continue;
      }
      const sub = path.join(workspaceFsPath, ent.name);
      if (fs.existsSync(path.join(sub, '.dart_tool', 'package_config.json'))) {
        roots.add(sub);
      }
    }
  } catch {
    /* ignore */
  }
  return [...roots];
}

function tryResolvePackageFile(
  projectRootFsPath: string,
  packageName: string,
  pathUnderLib: string,
): vscode.Uri | undefined {
  const configPath = path.join(projectRootFsPath, '.dart_tool', 'package_config.json');
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
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

  const root = resolvePackageRootUri(pkg, configPath);
  const pkgUri = (pkg.packageUri ?? 'lib/').replace(/\\/g, '/');
  const rel = pathUnderLib.replace(/\\/g, '/');

  const candidate = vscode.Uri.joinPath(root, pkgUri, rel);
  if (fs.existsSync(candidate.fsPath)) {
    return candidate;
  }

  // Some layouts list lib/ already implied or packageUri is "."
  const alt = vscode.Uri.joinPath(root, rel);
  if (fs.existsSync(alt.fsPath)) {
    return alt;
  }

  const altLib = vscode.Uri.joinPath(root, 'lib', rel);
  if (fs.existsSync(altLib.fsPath)) {
    return altLib;
  }

  return undefined;
}

/**
 * Resolve `package:name/path/file.dart` using `.dart_tool/package_config.json`.
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
    const roots = collectWorkspaceSearchRoots(folder.uri.fsPath);
    for (const r of roots) {
      const uri = tryResolvePackageFile(r, packageName, pathWithinPackage);
      if (uri) {
        return uri;
      }
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
      `Could not resolve package:${packageName}/${relativePath}. Open the Flutter/Dart project folder (with .dart_tool/package_config.json) or run pub get.`,
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
