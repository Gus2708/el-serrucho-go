import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

describe('version bump CLI metadata consistency', () => {
  const fixtures: string[] = [];

  afterAll(() => {
    const tempRoot = realpathSync(tmpdir());
    for (const fixture of fixtures) {
      const location = relative(tempRoot, realpathSync(fixture));
      if (!location.startsWith('invoice-version-') || location.includes(sep)) throw new Error('Unsafe fixture cleanup');
      rmSync(fixture, { recursive: true });
    }
  });

  function fixture(withLock = true): string {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'invoice-version-'));
    fixtures.push(root);
    function write(path: string, content: string): void {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    write('package.json', JSON.stringify({ name: 'synthetic', version: '1.2.8', dependencies: { kept: '2.0.0' } }));
    write('app.json', JSON.stringify({ expo: { name: 'Synthetic', version: '1.2.8' } }));
    write('app/_layout.tsx', "const options = { buster: 'v1.2.8' };\n");
    write('src/lib/appUpdater.ts', "const version = Constants.expoConfig?.version ?? '1.2.8';\n");
    if (withLock) {
      write('package-lock.json', JSON.stringify({ name: 'synthetic', version: '1.2.3', lockfileVersion: 3, packages: {
        '': { name: 'synthetic', version: '1.2.3', dependencies: { kept: '2.0.0' } },
        'node_modules/kept': { version: '2.0.0', integrity: 'fixture-integrity' },
      } }));
    }
    mkdirSync(join(root, 'scripts'), { recursive: true });
    copyFileSync(join(__dirname, '../../scripts/bump-version.js'), join(root, 'scripts/bump-version.js'));
    return root;
  }

  it.each([
    ['patch', '1.2.9'], ['minor', '1.3.0'], ['major', '2.0.0'], ['4.5.6', '4.5.6'],
  ])('keeps every version consumer and dependency entry consistent for %s', (mode, expected) => {
    const root = fixture();
    const output = execFileSync(process.execPath, [join(root, 'scripts/bump-version.js'), mode], { encoding: 'utf8', cwd: root });
    const read = (path: string) => readFileSync(join(root, path), 'utf8');
    expect(output).toContain(`1.2.8 -> ${expected}`);
    expect(JSON.parse(read('package.json'))).toEqual({ name: 'synthetic', version: expected, dependencies: { kept: '2.0.0' } });
    expect(JSON.parse(read('app.json'))).toEqual({ expo: { name: 'Synthetic', version: expected } });
    expect(read('app/_layout.tsx')).toBe(`const options = { buster: 'v${expected}' };\n`);
    expect(read('src/lib/appUpdater.ts')).toBe(`const version = Constants.expoConfig?.version ?? '${expected}';\n`);
    expect(JSON.parse(read('package-lock.json'))).toEqual({ name: 'synthetic', version: expected, lockfileVersion: 3, packages: {
      '': { name: 'synthetic', version: expected, dependencies: { kept: '2.0.0' } },
      'node_modules/kept': { version: '2.0.0', integrity: 'fixture-integrity' },
    } });
  });

  it('preserves the existing default patch behavior when no lockfile exists', () => {
    const root = fixture(false);
    execFileSync(process.execPath, [join(root, 'scripts/bump-version.js')], { cwd: root });
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('1.2.9');
    expect(existsSync(join(root, 'package-lock.json'))).toBe(false);
  });
});
