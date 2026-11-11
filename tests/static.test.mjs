import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? filesIn(join(directory, entry.name)) : [join(directory, entry.name)]));
  return nested.flat();
}
async function verifyReference(from, reference) {
  if (!reference || reference.startsWith('#') || reference.startsWith('data:')) return;
  assert.ok(reference.startsWith('./') || reference.startsWith('../'), `${relative(dist, from)} must use a relative path: ${reference}`);
  const target = resolve(dirname(from), reference.split(/[?#]/)[0]);
  assert.ok(!relative(dist, target).startsWith('..' + sep), `Reference escapes deployment: ${reference}`);
  assert.ok((await stat(target)).isFile(), `Missing local asset: ${reference}`);
  let current = dist;
  for (const part of relative(dist, target).split(sep)) {
    const entries = await readdir(current);
    assert.ok(entries.includes(part), `Path case mismatch: ${relative(dist, target)}`);
    current = join(current, part);
  }
}

test('HTML assets, module imports and CSS URLs exist with exact-case relative paths', async () => {
  const files = await filesIn(dist); let checked = 0;
  assert.ok(files.some(file => basename(file) === 'index.html'));
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const references = [];
    if (file.endsWith('.html')) for (const match of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)) references.push(match[1]);
    if (file.endsWith('.js')) {
      for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g)) references.push(match[1]);
      for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) references.push(match[1]);
    }
    if (file.endsWith('.css')) for (const match of text.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) references.push(match[1]);
    for (const reference of references) { await verifyReference(file, reference); checked++; }
  }
  assert.ok(checked >= 8, `Expected module and asset graph; checked ${checked}`);
});

test('deployed source has no remote URLs; only the local bridge can use a same-origin API', async () => {
  const files = await filesIn(dist);
  for (const file of files.filter(file => /\.(html|css|js)$/.test(file))) {
    const text = await readFile(file, 'utf8'), label = relative(dist, file);
    assert.doesNotMatch(text, /https?:\/\//i, `Remote runtime URL in ${label}`);
    assert.doesNotMatch(text, /\b(?:importScripts|eval|Function)\s*\(/, `Dynamic execution function in ${label}`);
    if(label === 'src/pc-bridge.js'){assert.match(text,/fetch\('\.\/api'\+route/);assert.match(text,/location\.hostname==='127\.0\.0\.1'/);}else assert.doesNotMatch(text,/\bfetch\s*\(/,`Unexpected network client in ${label}`);
    assert.doesNotMatch(text, /\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource|Function)\b|\bnavigator\.sendBeacon\b/, `Network or dynamic execution object in ${label}`);
    assert.doesNotMatch(text, /<iframe\b|@import\b/i, `Embedded external page or CSS import in ${label}`);
  }
});
