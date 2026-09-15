import fs from 'fs';
import path from 'path';
import { HIDE_ON_KEYBOARD } from './hideOnKeyboard';
import { rootStyles, viewportDebugPanel, visualViewportSync } from './viewport';

type Listener = (event?: unknown) => void;
type ListenerMap = Record<string, Listener[]>;

interface CssBlock {
  selector: string;
  body: string;
}

interface FakeElement {
  style: { cssText: string };
  children: FakeElement[];
  parentNode: FakeElement | null;
  textContent: string;
  listeners: ListenerMap;
  appendChild(child: FakeElement): FakeElement;
  removeChild(child: FakeElement): FakeElement;
  addEventListener(type: string, listener: Listener): void;
  getBoundingClientRect(): { top: number; height: number; bottom: number };
}

// Real numbers from an iPhone running the installed PWA on iOS 27 (status bar style "black").
const IOS_STANDALONE = { screenHeight: 932, viewportHeight: 873, safeAreaBottom: 34 };

const globals = globalThis as unknown as Record<string, unknown>;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function addListener(map: ListenerMap, type: string, listener: Listener): void {
  map[type] = [...(map[type] ?? []), listener];
}

function dispatch(map: ListenerMap, type: string, event?: unknown): void {
  (map[type] ?? []).forEach((listener) => listener(event));
}

function stubNavigator(value: object): void {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

function restoreGlobals(): void {
  ['window', 'document', 'screen', 'matchMedia', 'getComputedStyle', 'localStorage'].forEach((name) => {
    delete globals[name];
  });
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  } else {
    delete globals.navigator;
  }
}

function cssBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    blocks.push({ selector: match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: match[2] });
  }
  return blocks;
}

function declarationValues(body: string, property: string): string[] {
  return body
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.startsWith(`${property}:`))
    .map((declaration) => declaration.slice(property.length + 1).trim());
}

function lastValue(body: string, property: string): string | undefined {
  const values = declarationValues(body, property);
  return values[values.length - 1];
}

describe('rootStyles (inline <style>, not minified)', () => {
  const blocks = cssBlocks(rootStyles);
  const rootBlocks = blocks.filter((block) => block.selector === '#root');
  const modalBlock = blocks.find((block) => block.selector === '[aria-modal="true"]');

  it('ends every #root and modal portal height with the visual viewport var', () => {
    expect(rootBlocks.length).toBeGreaterThanOrEqual(2);
    rootBlocks.forEach((block) => {
      expect(lastValue(block.body, 'height')).toBe('var(--app-vh, 100dvh) !important');
    });
    expect(lastValue(modalBlock?.body ?? '', 'height')).toBe('var(--app-vh, 100%) !important');
  });

  it('anchors #root and the modal portal to the top of the visual viewport', () => {
    const mainRoot = rootBlocks.find((block) => block.body.includes('position'));

    [mainRoot, modalBlock].forEach((block) => {
      expect(lastValue(block?.body ?? '', 'top')).toBe('var(--app-vv-top, 0px) !important');
      expect(lastValue(block?.body ?? '', 'bottom')).toBe('auto !important');
    });
  });

  it('hides the elements marked by HIDE_ON_KEYBOARD only while the keyboard is open', () => {
    const [key] = Object.keys(HIDE_ON_KEYBOARD);
    const attribute = `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    const block = blocks.find((candidate) => candidate.selector === `html.keyboard-open [${attribute}]`);

    expect(lastValue(block?.body ?? '', 'display')).toBe('none !important');
  });
});

describe('floating bars hidden while typing', () => {
  // Absolute bars pinned above the tab bar cover the form once #root shrinks to the visible area.
  const markedFiles: [string, number][] = [
    ['src/components/FloatingTabBar.tsx', 1],
    ['src/components/ComprasView.tsx', 1],
    ['src/components/PedidosView.tsx', 1],
    ['src/components/PresupuestoView.tsx', 1],
    ['app/(tabs)/ordenes.tsx', 1],
    ['app/seleccionar-productos.tsx', 2],
  ];

  it.each(markedFiles)('%s keeps its floating bars marked', (file, expected) => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

    expect(source.split('dataSet={HIDE_ON_KEYBOARD}').length - 1).toBe(expected);
  });
});

describe('visualViewportSync', () => {
  interface SyncOptions {
    clientHeight?: number;
    viewportHeight?: number;
    scrollY?: number;
    maxTouchPoints?: number;
    hasVisualViewport?: boolean;
  }

  interface FakeInput {
    tagName: string;
    scrollIntoView: jest.Mock;
  }

  interface SyncHarness {
    vars: Map<string, string>;
    classes: Set<string>;
    removeProperty: jest.Mock;
    scrollTo: jest.Mock;
    windowListeners: ListenerMap;
    moveViewport(height: number, offsetTop?: number): void;
    setActive(element: FakeInput | null): void;
    focus(element: FakeInput): void;
  }

  function fakeElement(tagName = 'INPUT'): FakeInput {
    return { tagName, scrollIntoView: jest.fn() };
  }

  function bootSync(options: SyncOptions = {}): SyncHarness {
    const {
      clientHeight = IOS_STANDALONE.viewportHeight,
      viewportHeight = IOS_STANDALONE.viewportHeight,
      scrollY = 0,
      maxTouchPoints = 5,
      hasVisualViewport = true,
    } = options;
    const vars = new Map<string, string>();
    const classes = new Set<string>();
    const viewportListeners: ListenerMap = {};
    const windowListeners: ListenerMap = {};
    const documentListeners: ListenerMap = {};
    const removeProperty = jest.fn((name: string) => vars.delete(name));
    const scrollTo = jest.fn();
    const visualViewport = {
      height: viewportHeight,
      offsetTop: 0,
      addEventListener: (type: string, listener: Listener) => addListener(viewportListeners, type, listener),
    };

    globals.window = {
      visualViewport: hasVisualViewport ? visualViewport : undefined,
      scrollY,
      scrollTo,
      addEventListener: (type: string, listener: Listener) => addListener(windowListeners, type, listener),
    };
    const doc = {
      activeElement: null as FakeInput | null,
      documentElement: {
        clientHeight,
        style: { setProperty: (name: string, value: string) => vars.set(name, value), removeProperty },
        classList: {
          add: (name: string) => classes.add(name),
          remove: (name: string) => classes.delete(name),
          contains: (name: string) => classes.has(name),
        },
      },
      addEventListener: (type: string, listener: Listener) => addListener(documentListeners, type, listener),
    };
    globals.document = doc;
    stubNavigator({ maxTouchPoints });
    new Function(visualViewportSync)();

    return {
      vars,
      classes,
      removeProperty,
      scrollTo,
      windowListeners,
      moveViewport(height: number, offsetTop = 0): void {
        visualViewport.height = height;
        visualViewport.offsetTop = offsetTop;
        dispatch(viewportListeners, 'resize');
      },
      setActive(element: FakeInput | null): void {
        doc.activeElement = element;
      },
      focus(element: FakeInput): void {
        doc.activeElement = element;
        dispatch(documentListeners, 'focusin', { target: element });
      },
    };
  }

  afterEach(restoreGlobals);

  it('does nothing without the visualViewport API', () => {
    const harness = bootSync({ hasVisualViewport: false });

    expect(harness.vars.size).toBe(0);
    expect(harness.removeProperty).not.toHaveBeenCalled();
    expect(harness.windowListeners).toEqual({});
  });

  it('does nothing on non-touch devices so desktop keeps 100dvh', () => {
    const harness = bootSync({ maxTouchPoints: 0 });

    expect(harness.removeProperty).not.toHaveBeenCalled();
    expect(harness.windowListeners).toEqual({});
  });

  it('leaves the CSS fallbacks in charge while the keyboard is closed', () => {
    const harness = bootSync();

    expect(harness.vars.size).toBe(0);
    expect(harness.removeProperty).toHaveBeenCalledWith('--app-vh');
    expect(harness.removeProperty).toHaveBeenCalledWith('--app-vv-top');
  });

  it('pins the app to the visual viewport when the keyboard opens', () => {
    const harness = bootSync();

    harness.moveViewport(500, 40);

    expect(harness.vars.get('--app-vh')).toBe('500px');
    expect(harness.vars.get('--app-vv-top')).toBe('40px');
  });

  it('treats a shrink of exactly 120px as closed and 121px as an open keyboard', () => {
    const harness = bootSync();

    harness.moveViewport(IOS_STANDALONE.viewportHeight - 120);
    expect(harness.vars.size).toBe(0);

    harness.moveViewport(IOS_STANDALONE.viewportHeight - 121);
    expect(harness.vars.get('--app-vh')).toBe(`${IOS_STANDALONE.viewportHeight - 121}px`);
  });

  it('removes the vars again when the keyboard closes', () => {
    const harness = bootSync();

    harness.moveViewport(500, 40);
    harness.moveViewport(IOS_STANDALONE.viewportHeight);

    expect(harness.vars.size).toBe(0);
  });

  it('snaps a panned page back to the top', () => {
    expect(bootSync({ scrollY: 180 }).scrollTo).toHaveBeenCalledWith(0, 0);
    restoreGlobals();
    expect(bootSync({ scrollY: 0 }).scrollTo).not.toHaveBeenCalled();
  });

  it('also re-syncs on window scroll', () => {
    const harness = bootSync();

    expect(harness.windowListeners.scroll).toHaveLength(1);
  });

  it('flags html.keyboard-open only while the keyboard is open', () => {
    const harness = bootSync();

    expect(harness.classes.has('keyboard-open')).toBe(false);
    harness.moveViewport(500);
    expect(harness.classes.has('keyboard-open')).toBe(true);
    harness.moveViewport(IOS_STANDALONE.viewportHeight);
    expect(harness.classes.has('keyboard-open')).toBe(false);
  });

  describe('focused input while typing', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('scrolls the focused input into view once the keyboard opens', () => {
      const harness = bootSync();
      const input = fakeElement();

      harness.setActive(input);
      harness.moveViewport(500);
      expect(input.scrollIntoView).not.toHaveBeenCalled();
      jest.runOnlyPendingTimers();

      expect(input.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    });

    it('reveals a textarea focused while the keyboard is already open', () => {
      const harness = bootSync();
      const textarea = fakeElement('TEXTAREA');

      harness.moveViewport(500);
      harness.focus(textarea);
      jest.runOnlyPendingTimers();

      expect(textarea.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    });

    it('ignores focus while the keyboard is closed and non-text elements', () => {
      const harness = bootSync();
      const closedInput = fakeElement();
      const button = fakeElement('BUTTON');

      harness.focus(closedInput);
      harness.moveViewport(500);
      harness.focus(button);
      jest.runOnlyPendingTimers();

      expect(closedInput.scrollIntoView).not.toHaveBeenCalled();
      expect(button.scrollIntoView).not.toHaveBeenCalled();
    });

    it('skips the scroll when focus moved away before layout settled', () => {
      const harness = bootSync();
      const input = fakeElement();

      harness.setActive(input);
      harness.moveViewport(500);
      harness.setActive(null);
      jest.runOnlyPendingTimers();

      expect(input.scrollIntoView).not.toHaveBeenCalled();
    });
  });
});

describe('viewportDebugPanel', () => {
  const FLAG = 'serrucho-viewport-debug';

  interface PanelHarness {
    body: FakeElement;
    storage: Map<string, string>;
    windowListeners: ListenerMap;
    writeText: jest.Mock;
    setInnerHeight(height: number): void;
    touch(fingers: number): void;
    release(): void;
  }

  function createElement(): FakeElement {
    const element: FakeElement = {
      style: { cssText: '' },
      children: [],
      parentNode: null,
      textContent: '',
      listeners: {},
      appendChild(child) {
        child.parentNode = element;
        element.children.push(child);
        return child;
      },
      removeChild(child) {
        element.children = element.children.filter((candidate) => candidate !== child);
        child.parentNode = null;
        return child;
      },
      addEventListener(type, listener) {
        addListener(element.listeners, type, listener);
      },
      getBoundingClientRect() {
        const usesLargeViewport = /height:100(vh|lvh)/.test(element.style.cssText);
        const height = usesLargeViewport ? IOS_STANDALONE.screenHeight : IOS_STANDALONE.viewportHeight;
        return { top: 0, height, bottom: height };
      },
    };
    return element;
  }

  function bootPanel(storage = new Map<string, string>()): PanelHarness {
    const body = createElement();
    const root = createElement();
    const windowListeners: ListenerMap = {};
    const writeText = jest.fn(() => Promise.resolve());
    const win = {
      visualViewport: { height: IOS_STANDALONE.viewportHeight, offsetTop: 0, scale: 1 },
      innerHeight: IOS_STANDALONE.viewportHeight,
      outerHeight: IOS_STANDALONE.screenHeight,
      devicePixelRatio: 3,
      scrollY: 0,
      addEventListener: (type: string, listener: Listener) => addListener(windowListeners, type, listener),
    };

    globals.window = win;
    globals.document = {
      body,
      documentElement: { clientHeight: IOS_STANDALONE.viewportHeight },
      createElement,
      getElementById: (id: string) => (id === 'root' ? root : null),
    };
    globals.screen = { width: 430, height: IOS_STANDALONE.screenHeight };
    globals.matchMedia = () => ({ matches: true });
    globals.getComputedStyle = (element: FakeElement) => ({
      paddingTop: element.style?.cssText.includes('safe-area-inset-bottom') ? `${IOS_STANDALONE.safeAreaBottom}px` : '0px',
      getPropertyValue: () => '',
    });
    globals.localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };
    stubNavigator({ userAgent: 'iPhone test', standalone: true, clipboard: { writeText } });
    new Function(viewportDebugPanel)();

    return {
      body,
      storage,
      windowListeners,
      writeText,
      setInnerHeight(height: number): void {
        win.innerHeight = height;
      },
      touch(fingers: number): void {
        dispatch(windowListeners, 'touchstart', { touches: { length: fingers } });
      },
      release(): void {
        dispatch(windowListeners, 'touchend');
      },
    };
  }

  function reportText(harness: PanelHarness): string {
    return harness.body.children[0].children[0].textContent;
  }

  function panelButton(harness: PanelHarness, label: 'Copiar' | 'Cerrar'): FakeElement {
    const index = label === 'Copiar' ? 1 : 2;
    return harness.body.children[0].children[index];
  }

  function openPanel(): PanelHarness {
    const harness = bootPanel();
    harness.touch(2);
    jest.advanceTimersByTime(1000);
    return harness;
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    restoreGlobals();
  });

  it('stays hidden at boot and does not wait for load without the flag', () => {
    const harness = bootPanel();

    expect(harness.body.children).toHaveLength(0);
    expect(harness.windowListeners.load).toBeUndefined();
  });

  it('ignores a one-finger long press', () => {
    const harness = bootPanel();

    harness.touch(1);
    jest.advanceTimersByTime(2000);

    expect(harness.body.children).toHaveLength(0);
  });

  it('ignores a two-finger press released before one second', () => {
    const harness = bootPanel();

    harness.touch(2);
    jest.advanceTimersByTime(500);
    harness.release();
    jest.advanceTimersByTime(1000);

    expect(harness.body.children).toHaveLength(0);
  });

  it('opens on a two-finger long press and remembers it', () => {
    const harness = openPanel();

    expect(harness.body.children).toHaveLength(1);
    expect(harness.storage.get(FLAG)).toBe('1');
  });

  it('reports the numbers that exposed the tab bar bug', () => {
    const text = reportText(openPanel());

    expect(text).toContain('standalone: true | display-mode: true');
    expect(text).toContain('screen: 430x932 @3');
    expect(text).toContain('innerHeight: 873 | outerHeight: 932 | clientHeight: 873');
    expect(text).toContain('100vh: 932.0 | 100dvh: 873.0 | 100svh: 873.0 | 100lvh: 932.0');
    expect(text).toContain('safe-area top: 0px | bottom: 34px');
    expect(text).toContain('#root: top 0.0 | height 873.0 | bottom 873.0');
    expect(text).toContain('--app-vh: - | --app-vv-top: -');
  });

  it('refreshes the report every second', () => {
    const harness = openPanel();

    harness.setInnerHeight(500);
    jest.advanceTimersByTime(1000);

    expect(reportText(harness)).toContain('innerHeight: 500');
  });

  it('copies the report to the clipboard and confirms it', async () => {
    const harness = openPanel();
    const copy = panelButton(harness, 'Copiar');

    dispatch(copy.listeners, 'click');
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.writeText).toHaveBeenCalledWith(expect.stringContaining('clientHeight: 873'));
    expect(copy.textContent).toBe('Copiado');
  });

  it('closes, forgets the flag and stops refreshing', () => {
    const harness = openPanel();

    dispatch(panelButton(harness, 'Cerrar').listeners, 'click');

    expect(harness.body.children).toHaveLength(0);
    expect(harness.storage.has(FLAG)).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('closes with another two-finger long press', () => {
    const harness = openPanel();

    harness.touch(2);
    jest.advanceTimersByTime(1000);

    expect(harness.body.children).toHaveLength(0);
  });

  it('restores itself on load when the flag was left on', () => {
    const harness = bootPanel(new Map([[FLAG, '1']]));

    dispatch(harness.windowListeners, 'load');

    expect(harness.body.children).toHaveLength(1);
  });
});
