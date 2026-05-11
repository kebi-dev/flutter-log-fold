import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const watch = process.argv.includes('--watch');

function copyCodicons() {
  const srcDir = path.join('node_modules', '@vscode', 'codicons', 'dist');
  const dstDir = path.join('webview', 'codicons');
  const css = path.join(srcDir, 'codicon.css');
  const ttf = path.join(srcDir, 'codicon.ttf');
  if (!fs.existsSync(css) || !fs.existsSync(ttf)) {
    console.warn(
      'Skipping codicons copy (run npm install). Webview icons require @vscode/codicons.',
    );
    return;
  }
  fs.mkdirSync(dstDir, { recursive: true });
  fs.copyFileSync(css, path.join(dstDir, 'codicon.css'));
  fs.copyFileSync(ttf, path.join(dstDir, 'codicon.ttf'));
}

const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: watch,
  minify: !watch,
};

if (watch) {
  copyCodicons();
  const ctx = await esbuild.context(config);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(config);
  copyCodicons();
  console.log('Build complete.');
}
