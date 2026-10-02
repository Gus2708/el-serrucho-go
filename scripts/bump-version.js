const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const appJsonPath = path.join(rootDir, 'app.json');
const layoutPath = path.join(rootDir, 'app', '_layout.tsx');
const appUpdaterPath = path.join(rootDir, 'src', 'lib', 'appUpdater.ts');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;

const arg = process.argv[2] || 'patch';
let [major, minor, patch] = currentVersion.split('.').map((n) => parseInt(n, 10) || 0);

let nextVersion = arg;
if (arg === 'patch') {
  nextVersion = `${major}.${minor}.${patch + 1}`;
} else if (arg === 'minor') {
  nextVersion = `${major}.${minor + 1}.0`;
} else if (arg === 'major') {
  nextVersion = `${major + 1}.0.0`;
}

// 1. Update package.json
pkg.version = nextVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 2. Update app.json
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
appJson.expo.version = nextVersion;
fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');

// 3. Update app/_layout.tsx buster
let layoutContent = fs.readFileSync(layoutPath, 'utf8');
layoutContent = layoutContent.replace(/buster:\s*['"]v[0-9.]+['"]/, `buster: 'v${nextVersion}'`);
fs.writeFileSync(layoutPath, layoutContent);

// 4. Update src/lib/appUpdater.ts fallback
let updaterContent = fs.readFileSync(appUpdaterPath, 'utf8');
updaterContent = updaterContent.replace(
  /Constants\.expoConfig\?\.version\s*\?\?\s*['"][0-9.]+['"]/,
  `Constants.expoConfig?.version ?? '${nextVersion}'`
);
fs.writeFileSync(appUpdaterPath, updaterContent);

console.log(`[Version Sync] Updated app version: ${currentVersion} -> ${nextVersion}`);
