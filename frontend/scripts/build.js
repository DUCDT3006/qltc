import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const distDir = path.join(rootDir, 'dist');
execFileSync(process.execPath, [path.join(rootDir, 'node_modules/typescript/bin/tsc'), '-b'], { cwd: rootDir, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(rootDir, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: rootDir, stdio: 'inherit' });

const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const jsName = html.match(/\/assets\/(index-[a-zA-Z0-9_-]+\.js)/)?.[1];
const cssName = html.match(/\/assets\/(index-[a-zA-Z0-9_-]+\.css)/)?.[1];
if (!jsName || !cssName) throw new Error('Vite output is missing versioned entry assets');

const swFile = path.join(distDir, 'sw.js');
const sw = fs.readFileSync(swFile, 'utf8')
  .replaceAll('__QLTC_JS_ASSET__', `/assets/${jsName}`)
  .replaceAll('__QLTC_CSS_ASSET__', `/assets/${cssName}`);
fs.writeFileSync(swFile, sw);

console.log('Build completed successfully! Output in dist/');
