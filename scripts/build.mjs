import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const files = await readdir(dist, { recursive: true, withFileTypes: true });
const assets = {};
for (const entry of files) {
  const type = types[extname(entry.name)];
  if (!entry.isFile() || !type || entry.parentPath === join(dist, 'server')) continue;
  if (entry.parentPath !== dist && !entry.parentPath.startsWith(join(dist, 'assets') + '/') &&
      entry.parentPath !== join(dist, 'assets')) continue;
  const filename = join(entry.parentPath, entry.name);
  const data = await readFile(filename);
  assets[filename.slice(dist.length)] = { type, data: data.toString('base64') };
}

const sources = await Promise.all(['index.mjs', 'webview.mjs'].map(name =>
  readFile(join(root, 'worker', name), 'utf8')));
await mkdir(join(dist, 'server'), { recursive: true });
await writeFile(join(dist, 'server', 'index.js'), `const staticFiles = ${JSON.stringify(assets)};\n${sources.join('\n')}`);
