import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadConfig(blockList: RegExp | RegExp[]) {
  const fallback = jest.fn(() => 'existing resolution');
  const config = { resolver: { sourceExts: ['tsx'], blockList, resolveRequest: fallback } };
  const mockRequire = Object.assign(
    () => ({ getSentryExpoConfig: () => config }),
    { resolve: jest.fn(() => 'jspdf.es.min.js') },
  );
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'metro.config.js'), 'utf8'), {
    require: mockRequire,
    __dirname,
    module: { exports: {} },
  });
  return { config, fallback };
}

function isBlocked(blockList: RegExp | RegExp[], file: string): boolean {
  const patterns = Array.isArray(blockList) ? blockList : [blockList];
  return patterns.some(pattern => pattern.test(file));
}

describe('Metro test-dependency exclusion', () => {
  it('ignores the nested e2e dependency directory before traversing its inaccessible links', () => {
    const { config } = loadConfig(/existing-exclusion/);
    for (const root of ['G:\\Projects\\app\\e2e\\node_modules', '/projects/app/e2e/node_modules']) {
      expect(isBlocked(config.resolver.blockList, root)).toBe(true);
      expect(isBlocked(config.resolver.blockList, `${root}/.bin/e2e`)).toBe(true);
    }
    expect(isBlocked(config.resolver.blockList, '/projects/app/e2e/support/session.ts')).toBe(false);
    expect(isBlocked(config.resolver.blockList, '/projects/app/node_modules/expo/index.js')).toBe(false);
    expect(isBlocked(config.resolver.blockList, '/projects/app/src/lib/facturaProveedor.ts')).toBe(false);
  });

  it.each([/existing-exclusion/, [/existing-exclusion/, /another-exclusion/]])(
    'preserves existing exclusions and module resolution',
    blockList => {
      const { config, fallback } = loadConfig(blockList);
      expect(isBlocked(config.resolver.blockList, '/existing-exclusion/file')).toBe(true);
      expect(config.resolver.sourceExts).toEqual(['tsx', 'mjs']);
      const resolveRequest = config.resolver.resolveRequest as (...args: unknown[]) => unknown;
      expect(resolveRequest({}, 'jspdf', 'web')).toEqual({ filePath: 'jspdf.es.min.js', type: 'sourceFile' });
      expect(resolveRequest({}, 'expo', 'web')).toBe('existing resolution');
      expect(fallback).toHaveBeenCalledWith({}, 'expo', 'web');
    },
  );
});
