import { htmlToPdfBlob, downloadOrSharePdfWeb, printWebPdf } from './webPdf.web';

const mockAddPage = jest.fn();
const mockAddImage = jest.fn();
const mockOutput = jest.fn().mockReturnValue(new Blob(['pdf-bytes'], { type: 'application/pdf' }));
const mockHtml2Canvas = jest.fn();

jest.mock('jspdf', () => {
  return {
    jsPDF: jest.fn().mockImplementation(() => ({
      addPage: mockAddPage,
      addImage: mockAddImage,
      output: mockOutput,
    })),
  };
});

jest.mock('html2canvas-pro', () => ({
  __esModule: true,
  default: (...args: any[]) => mockHtml2Canvas(...args),
}));

describe('webPdf in Node / Non-browser environment', () => {
  it('returns a fallback Blob when document/window is undefined', async () => {
    const html = '<html><body>Test</body></html>';
    const blob = await htmlToPdfBlob(html);
    expect(blob).toBeDefined();
    expect(blob.type).toBe('application/pdf');
  });

  it('handles downloadOrSharePdfWeb safely in non-browser environment without throwing', async () => {
    const blob = new Blob(['dummy'], { type: 'application/pdf' });
    await expect(downloadOrSharePdfWeb(blob, 'test.pdf')).resolves.toBeUndefined();
  });

  it('runs printWebPdf safely without throwing in non-browser environment', async () => {
    await expect(printWebPdf('<html><body>Test</body></html>', 'test.pdf')).resolves.toBeUndefined();
  });
});

describe('downloadOrSharePdfWeb in browser environment', () => {
  const originalWindow = global.window;
  const originalDocument = global.document;
  const originalNavigator = global.navigator;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runAllTimers();
    jest.useRealTimers();
    (global as any).window = originalWindow;
    (global as any).document = originalDocument;
    (global as any).navigator = originalNavigator;
    jest.restoreAllMocks();
  });

  it('shares file via navigator.share when canShare is supported', async () => {
    const shareMock = jest.fn().mockResolvedValue(undefined);
    const canShareMock = jest.fn().mockReturnValue(true);

    (global as any).window = {};
    (global as any).document = {
      createElement: jest.fn(),
      body: { appendChild: jest.fn(), removeChild: jest.fn(), contains: jest.fn() },
    };
    (global as any).navigator = {
      canShare: canShareMock,
      share: shareMock,
    };

    const blob = new Blob(['pdf-data'], { type: 'application/pdf' });
    await downloadOrSharePdfWeb(blob, 'Presupuesto_1.pdf');

    expect(canShareMock).toHaveBeenCalled();
    expect(shareMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Presupuesto_1.pdf',
      })
    );
  });

  it('falls back to direct download when navigator.canShare returns false for files', async () => {
    const clickMock = jest.fn();
    const fakeAnchor: any = {
      href: '',
      download: '',
      click: clickMock,
    };

    const appendChildMock = jest.fn();
    const removeChildMock = jest.fn();
    const containsMock = jest.fn().mockReturnValue(true);

    (global as any).window = {};
    (global as any).document = {
      createElement: jest.fn().mockReturnValue(fakeAnchor),
      body: {
        appendChild: appendChildMock,
        removeChild: removeChildMock,
        contains: containsMock,
      },
    };
    (global as any).navigator = {
      canShare: jest.fn().mockReturnValue(false),
      share: jest.fn(),
    };

    global.URL.createObjectURL = jest.fn().mockReturnValue('blob:test-url');
    global.URL.revokeObjectURL = jest.fn();

    const blob = new Blob(['pdf-data'], { type: 'application/pdf' });
    await downloadOrSharePdfWeb(blob, 'Documento.pdf');

    expect(fakeAnchor.download).toBe('Documento.pdf');
    expect(clickMock).toHaveBeenCalled();
    expect((global as any).navigator.share).not.toHaveBeenCalled();
  });

  it('falls back to <a> click when navigator.share throws unexpected error (e.g. NotAllowedError)', async () => {
    const notAllowedError = new Error('Permission denied');
    notAllowedError.name = 'NotAllowedError';

    const shareMock = jest.fn().mockRejectedValue(notAllowedError);
    const canShareMock = jest.fn().mockReturnValue(true);
    const clickMock = jest.fn();
    const fakeAnchor: any = {
      href: '',
      download: '',
      click: clickMock,
    };

    (global as any).window = {};
    (global as any).document = {
      createElement: jest.fn().mockReturnValue(fakeAnchor),
      body: { appendChild: jest.fn(), removeChild: jest.fn(), contains: jest.fn().mockReturnValue(true) },
    };
    (global as any).navigator = {
      canShare: canShareMock,
      share: shareMock,
    };

    global.URL.createObjectURL = jest.fn().mockReturnValue('blob:fallback-url');
    global.URL.revokeObjectURL = jest.fn();

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const blob = new Blob(['pdf-data'], { type: 'application/pdf' });
    await downloadOrSharePdfWeb(blob, 'Recibo_123.pdf');

    expect(shareMock).toHaveBeenCalled();
    expect(clickMock).toHaveBeenCalled();
    expect(fakeAnchor.download).toBe('Recibo_123.pdf');
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it('does NOT trigger download fallback when share is cancelled by user (AbortError)', async () => {
    const abortError = new Error('Share canceled');
    abortError.name = 'AbortError';

    const shareMock = jest.fn().mockRejectedValue(abortError);
    const canShareMock = jest.fn().mockReturnValue(true);
    const createElementMock = jest.fn();

    (global as any).window = {};
    (global as any).document = {
      createElement: createElementMock,
      body: { appendChild: jest.fn(), removeChild: jest.fn(), contains: jest.fn() },
    };
    (global as any).navigator = {
      canShare: canShareMock,
      share: shareMock,
    };

    const blob = new Blob(['pdf-data'], { type: 'application/pdf' });
    await downloadOrSharePdfWeb(blob, 'Presupuesto_1.pdf');

    expect(shareMock).toHaveBeenCalled();
    expect(createElementMock).not.toHaveBeenCalled();
  });
});

describe('printWebPdf fallback on generation failure', () => {
  const originalWindow = global.window;
  const originalDocument = global.document;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runAllTimers();
    jest.useRealTimers();
    (global as any).window = originalWindow;
    (global as any).document = originalDocument;
    jest.restoreAllMocks();
  });

  it('falls back to downloading .html file when canvas/PDF generation fails', async () => {
    const clickMock = jest.fn();
    const fakeAnchor: any = {
      href: '',
      download: '',
      click: clickMock,
    };

    (global as any).window = {};
    (global as any).document = {
      createElement: jest.fn((tag: string) => {
        if (tag === 'iframe') {
          // Returning an iframe with no contentDocument to force an error
          return {
            style: {},
            contentDocument: null,
            contentWindow: null,
          };
        }
        return fakeAnchor;
      }),
      body: {
        appendChild: jest.fn(),
        removeChild: jest.fn(),
        contains: jest.fn().mockReturnValue(true),
      },
    };

    global.URL.createObjectURL = jest.fn().mockReturnValue('blob:html-fallback');
    global.URL.revokeObjectURL = jest.fn();

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await printWebPdf('<h1>Documento Fallback</h1>', 'Presupuesto_99.pdf');

    expect(fakeAnchor.download).toBe('Presupuesto_99.html');
    expect(clickMock).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe('htmlToPdfBlob in simulated browser environment', () => {
  const originalWindow = global.window;
  const originalDocument = global.document;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    (global as any).window = originalWindow;
    (global as any).document = originalDocument;
    jest.restoreAllMocks();
  });

  function setupMockDom(canvasWidth: number, canvasHeight: number, fontRejects = false) {
    const mockCanvas = {
      width: canvasWidth,
      height: canvasHeight,
      toDataURL: jest.fn().mockReturnValue('data:image/jpeg;base64,mock'),
    };
    mockHtml2Canvas.mockResolvedValue(mockCanvas);

    const mockSliceCanvas = {
      width: 0,
      height: 0,
      getContext: jest.fn().mockReturnValue({
        fillStyle: '',
        fillRect: jest.fn(),
        drawImage: jest.fn(),
      }),
      toDataURL: jest.fn().mockReturnValue('data:image/jpeg;base64,mockslice'),
    };

    const removeChildMock = jest.fn();
    const appendChildMock = jest.fn();

    const iframeDoc = {
      open: jest.fn(),
      write: jest.fn(),
      close: jest.fn(),
      fonts: {
        ready: fontRejects ? Promise.reject(new Error('Font timeout')) : Promise.resolve(),
      },
      querySelector: jest.fn().mockReturnValue({ tagName: 'DIV', className: 'ticket' }),
      body: { tagName: 'BODY' },
    };

    const mockIframe: any = {
      style: {},
      contentDocument: iframeDoc,
      contentWindow: { document: iframeDoc },
    };

    (global as any).window = {};
    (global as any).document = {
      createElement: jest.fn((tag: string) => {
        if (tag === 'iframe') return mockIframe;
        if (tag === 'canvas') return mockSliceCanvas;
        return { style: {} };
      }),
      body: {
        appendChild: appendChildMock,
        removeChild: removeChildMock,
        contains: jest.fn().mockReturnValue(true),
      },
    };

    return { iframeDoc, removeChildMock, mockIframe };
  }

  it('renders a single-page document without calling addPage', async () => {
    const { removeChildMock, mockIframe } = setupMockDom(850, 700);

    const blob = await htmlToPdfBlob('<div class="ticket">Single Page</div>');

    expect(blob).toBeDefined();
    expect(mockAddImage).toHaveBeenCalledTimes(1);
    expect(mockAddPage).not.toHaveBeenCalled();
    expect(removeChildMock).toHaveBeenCalledWith(mockIframe);
  });

  it('renders a multi-page document and adds pages for canvas slices', async () => {
    // Canvas height 3000px on 850px width -> total height ~2018 pt > 752 pt -> multiple pages
    const { removeChildMock, mockIframe } = setupMockDom(850, 3000);

    const blob = await htmlToPdfBlob('<div class="ticket">Long Multi Page</div>');

    expect(blob).toBeDefined();
    expect(mockAddPage).toHaveBeenCalled();
    expect(mockAddImage.mock.calls.length).toBeGreaterThan(1);
    expect(removeChildMock).toHaveBeenCalledWith(mockIframe);
  });

  it('continues rendering even if font loading promise rejects', async () => {
    setupMockDom(850, 500, true);

    const blob = await htmlToPdfBlob('<div class="ticket">Font Failure</div>');

    expect(blob).toBeDefined();
    expect(mockAddImage).toHaveBeenCalledTimes(1);
  });
});
