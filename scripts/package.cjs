// Build only committed application files, never the developer's working folders.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root });

async function main() {
  if (git('status', '--porcelain', '--untracked-files=no').toString().trim()) {
    throw new Error('Commit validated source changes before packaging. Releases use HEAD.');
  }
  const npm = process.env.npm_execpath;
  if (!npm || !fs.existsSync(npm)) throw new Error('Run this build through npm run package.');
  const revision = git('rev-parse', 'HEAD').toString().trim();
  const files = git('ls-tree', '-r', '--name-only', '-z', 'HEAD').toString().split('\0')
    .filter(file => file.startsWith('src/') || ['package.json', 'package-lock.json', 'LICENSE', 'NOTICE'].includes(file));
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const stage = fs.mkdtempSync(path.join(root, 'artifacts', 'release-stage-'));
  for (const file of files) {
    const target = path.join(stage, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, git('show', `${revision}:${file}`));
  }
  // Fresh production dependencies only; no local node_modules or install hooks.
  execFileSync(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: stage, stdio: 'inherit', windowsHide: true });
  const metadata = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
  const { packager } = await import('@electron/packager');
  const output = await packager({ dir: stage, name: 'Hentdows', platform: 'win32', arch: 'x64',
    electronVersion: metadata.devDependencies.electron, appVersion: metadata.version,
    out: path.join(root, 'dist', metadata.version), overwrite: false, asar: true, prune: false });
  fs.writeFileSync(path.join(root, 'dist', metadata.version, 'build-info.json'),
    JSON.stringify({ version: metadata.version, revision, electron: metadata.devDependencies.electron, files }, null, 2) + '\n');
  console.log(`Built ${metadata.version} from ${revision}: ${output.join(', ')}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
