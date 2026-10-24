import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('client/dist');
const html = readFileSync(resolve(root,'index.html'),'utf8');
const local = value => value.startsWith('/') && !value.startsWith('//');
const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
assert.ok(assets.length > 0);
for (const asset of assets) { assert.ok(local(asset),`Nonlocal HTML asset: ${asset}`); readFileSync(resolve(root,`.${asset}`)); }
for (const file of readdirSync(resolve(root,'assets')).filter(file => file.endsWith('.css'))) {
  const css = readFileSync(resolve(root,'assets',file),'utf8');
  assert.ok(!/@import\b/i.test(css),'CSS imports need explicit audit');
  for (const match of css.matchAll(/url\(\s*['"]?([^)'"\s]+)/g)) assert.ok(match[1].startsWith('data:') || local(match[1]) || !/^(?:\w+:|\/\/)/.test(match[1]),`Remote CSS asset: ${match[1]}`);
}
const files = readdirSync(resolve('client/src')).filter(file => /\.(?:tsx?|css)$/.test(file) && !file.includes('.test.'));
for (const file of files) {
  const source = readFileSync(resolve('client/src',file),'utf8');
  assert.ok(!/(?:fetch|io)\(\s*['"]https?:\/\//.test(source),`Remote runtime connection in ${file}`);
  assert.ok(!/navigator\.serviceWorker|sendBeacon\(/.test(source),`Unexpected background networking in ${file}`);
}
console.log(`Offline asset audit passed: ${assets.length} entry assets and ${files.length} source files. Physical WAN-unplugged testing remains required.`);
