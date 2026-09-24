import fs from 'fs';
import path from 'path';

describe('Web Bundler & Metro configuration regressions', () => {
  const rootDir = path.resolve(__dirname, '../..');

  it('metro.config.js defines resolveRequest redirecting jspdf to ES module build', () => {
    const metroConfigPath = path.join(rootDir, 'metro.config.js');
    expect(fs.existsSync(metroConfigPath)).toBe(true);

    const metroConfig = require(metroConfigPath);
    expect(metroConfig.resolver).toBeDefined();
    expect(typeof metroConfig.resolver.resolveRequest).toBe('function');

    const fakeContext = {
      resolveRequest: jest.fn(),
    };

    const resolved = metroConfig.resolver.resolveRequest(fakeContext, 'jspdf', 'web');
    expect(resolved).toBeDefined();
    expect(resolved.type).toBe('sourceFile');
    expect(resolved.filePath).toContain('jspdf.es.min.js');
    expect(fs.existsSync(resolved.filePath)).toBe(true);
  });

  it('the resolved jspdf build does not contain AMD require calls that break Metro SSR', () => {
    const esModulePath = require.resolve('jspdf/dist/jspdf.es.min.js');
    const content = fs.readFileSync(esModulePath, 'utf8');

    // AMD require calls like require(["html2canvas"], ...) break Metro transformation worker
    expect(content.includes('require([')).toBe(false);
  });

  it('babel.config.js includes @babel/plugin-transform-class-static-block for html2canvas-pro support', () => {
    const babelConfigPath = path.join(rootDir, 'babel.config.js');
    expect(fs.existsSync(babelConfigPath)).toBe(true);

    const babelConfigFn = require(babelConfigPath);
    const config = babelConfigFn({ cache: () => {} });

    expect(config.plugins).toBeDefined();
    expect(config.plugins).toContain('@babel/plugin-transform-class-static-block');
  });

  it('package.json declares jspdf and html2canvas-pro dependencies', () => {
    const packageJsonPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    expect(pkg.dependencies['jspdf']).toBeDefined();
    expect(pkg.dependencies['html2canvas-pro']).toBeDefined();
    expect(pkg.devDependencies['@babel/plugin-transform-class-static-block']).toBeDefined();
  });
});
