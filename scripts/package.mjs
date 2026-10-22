import {readFileSync, writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
const checksums = [];
for (const folder of ['bookoo-motto80.reaplugin']) {
  const manifest = JSON.parse(readFileSync(path.join(root, folder, 'manifest.json'), 'utf8'));
  if (manifest.id !== folder || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error('Plugin id or version is invalid');
  }
  const name = `${folder.replace('.reaplugin', '')}-${manifest.version}.zip`;
  const archive = path.join(output, name);
  const files = ['manifest.json', 'plugin.js', 'README.md', 'LICENSE', 'COPYING'];
  mkdirSync(output, {recursive: true});
  rmSync(archive, {force: true});
  execFileSync('zip', ['-X', '-q', archive, ...files.map(file => `${folder}/${file}`)], {cwd: root});
  execFileSync('unzip', ['-t', archive], {stdio: 'pipe'});
  const entries = execFileSync('unzip', ['-Z1', archive], {encoding: 'utf8'}).trim().split('\n').sort();
  const expected = files.map(file => `${folder}/${file}`).sort();
  if (JSON.stringify(entries) !== JSON.stringify(expected)) throw new Error('Unexpected ZIP entries');
  for (const file of files) {
    const packed = execFileSync('unzip', ['-p', archive, `${folder}/${file}`]);
    if (!packed.equals(readFileSync(path.join(root, folder, file)))) {
      throw new Error('Archive differs from source: ' + file);
    }
  }
  const sha = createHash('sha256').update(readFileSync(archive)).digest('hex');
  checksums.push(`${sha}  ${name}\n`);
  console.log(`Packaged and verified ${archive}`);
  console.log(`SHA256 ${sha}`);
}
writeFileSync(path.join(output, 'SHA256SUMS'), checksums.join(''));
