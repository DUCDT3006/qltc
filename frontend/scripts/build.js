import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const distDir = path.join(rootDir, 'dist');
const assetsDir = path.join(distDir, 'assets');

console.log('1. Checking TypeScript types (tsc -b)...');
execSync('npx tsc -b', { cwd: rootDir, stdio: 'inherit' });

console.log('2. Compiling Tailwind CSS v4...');
fs.mkdirSync(assetsDir, { recursive: true });
execSync('npx @tailwindcss/cli -i src/index.css -o dist/assets/index.css', { cwd: rootDir, stdio: 'inherit' });

console.log('3. Bundling JavaScript with esbuild...');
execSync(
  'npx esbuild src/main.tsx --bundle --minify --format=esm --target=es2020,chrome80 --jsx=automatic --loader:.css=empty --outfile=dist/assets/index.js --loader:.png=dataurl --loader:.svg=dataurl --define:import.meta.env.MODE=\'"production"\' --define:import.meta.env.PROD=true --define:import.meta.env.DEV=false --define:import.meta.env.BASE_URL=\'"/"\'',
  { cwd: rootDir, stdio: 'inherit' }
);

console.log('4. Copying public assets & index.html...');
const publicDir = path.join(rootDir, 'public');
if (fs.existsSync(publicDir)) {
  for (const file of fs.readdirSync(publicDir)) {
    fs.copyFileSync(path.join(publicDir, file), path.join(distDir, file));
  }
}

// Ensure dist/index.html points to /assets/index.js and /assets/index.css
const htmlSrc = path.join(rootDir, 'index.html');
let htmlContent = fs.readFileSync(htmlSrc, 'utf8');
htmlContent = htmlContent.replace(
  '<script type="module" src="/src/main.tsx"></script>',
  '<link rel="preload" href="/assets/index.css" as="style">\n    <link rel="modulepreload" href="/assets/index.js">\n    <link rel="stylesheet" href="/assets/index.css">\n    <script type="module" src="/assets/index.js"></script>'
);
fs.writeFileSync(path.join(distDir, 'index.html'), htmlContent, 'utf8');

console.log('✨ Build completed successfully! Output in dist/');
