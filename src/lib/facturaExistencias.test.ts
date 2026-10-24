import { fetchExistenciasEstrictas } from './facturaExistencias';

// Strict stock reader for the supplier-invoice review: a stock that is not a finite number is unknown, never zero.
// The Supabase transport is a fake; nothing touches a network.

const mockIn = jest.fn();
const mockSelect = jest.fn((_columnas: string) => ({ in: mockIn }));
const mockFrom = jest.fn((_tabla: string) => ({ select: (columnas: string) => mockSelect(columnas) }));
const mockIsDemoActive = jest.fn(() => false);

jest.mock('./supabase', () => ({ supabase: { from: (tabla: string) => mockFrom(tabla) } }));
jest.mock('../demo/useDemoStore', () => ({ isDemoActive: () => mockIsDemoActive() }));

type Fila = { codigo_interno: string; existencia: unknown };
const responde = (filas: Fila[] | null, error: unknown = null) => mockIn.mockResolvedValueOnce({ data: filas, error });
const leerUna = async (existencia: unknown) => {
  responde([{ codigo_interno: 'A', existencia }]);
  return fetchExistenciasEstrictas(['A']);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIsDemoActive.mockReturnValue(false);
});

describe('fetchExistenciasEstrictas', () => {
  it('reads real numbers as they are, keeping zero, negative and fractional stock', async () => {
    responde([
      { codigo_interno: 'CERO', existencia: 0 },
      { codigo_interno: 'NEG', existencia: -3 },
      { codigo_interno: 'FRAC', existencia: 2.5 },
    ]);
    await expect(fetchExistenciasEstrictas(['CERO', 'NEG', 'FRAC'])).resolves.toEqual({ CERO: 0, NEG: -3, FRAC: 2.5 });
    expect(mockFrom).toHaveBeenCalledWith('productos');
    expect(mockSelect).toHaveBeenCalledWith('codigo_interno, existencia');
    expect(mockIn).toHaveBeenCalledWith('codigo_interno', ['CERO', 'NEG', 'FRAC']);
  });

  it.each([
    ['7.50', 7.5],
    ['-3', -3],
    ['+4', 4],
    ['.5', 0.5],
    [' 12 ', 12],
    ['0', 0],
  ])('accepts the explicit decimal string %j as %p', async (crudo, esperado) => {
    await expect(leerUna(crudo)).resolves.toEqual({ A: esperado });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['blank string', '   '],
    ['text', 'abc'],
    ['exponent', '1e3'],
    ['hex', '0x10'],
    ['decimal comma', '1,5'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['overflowing digits', '9'.repeat(400)],
    ['true', true],
    ['false', false],
    ['object', {}],
    ['array', [5]],
  ])('leaves %s out of the map instead of reading it as zero', async (_nombre, crudo) => {
    await expect(leerUna(crudo)).resolves.toEqual({});
  });

  it('omits a requested code that has no row and ignores rows without a code', async () => {
    responde([{ codigo_interno: 'A', existencia: 1 }, { codigo_interno: null as unknown as string, existencia: 9 }]);
    await expect(fetchExistenciasEstrictas(['A', 'SIN-FILA'])).resolves.toEqual({ A: 1 });
  });

  it('asks in bounded chunks of unique codes and never reads the whole catalog', async () => {
    const codigos = Array.from({ length: 450 }, (_, i) => `C${i}`);
    mockIn.mockResolvedValue({ data: [], error: null });
    await fetchExistenciasEstrictas([...codigos, 'C0']);
    expect(mockIn.mock.calls.map(([, tanda]) => (tanda as string[]).length)).toEqual([200, 200, 50]);
    expect(mockSelect).toHaveBeenCalledTimes(3);
  });

  it('does not read anything for an empty list', async () => {
    await expect(fetchExistenciasEstrictas([])).resolves.toEqual({});
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects with the Supabase error instead of returning a partial map', async () => {
    const error = { message: 'permission denied for table productos' };
    responde(null, error);
    await expect(fetchExistenciasEstrictas(['A'])).rejects.toBe(error);
  });

  it('rejects when the transport itself rejects', async () => {
    mockIn.mockRejectedValueOnce(new Error('boom'));
    await expect(fetchExistenciasEstrictas(['A'])).rejects.toThrow('boom');
  });

  it('reads nothing and fabricates no stock in demo mode', async () => {
    mockIsDemoActive.mockReturnValue(true);
    await expect(fetchExistenciasEstrictas(['A'])).resolves.toEqual({});
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
