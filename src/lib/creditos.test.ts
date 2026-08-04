import { parseMonto, saldoEstado, saldoLabel, antiguedad } from './creditos';

/**
 * `parseMonto` es la puerta por donde entra todo el dinero al sistema. Si deja
 * pasar un NaN, un negativo o un número mal interpretado, la cuenta se descuadra
 * sin que nadie lo note. Por eso se prueba a la mala.
 */
describe('parseMonto', () => {
  it('acepta el punto decimal', () => {
    expect(parseMonto('12.50')).toBe(12.5);
    expect(parseMonto('0.01')).toBe(0.01);
  });

  it('acepta la coma decimal venezolana', () => {
    expect(parseMonto('12,50')).toBe(12.5);
  });

  it('interpreta el punto como separador de miles cuando hay coma decimal', () => {
    expect(parseMonto('1.250,00')).toBe(1250);
    expect(parseMonto('12.345,67')).toBe(12345.67);
  });

  it('ignora los espacios de sobra', () => {
    expect(parseMonto('  45.00  ')).toBe(45);
  });

  it('rechaza el vacío', () => {
    expect(parseMonto('')).toBeNull();
    expect(parseMonto('   ')).toBeNull();
  });

  it('rechaza el cero: no existe un abono de cero', () => {
    expect(parseMonto('0')).toBeNull();
    expect(parseMonto('0.00')).toBeNull();
    expect(parseMonto('0,00')).toBeNull();
  });

  it('rechaza negativos: la dirección la da el tipo, nunca el signo', () => {
    expect(parseMonto('-50')).toBeNull();
    expect(parseMonto('-0.01')).toBeNull();
  });

  it('rechaza texto y basura', () => {
    expect(parseMonto('abc')).toBeNull();
    expect(parseMonto('12abc')).toBeNull();
    expect(parseMonto('$50')).toBeNull();
    expect(parseMonto('1.2.3')).toBeNull();
  });

  it('rechaza Infinity y NaN escritos a mano', () => {
    expect(parseMonto('Infinity')).toBeNull();
    expect(parseMonto('NaN')).toBeNull();
    expect(parseMonto('1e10')).toBeNull();
  });

  it('rechaza montos absurdos (>= 1 millón)', () => {
    expect(parseMonto('1000000')).toBeNull();
    expect(parseMonto('999999.99')).toBe(999999.99);
  });

  it('redondea a 2 decimales para calzar con numeric(14,2)', () => {
    expect(parseMonto('10.999')).toBe(11);
    expect(parseMonto('10.994')).toBe(10.99);
    expect(parseMonto('0.005')).toBe(0.01);
  });
});

describe('saldoEstado', () => {
  it('distingue deber, estar al día y tener a favor', () => {
    expect(saldoEstado(45.5)).toBe('debe');
    expect(saldoEstado(0)).toBe('al_dia');
    expect(saldoEstado(-20)).toBe('a_favor');
  });

  it('trata la basura de punto flotante como cero', () => {
    // Postgres devuelve numeric(14,2), pero JSON lo entrega como float: un saldo
    // saldado puede llegar como 1e-15. Mostrar "Debe $0.00" destruiría la
    // confianza en el sistema.
    expect(saldoEstado(1e-15)).toBe('al_dia');
    expect(saldoEstado(-1e-15)).toBe('al_dia');
    expect(saldoEstado(0.004)).toBe('al_dia');
  });

  it('un centavo real sí cuenta como deuda', () => {
    expect(saldoEstado(0.01)).toBe('debe');
    expect(saldoEstado(-0.01)).toBe('a_favor');
  });
});

describe('saldoLabel', () => {
  it('habla en lenguaje de mostrador', () => {
    expect(saldoLabel(30)).toBe('Debe');
    expect(saldoLabel(0)).toBe('Al día');
    expect(saldoLabel(-5)).toBe('A favor');
  });
});

describe('antiguedad', () => {
  function diasAtras(dias: number): string {
    const d = new Date();
    d.setDate(d.getDate() - dias);
    return d.toISOString().slice(0, 10);
  }

  it('describe una cuenta sin movimientos', () => {
    expect(antiguedad(null)).toBe('sin movimientos');
  });

  it('usa palabras, no fechas, para lo reciente', () => {
    expect(antiguedad(diasAtras(0))).toBe('hoy');
    expect(antiguedad(diasAtras(1))).toBe('ayer');
    expect(antiguedad(diasAtras(5))).toBe('hace 5 días');
  });

  it('resume lo viejo en meses y años', () => {
    expect(antiguedad(diasAtras(45))).toBe('hace 1 mes');
    expect(antiguedad(diasAtras(90))).toBe('hace 3 meses');
    expect(antiguedad(diasAtras(500))).toBe('hace más de un año');
  });
});
