import fs from 'fs';
import path from 'path';
import { transform } from 'lightningcss';

interface CssRule {
  selector: string;
  declarations: string;
}

// Same options as the global CSS transform in
// node_modules/@expo/metro-config/build/transform-worker/transform-worker.js.
function compileLikeMetro(filename: string, code: string): string {
  const result = transform({
    filename,
    code: Buffer.from(code),
    errorRecovery: true,
    sourceMap: false,
    cssModules: false,
    projectRoot: process.cwd(),
    minify: true,
    analyzeDependencies: true,
  });
  return result.code.toString();
}

// `[^{}]+` cannot cross a brace, so rules nested in @media come out with their own selector.
function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    rules.push({ selector: match[1].trim(), declarations: match[2] });
  }
  return rules;
}

function extractBlock(css: string, opener: string): string {
  const openerIndex = css.indexOf(opener);
  if (openerIndex === -1) throw new Error(`Block not found: ${opener}`);
  const braceStart = css.indexOf('{', openerIndex);
  let depth = 0;
  for (let i = braceStart; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(braceStart + 1, i);
    }
  }
  throw new Error(`Unbalanced braces in block: ${opener}`);
}

function varOverrideViolations(rule: CssRule): string[] {
  const byProperty = new Map<string, string[]>();
  for (const raw of rule.declarations.split(';')) {
    const declaration = raw.trim();
    const colonIndex = declaration.indexOf(':');
    if (colonIndex === -1) continue;
    const property = declaration.slice(0, colonIndex);
    byProperty.set(property, [...(byProperty.get(property) ?? []), declaration]);
  }

  const violations: string[] = [];
  byProperty.forEach((declarations, property) => {
    const last = declarations[declarations.length - 1];
    if (declarations.some((d) => d.includes('var(')) && !last.includes('var(')) {
      violations.push(
        `${rule.selector} -> ${property}: "${last}" wins after minification. ` +
          'lightningcss moves plain values after var() ones; keep a single declaration per property.',
      );
    }
  });
  return violations;
}

describe('lightningcss fallback reordering (canary)', () => {
  it('moves a plain 100vh after a var() declaration of the same property', () => {
    // This reorder made `min-height: 100vh; min-height: var(--app-vh, 100dvh)` in app/global.css
    // resolve to 100vh (932pt) inside the 873pt iOS standalone viewport, cutting off the tab bar.
    // If this starts failing, the minifier changed and the guard below can be revisited.
    const output = compileLikeMetro('canary.css', 'a{min-height:100vh!important;min-height:var(--x,100dvh)!important}');

    expect(output).toBe('a{min-height:var(--x,100dvh)!important;min-height:100vh!important}');
  });

  it('collapses a 100vh + 100dvh pair to 100dvh, which is why the original fallback was safe', () => {
    const output = compileLikeMetro('canary.css', 'a{height:100vh!important;height:100dvh!important}');

    expect(output).toBe('a{height:100dvh!important}');
  });
});

describe('app/global.css after Metro minification', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'global.css'), 'utf8');
  const compiled = compileLikeMetro('global.css', source);

  it('never lets a plain value override a var() declaration of the same property', () => {
    const violations = parseRules(compiled).flatMap(varOverrideViolations);

    expect(violations).toEqual([]);
  });

  it('sizes the standalone PWA with the visual viewport var and no bare 100vh', () => {
    const block = extractBlock(compiled, '@media (display-mode:standalone)');

    expect(block).toContain('html,body{height:var(--app-vh,100dvh)!important');
    expect(block).toContain('#root{min-height:var(--app-vh,100dvh)!important}');
    expect(block).not.toContain('100vh');
  });
});
