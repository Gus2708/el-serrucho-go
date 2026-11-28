import * as React from 'react';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import type { ExtraidoDescuento, ExtraidoImpuesto } from '../lib/facturaExtractionContract';
import type {
  CabeceraCampoEscalar,
  CalculoRevision,
  DecisionCabecera,
  Edicion,
  FacturaEfectiva,
  LineaEfectiva,
  TipoDocumento,
  ValorEfectivo,
} from '../lib/facturaRevision';
import {
  edicionFactorUno,
  edicionDescuentoFactura,
  edicionesIvaFactura,
  estadoIvaFactura,
  leerPorcentajesFactura,
  resumenDescuentoFactura,
  type EstadoIvaFactura,
  type ResumenDescuentoFactura,
} from '../lib/facturaRevisionPasos';

// ── Shared building blocks (also used by FacturaRevisionLinea) ──────────────

/**
 * Exact USD text from a domain decimal string: formatUSD's convention (symbol, thousands separators, at least two
 * decimals) without ever converting to a binary number, so extra precision (e.g. 21.982) is preserved.
 */
export function formatoUsdExacto(valor: string | null): string {
  if (valor === null) return 'desconocido';
  const negativo = valor.startsWith('-');
  const [entero, fraccion = ''] = valor.replace('-', '').split('.');
  return `${negativo ? '-' : ''}$${entero.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraccion.padEnd(2, '0')}`;
}

/** "(USD)" in a label is a claim; it is only made while the document currency is confirmed USD. */
export function etiquetaMonto(label: string, esUsd: boolean): string {
  return esUsd ? label : label.replace('(USD)', '(moneda del documento)');
}

/** Replaces any monetary amount (printed, corrected, typed or calculated) while the currency is not confirmed USD. */
export function avisoImporteOculto(moneda: string | null): string {
  return `Importe oculto: moneda ${moneda ?? 'desconocida'} sin conversión aprobada a USD`;
}

interface BotonProps {
  testID: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  danger?: boolean;
  /** The one gold action of a stage; everything else stays neutral unless selected or destructive. */
  primary?: boolean;
}

interface ColoresBoton {
  borderColor: string;
  backgroundColor: string;
  textColor: string;
}

function resolverColoresBoton(
  params: { disabled: boolean; primary: boolean; selected: boolean; danger: boolean },
  colors: ReturnType<typeof useTheme>['colors'],
): ColoresBoton {
  if (params.disabled) {
    return { borderColor: colors.border, backgroundColor: colors.surfaceAlt, textColor: colors.textMuted };
  }
  if (params.primary) {
    return { borderColor: colors.primary, backgroundColor: colors.primary, textColor: colors.onPrimary };
  }
  if (params.selected) {
    return { borderColor: colors.primary, backgroundColor: colors.primaryFaded, textColor: colors.primary };
  }
  if (params.danger) {
    return { borderColor: colors.danger, backgroundColor: colors.surface, textColor: colors.danger };
  }
  return { borderColor: colors.border, backgroundColor: colors.surface, textColor: colors.text };
}

export function Boton({ testID, label, onPress, disabled = false, selected = false, danger = false, primary = false }: BotonProps): React.JSX.Element {
  const { colors } = useTheme();
  const palette = resolverColoresBoton({ disabled, primary, selected, danger }, colors);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.boton,
        {
          borderColor: palette.borderColor,
          backgroundColor: palette.backgroundColor,
          opacity: !disabled && pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[styles.botonTexto, { color: palette.textColor }]}>{label}</Text>
    </Pressable>
  );
}

interface BotonDespliegueProps {
  testID: string;
  label: string;
  abierto: boolean;
  onPress: () => void;
  /** Draws a full-width bordered neutral trigger when the disclosure stands on its own row. */
  bordered?: boolean;
}

/** Text button that opens or closes a disclosure; the open state is exposed to assistive technology. */
export function BotonDespliegue({ testID, label, abierto, onPress, bordered = false }: BotonDespliegueProps): React.JSX.Element {
  const { colors } = useTheme();
  const colorTexto = abierto ? colors.primary : colors.text;
  const colorIcono = abierto ? colors.primary : colors.textMuted;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: abierto }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.despliegue,
        bordered && [styles.despliegueBorde, { borderColor: abierto ? colors.primary : colors.border, backgroundColor: colors.surface }],
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.botonTexto, bordered && styles.despliegueTextoIzq, { color: colorTexto }]}>{label}</Text>
      <Feather name={abierto ? 'chevron-up' : 'chevron-down'} size={16} color={colorIcono} />
    </Pressable>
  );
}

export function Entrada(props: {
  testID: string;
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'decimal-pad';
  /** Replaces the label as the placeholder; always drawn with the muted token so it stays readable. */
  placeholder?: string;
  legible?: boolean;
  hint?: string;
}): React.JSX.Element {
  const { colors } = useTheme();
  const { testID, label, value, onChangeText, keyboardType = 'default', placeholder = label, hint } = props;
  return (
    <TextInput
      testID={testID}
      accessibilityLabel={label}
      accessibilityHint={hint}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      value={value}
      onChangeText={onChangeText}
      keyboardType={keyboardType}
      autoCorrect={false}
      style={[styles.entrada, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
    />
  );
}

type TonoTexto = 'text' | 'muted' | 'danger' | 'warning' | 'success' | 'primary';

export function Texto({ testID, children, tone = 'text', small = false, live = false }: { testID?: string; children: React.ReactNode; tone?: TonoTexto; small?: boolean; live?: boolean }): React.JSX.Element {
  const { colors } = useTheme();
  const color = { text: colors.text, muted: colors.textMuted, danger: colors.danger, warning: colors.warning, success: colors.success, primary: colors.primary }[tone];
  return (
    <Text testID={testID} accessibilityLiveRegion={live ? 'polite' : undefined} style={[small ? styles.chico : styles.texto, { color }]}>
      {children}
    </Text>
  );
}

/**
 * Original (read-only) above the corrected value, with a motivated correction form. Stacks on narrow screens.
 * `oculto` (a monetary field while the currency is not confirmed USD) replaces the whole field with that notice:
 * the stored value stays untouched but is neither shown nor editable.
 */
export function CampoCorregible(props: {
  base: string;
  label: string;
  efectivo: ValorEfectivo<string | null>;
  keyboardType?: 'default' | 'decimal-pad';
  oculto?: string | null;
  onAplicar: (valor: string, motivo: string) => void;
  onRevertir: () => void;
}): React.JSX.Element {
  const { colors } = useTheme();
  const { base, label, efectivo, keyboardType, oculto, onAplicar, onRevertir } = props;
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const listo = valor.trim() !== '' && motivo.trim() !== '';
  if (oculto) {
    return (
      <View style={[styles.campo, { borderColor: colors.border }]}>
        <Texto small tone="muted">{label}</Texto>
        <Texto testID={`${base}-oculto`} small tone="warning">{oculto}</Texto>
      </View>
    );
  }
  return (
    <View style={[styles.campo, { borderColor: colors.border }]}>
      <Texto small tone="muted">{label}</Texto>
      <Texto testID={`${base}-original`} small>{`Original: ${efectivo.original ?? 'ilegible'}`}</Texto>
      {efectivo.corregido ? (
        <>
          <Texto testID={`${base}-corregido`} tone="primary">{`Corregido: ${efectivo.valor ?? 'sin valor'}`}</Texto>
          <Texto testID={`${base}-motivo-aplicado`} small tone="muted">{`Motivo: ${efectivo.motivo ?? ''}`}</Texto>
          <Boton testID={`${base}-revertir`} label="Revertir corrección" onPress={onRevertir} danger />
        </>
      ) : null}
      <Entrada testID={`${base}-valor`} label={`${label}: nuevo valor`} value={valor} onChangeText={setValor} keyboardType={keyboardType} />
      <Entrada testID={`${base}-motivo`} label="Motivo de la corrección" value={motivo} onChangeText={setMotivo} />
      <Boton
        testID={`${base}-aplicar`}
        label="Aplicar corrección"
        disabled={!listo}
        onPress={() => {
          onAplicar(valor.trim(), motivo.trim());
          setValor('');
          setMotivo('');
        }}
      />
    </View>
  );
}

/** Yes / No buttons for a three-state decision; no button selected means "not decided". */
export function Triestado(props: { base: string; label: string; valor: boolean | null; onChange: (valor: boolean) => void }): React.JSX.Element {
  const { base, label, valor, onChange } = props;
  let estado = 'Sin definir';
  if (valor === true) estado = 'Sí';
  else if (valor === false) estado = 'No';
  return (
    <View style={styles.triestado}>
      <View style={styles.triestadoEtiqueta}>
        <Texto>{label}</Texto>
        <Texto small tone={valor === null ? 'warning' : 'muted'}>{estado}</Texto>
      </View>
      <View style={styles.fila}>
        <Boton testID={`${base}-si`} label="Sí" selected={valor === true} onPress={() => onChange(true)} />
        <Boton testID={`${base}-no`} label="No" selected={valor === false} onPress={() => onChange(false)} />
      </View>
    </View>
  );
}

// ── Typed rows for ordered discounts and header tax summaries ───────────────

interface FilaDescuento {
  porcentaje: string;
  monto: string;
  alcance: 'renglon' | 'global' | null;
  incluido: boolean | null;
}
interface FilaImpuesto {
  tasa: string;
  base: string;
  monto: string;
  exento: boolean | null;
}

const blank = (text: string): string | null => (text.trim() === '' ? null : text.trim());

function descuentosAFilas(lista: readonly ExtraidoDescuento[]): FilaDescuento[] {
  return lista.map(d => ({ porcentaje: d.porcentaje ?? '', monto: d.monto ?? '', alcance: d.alcance, incluido: d.incluidoEnPrecio }));
}
function filasADescuentos(filas: readonly FilaDescuento[]): ExtraidoDescuento[] {
  return filas.map((f, index) => ({ orden: index + 1, porcentaje: blank(f.porcentaje), monto: blank(f.monto), alcance: f.alcance, incluidoEnPrecio: f.incluido }));
}
function impuestosAFilas(lista: readonly ExtraidoImpuesto[]): FilaImpuesto[] {
  return lista.map(i => ({ tasa: i.tasa ?? '', base: i.base ?? '', monto: i.monto ?? '', exento: i.exento }));
}
function filasAImpuestos(filas: readonly FilaImpuesto[]): ExtraidoImpuesto[] {
  return filas.map(f => ({ tasa: blank(f.tasa), base: blank(f.base), monto: blank(f.monto), exento: f.exento }));
}

/** Editable table of discounts or tax rows: typed fields per row, one motive, applied as a complete array. */
export function FilasLista(props: {
  base: string;
  tipo: 'descuentos' | 'impuestos';
  titulo: string;
  /** Notice that replaces every amount input of a row while the currency is not confirmed USD; null in USD. */
  oculto: string | null;
  efectivo: ValorEfectivo<readonly ExtraidoDescuento[]> | ValorEfectivo<readonly ExtraidoImpuesto[]>;
  onAplicar: (valor: ExtraidoDescuento[] | ExtraidoImpuesto[], motivo: string) => void;
}): React.JSX.Element {
  const { base, tipo, titulo, efectivo, oculto, onAplicar } = props;
  const { colors } = useTheme();
  const actual = efectivo.valor as readonly ExtraidoDescuento[] & readonly ExtraidoImpuesto[];
  const [descuentos, setDescuentos] = useState<FilaDescuento[]>(() => (tipo === 'descuentos' ? descuentosAFilas(actual) : []));
  const [impuestos, setImpuestos] = useState<FilaImpuesto[]>(() => (tipo === 'impuestos' ? impuestosAFilas(actual) : []));
  const [motivo, setMotivo] = useState('');
  const firmaActual = JSON.stringify(actual);

  useEffect(() => {
    if (tipo === 'descuentos') setDescuentos(descuentosAFilas(actual));
    else setImpuestos(impuestosAFilas(actual));
    // Re-sync when the applied value changes (apply, revert, reopen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaActual, tipo]);

  const propuesto = tipo === 'descuentos' ? filasADescuentos(descuentos) : filasAImpuestos(impuestos);
  const cambio = JSON.stringify(propuesto) !== firmaActual;
  const listo = cambio && motivo.trim() !== '';

  const setD = (i: number, parte: Partial<FilaDescuento>) => setDescuentos(rows => rows.map((r, k) => (k === i ? { ...r, ...parte } : r)));
  const setI = (i: number, parte: Partial<FilaImpuesto>) => setImpuestos(rows => rows.map((r, k) => (k === i ? { ...r, ...parte } : r)));
  const total = tipo === 'descuentos' ? descuentos.length : impuestos.length;

  return (
    <View style={[styles.campo, { borderColor: colors.border }]}>
      <Texto small tone="muted">{titulo}</Texto>
      <Texto testID={`${base}-original`} small>{`Original: ${efectivo.original.length} fila(s)`}</Texto>
      {Array.from({ length: total }, (_x, i) => (
        <View key={i} style={[styles.filaCaja, { borderColor: colors.border }]}>
          <Texto small tone="muted">{`Fila ${i + 1}`}</Texto>
          {tipo === 'descuentos' ? (
            <>
              <Entrada testID={`${base}-${i}-porcentaje`} label="Porcentaje (%)" value={descuentos[i].porcentaje} keyboardType="decimal-pad" onChangeText={v => setD(i, { porcentaje: v })} />
              {oculto ? (
                <Texto testID={`${base}-${i}-importes-oculto`} small tone="warning">{oculto}</Texto>
              ) : (
                <Entrada testID={`${base}-${i}-monto`} label="Monto (USD)" value={descuentos[i].monto} keyboardType="decimal-pad" onChangeText={v => setD(i, { monto: v })} />
              )}
              <View style={styles.fila}>
                <Boton testID={`${base}-${i}-alcance-renglon`} label="Renglón" selected={descuentos[i].alcance === 'renglon'} onPress={() => setD(i, { alcance: 'renglon' })} />
                <Boton testID={`${base}-${i}-alcance-global`} label="Global" selected={descuentos[i].alcance === 'global'} onPress={() => setD(i, { alcance: 'global' })} />
              </View>
              <View style={styles.fila}>
                <Boton testID={`${base}-${i}-incluido-si`} label="Ya incluido en el precio" selected={descuentos[i].incluido === true} onPress={() => setD(i, { incluido: true })} />
                <Boton testID={`${base}-${i}-incluido-no`} label="No incluido" selected={descuentos[i].incluido === false} onPress={() => setD(i, { incluido: false })} />
              </View>
              <Texto small tone={descuentos[i].alcance === null || descuentos[i].incluido === null ? 'warning' : 'muted'}>
                {descuentos[i].alcance === null || descuentos[i].incluido === null ? 'Alcance o inclusión sin definir: bloquea el cálculo.' : 'Definido'}
              </Texto>
            </>
          ) : (
            <>
              <Entrada testID={`${base}-${i}-tasa`} label="Tasa (%)" value={impuestos[i].tasa} keyboardType="decimal-pad" onChangeText={v => setI(i, { tasa: v })} />
              {oculto ? (
                <Texto testID={`${base}-${i}-importes-oculto`} small tone="warning">{oculto}</Texto>
              ) : (
                <>
                  <Entrada testID={`${base}-${i}-base`} label="Base (USD)" value={impuestos[i].base} keyboardType="decimal-pad" onChangeText={v => setI(i, { base: v })} />
                  <Entrada testID={`${base}-${i}-monto`} label="Monto del IVA (USD)" value={impuestos[i].monto} keyboardType="decimal-pad" onChangeText={v => setI(i, { monto: v })} />
                </>
              )}
              <View style={styles.fila}>
                <Boton testID={`${base}-${i}-exento-si`} label="Exento" selected={impuestos[i].exento === true} onPress={() => setI(i, { exento: true })} />
                <Boton testID={`${base}-${i}-exento-no`} label="No exento" selected={impuestos[i].exento === false} onPress={() => setI(i, { exento: false })} />
              </View>
            </>
          )}
          <Boton
            testID={`${base}-${i}-quitar`}
            label="Quitar fila"
            danger
            onPress={() => (tipo === 'descuentos' ? setDescuentos(rows => rows.filter((_r, k) => k !== i)) : setImpuestos(rows => rows.filter((_r, k) => k !== i)))}
          />
        </View>
      ))}
      <Boton
        testID={`${base}-agregar`}
        label={tipo === 'descuentos' ? 'Agregar descuento' : 'Agregar fila de IVA'}
        disabled={total >= 20}
        onPress={() => (tipo === 'descuentos' ? setDescuentos(rows => [...rows, { porcentaje: '', monto: '', alcance: null, incluido: null }]) : setImpuestos(rows => [...rows, { tasa: '', base: '', monto: '', exento: null }]))}
      />
      <Entrada testID={`${base}-motivo`} label="Motivo de la corrección" value={motivo} onChangeText={setMotivo} />
      <Boton
        testID={`${base}-aplicar`}
        label="Aplicar lista"
        disabled={!listo}
        onPress={() => {
          onAplicar(propuesto as ExtraidoDescuento[] & ExtraidoImpuesto[], motivo.trim());
          setMotivo('');
        }}
      />
      {efectivo.corregido ? <Texto small tone="muted">{`Corregido (${efectivo.valor.length} fila(s)). Motivo: ${efectivo.motivo ?? ''}`}</Texto> : null}
    </View>
  );
}

// ── Header section ──────────────────────────────────────────────────────────

interface CampoCabecera {
  campo: CabeceraCampoEscalar;
  label: string;
  decimal?: boolean;
  monetario?: boolean;
}

const CAMPOS_PRINCIPALES: ReadonlyArray<CampoCabecera> = [
  { campo: 'proveedorNombre', label: 'Proveedor' },
  { campo: 'numeroDocumento', label: 'Número de factura' },
  { campo: 'fechaEmision', label: 'Fecha (AAAA-MM-DD)' },
  { campo: 'moneda', label: 'Moneda del documento' },
];

const CAMPOS_ADICIONALES: ReadonlyArray<CampoCabecera> = [
  { campo: 'numeroControl', label: 'Número de control' },
  { campo: 'subtotal', label: 'Subtotal impreso', decimal: true, monetario: true },
  { campo: 'total', label: 'Total impreso', decimal: true, monetario: true },
];

const PREGUNTAS_COMPRA: ReadonlyArray<{ campo: DecisionCabecera; label: string; ayuda: string }> = [
  { campo: 'documentoCompletoConfirmado', label: '¿Tienes todas las hojas de la factura?', ayuda: 'Confirma que no falta ninguna hoja ni producto.' },
  { campo: 'recepcionCompleta', label: '¿Recibiste toda la mercancía?', ayuda: 'Confirma que recibiste toda la mercancía antes de continuar.' },
];

const TIPOS_DOCUMENTO: ReadonlyArray<{ valor: TipoDocumento | null; testID: string; label: string }> = [
  { valor: 'factura', testID: 'revision-tipo-factura', label: 'Factura' },
  { valor: 'nota_entrega', testID: 'revision-tipo-nota_entrega', label: 'Nota de entrega' },
  { valor: null, testID: 'revision-tipo-sin-definir', label: 'Sin definir' },
];

type OnEditar = (edicion: Edicion) => void;

function textoDelValor(valor: string | null, esMonto: boolean): string {
  if (valor === null) return 'Sin dato';
  return esMonto ? formatoUsdExacto(valor) : valor;
}

function FilaDato(props: { dato: CampoCabecera; efectivo: ValorEfectivo<string | null>; esUsd: boolean; oculto: string | null; onEditar: OnEditar }): React.JSX.Element {
  const { dato, efectivo, esUsd, oculto, onEditar } = props;
  const { campo, label, decimal, monetario } = dato;
  const [abierta, setAbierta] = useState(false);
  const base = `revision-cab-${campo}`;
  const campoCorregible = (
    <CampoCorregible
      base={base}
      label={label}
      efectivo={efectivo}
      keyboardType={decimal ? 'decimal-pad' : 'default'}
      oculto={monetario ? oculto : null}
      onAplicar={(valor, motivo) => onEditar({ tipo: 'cabecera_escalar', campo, valor, motivo })}
      onRevertir={() => onEditar({ tipo: 'revertir_cabecera', campo })}
    />
  );
  // A hidden amount has nothing to show or correct: its notice replaces the whole row.
  if (monetario && oculto) return campoCorregible;
  const valor = textoDelValor(efectivo.valor, monetario === true && esUsd);
  return (
    <View style={styles.filaDatoCaja}>
      <View style={styles.fila}>
        <View style={styles.crece}>
          <Texto small tone="muted">{label}</Texto>
          <Texto tone={efectivo.valor === null ? 'warning' : 'text'}>{`${valor}${efectivo.corregido ? ' (corregido)' : ''}`}</Texto>
        </View>
        <BotonDespliegue testID={`${base}-corregir`} label="Corregir" abierto={abierta} onPress={() => setAbierta(actual => !actual)} />
      </View>
      {abierta ? campoCorregible : null}
    </View>
  );
}

/** What the reading found, one value per row; every correction keeps its motive and stays one tap away. */
export function ResumenCabecera(props: { efectiva: FacturaEfectiva; calculo: CalculoRevision; onEditar: OnEditar }): React.JSX.Element {
  const { colors } = useTheme();
  const { efectiva, calculo, onEditar } = props;
  const [masDatos, setMasDatos] = useState(false);
  const esUsd = calculo.moneda === 'USD';
  const oculto = esUsd ? null : avisoImporteOculto(calculo.moneda);
  const fila = (dato: CampoCabecera) => <FilaDato key={dato.campo} dato={dato} efectivo={efectiva.campos[dato.campo]} esUsd={esUsd} oculto={oculto} onEditar={onEditar} />;
  return (
    <View testID="revision-resumen" style={[styles.tarjeta, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Texto tone="primary">Leído de la foto</Texto>
      {CAMPOS_PRINCIPALES.map(fila)}
      {calculo.moneda !== null && calculo.moneda !== 'USD' ? (
        <Texto small tone="warning">{`Moneda ${calculo.moneda}: los importes se conservan sin convertir. No hay tasa de cambio aprobada, así que la conversión está bloqueada.`}</Texto>
      ) : null}
      <BotonDespliegue testID="revision-cab-mas" label="Más datos del documento" abierto={masDatos} onPress={() => setMasDatos(actual => !actual)} />
      {masDatos ? CAMPOS_ADICIONALES.map(fila) : null}
    </View>
  );
}

/** The two answers the calculation cannot guess: the document type and whether prices already include VAT. */
export function PreguntasDocumento(props: { tipoDocumento: TipoDocumento | null; precioIncluyeIva: boolean | null; onEditar: OnEditar }): React.JSX.Element {
  const { colors } = useTheme();
  const { tipoDocumento, precioIncluyeIva, onEditar } = props;
  const [cambiar, setCambiar] = useState(false);
  if (tipoDocumento !== null && precioIncluyeIva !== null && !cambiar) {
    return (
      <View testID="revision-preguntas-resumen" style={[styles.resumenInline, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <View style={styles.resumenTexto}>
          <Texto>{`${tipoDocumento === 'factura' ? 'Factura' : 'Nota de entrega'} · precios ${precioIncluyeIva ? 'con' : 'sin'} IVA`}</Texto>
        </View>
        <Boton testID="revision-preguntas-cambiar" label="Cambiar" onPress={() => setCambiar(true)} />
      </View>
    );
  }
  return (
    <View style={styles.seccion}>
      <Texto tone="primary">¿Es factura o nota de entrega?</Texto>
      <Texto small tone="muted">Nota de entrega: costo + 30 %. Factura: costo + 30 % y luego + 16 % de IVA. Solo sugiere un precio de venta; no cambia los impuestos ni los costos del documento.</Texto>
      <View style={styles.fila}>
        {TIPOS_DOCUMENTO.map(({ valor, testID, label }) => (
          <Boton key={testID} testID={testID} label={label} selected={tipoDocumento === valor} onPress={() => onEditar({ tipo: 'tipo_documento', valor })} />
        ))}
      </View>
      <Texto testID="revision-tipo-estado" small tone={tipoDocumento === null ? 'warning' : 'muted'}>
        {tipoDocumento === null ? 'Tipo de documento sin definir: no hay precio sugerido.' : `Tipo de documento: ${tipoDocumento === 'factura' ? 'factura' : 'nota de entrega'}.`}
      </Texto>
      <Texto tone="primary">¿Los precios incluyen IVA?</Texto>
      <Triestado base="revision-decision-precioIncluyeIva" label="Los precios del documento" valor={precioIncluyeIva} onChange={valor => onEditar({ tipo: 'decision_cabecera', campo: 'precioIncluyeIva', valor })} />
      {cambiar && tipoDocumento !== null && precioIncluyeIva !== null ? <Boton testID="revision-preguntas-listo" label="Listo" onPress={() => setCambiar(false)} /> : null}
    </View>
  );
}

/** The two confirmations that close the purchase step. */
export function ConfirmacionesCompra(props: { decisiones: Readonly<Record<DecisionCabecera, boolean | null>>; onEditar: OnEditar }): React.JSX.Element {
  const { decisiones, onEditar } = props;
  return (
    <View style={styles.seccion}>
      {PREGUNTAS_COMPRA.map(({ campo, label, ayuda }) => (
        <View key={campo} style={styles.seccion}>
          <Texto tone="primary">{label}</Texto>
          <Texto small tone="muted">{ayuda}</Texto>
          <Triestado base={`revision-decision-${campo}`} label="Tu respuesta" valor={decisiones[campo]} onChange={valor => onEditar({ tipo: 'decision_cabecera', campo, valor })} />
        </View>
      ))}
    </View>
  );
}

/** Printed discount and VAT tables: technical corrections, shown only inside "Detalles técnicos". */
export function ListasTecnicasCabecera(props: { efectiva: FacturaEfectiva; calculo: CalculoRevision; onEditar: OnEditar }): React.JSX.Element {
  const { efectiva, calculo, onEditar } = props;
  const oculto = calculo.moneda === 'USD' ? null : avisoImporteOculto(calculo.moneda);
  return (
    <View style={styles.seccion}>
      <FilasLista
        base="revision-cabecera-descuentos"
        tipo="descuentos"
        titulo="Descuentos globales impresos"
        oculto={oculto}
        efectivo={efectiva.descuentos}
        onAplicar={(valor, motivo) => onEditar({ tipo: 'cabecera_descuentos', valor: valor as ExtraidoDescuento[], motivo })}
      />
      <FilasLista
        base="revision-cabecera-impuestos"
        tipo="impuestos"
        titulo="Resumen de IVA impreso (por tasa)"
        oculto={oculto}
        efectivo={efectiva.impuestos}
        onAplicar={(valor, motivo) => onEditar({ tipo: 'cabecera_impuestos', valor: valor as ExtraidoImpuesto[], motivo })}
      />
    </View>
  );
}

// ── Invoice-wide settings: VAT and percentage discount, answered once ──────

/** Several explicit edits as one decision, fenced by the capture context the choice was made under. */
type OnEditarVarios = (ediciones: readonly Edicion[], contexto: string) => { ok: boolean };

interface AjusteProps {
  /** Ready, idle, current session and no conflict: the same gate as every other batch edit. */
  habilitado: boolean;
  contextoActual: () => string;
  onEditarVarios: OnEditarVarios;
}

function productos(cantidad: number): string {
  return cantidad === 1 ? '1 producto' : `${cantidad} productos`;
}

const listaTasas = (tasas: readonly string[]): string => tasas.map(tasa => `${tasa} %`).join(', ');

function textoEstadoIva(estado: EstadoIvaFactura): string {
  if (estado.faltan === 0) return `Ahora: ${listaTasas(estado.tasas)}.`;
  const falta = `Falta en ${productos(estado.faltan)}.`;
  return estado.tasas.length === 0 ? falta : `${falta} Ya indicado: ${listaTasas(estado.tasas)}.`;
}

function textoResumenIva(tasas: readonly string[]): string {
  return tasas.length === 1 ? `IVA de la factura: ${tasas[0]} %` : `IVA de la factura: mixto (${listaTasas(tasas)})`;
}

/**
 * One VAT answer for every product. It fills only the products without VAT; a product with another explicit rate (an
 * exempt one, for example) changes only through the separate replace-all button. Collapses to one line once answered.
 */
function IvaFactura({ lineas, habilitado, contextoActual, onEditarVarios }: AjusteProps & { lineas: readonly LineaEfectiva[] }): React.JSX.Element | null {
  const { colors } = useTheme();
  const [cambiar, setCambiar] = useState(false);
  const [eleccion, setEleccion] = useState<{ tasa: '0' | '16' | 'otro'; contexto: string } | null>(null);
  const [otra, setOtra] = useState('');
  if (lineas.length === 0) return null;
  const estado = estadoIvaFactura(lineas);
  const resuelto = estado.faltan === 0;

  if (resuelto && !cambiar) {
    return (
      <View testID="revision-iva-factura" style={[styles.resumenInline, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <View style={styles.resumenTexto}>
          <Texto testID="revision-iva-factura-resumen">{textoResumenIva(estado.tasas)}</Texto>
        </View>
        <Boton testID="revision-iva-factura-cambiar" label="Cambiar" onPress={() => setCambiar(true)} />
      </View>
    );
  }

  let tasa = '';
  if (eleccion !== null) tasa = eleccion.tasa === 'otro' ? otra.trim() : eleccion.tasa;
  const faltantes = tasa === '' ? estado.faltan : edicionesIvaFactura(lineas, tasa, 'faltan').length;
  const todas = tasa === '' ? 0 : edicionesIvaFactura(lineas, tasa, 'todas').length;
  const conOtroIva = todas - faltantes;

  function elegir(opcion: '0' | '16' | 'otro'): void {
    setEleccion({ tasa: opcion, contexto: contextoActual() });
  }

  function aplicar(alcance: 'faltan' | 'todas'): void {
    if (eleccion === null || tasa === '' || !habilitado) return;
    if (onEditarVarios(edicionesIvaFactura(lineas, tasa, alcance), eleccion.contexto).ok) {
      setEleccion(null);
      setOtra('');
      setCambiar(false);
    }
  }

  const etiquetaAplicar = tasa === '' ? `Aplicar IVA a ${productos(faltantes)} sin IVA` : `Aplicar ${tasa} % a ${productos(faltantes)} sin IVA`;
  return (
    <View testID="revision-iva-factura" style={[styles.ajuste, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Texto tone="primary">IVA de la factura</Texto>
      <Texto testID="revision-iva-factura-estado" small tone={resuelto ? 'muted' : 'warning'}>{textoEstadoIva(estado)}</Texto>
      <View style={styles.fila}>
        <Boton testID="revision-iva-factura-0" label="0 %" selected={eleccion?.tasa === '0'} disabled={!habilitado} onPress={() => elegir('0')} />
        <Boton testID="revision-iva-factura-16" label="16 %" selected={eleccion?.tasa === '16'} disabled={!habilitado} onPress={() => elegir('16')} />
        <Boton testID="revision-iva-factura-otro" label="Otro…" selected={eleccion?.tasa === 'otro'} disabled={!habilitado} onPress={() => elegir('otro')} />
      </View>
      {eleccion?.tasa === 'otro' ? <Entrada testID="revision-iva-factura-valor" label="IVA % de la factura" value={otra} keyboardType="decimal-pad" onChangeText={setOtra} /> : null}
      {eleccion !== null && faltantes > 0 ? (
        <Boton testID="revision-iva-factura-aplicar" label={etiquetaAplicar} disabled={!habilitado || tasa === ''} onPress={() => aplicar('faltan')} />
      ) : null}
      {conOtroIva > 0 ? (
        <>
          <Texto testID="revision-iva-factura-aviso" small tone="warning">{`Ya tienen otro IVA: ${productos(conOtroIva)}. No se cambian sin tu confirmación.`}</Texto>
          <Boton testID="revision-iva-factura-reemplazar" label={`Usar ${tasa} % en todos (${productos(todas)})`} danger disabled={!habilitado} onPress={() => aplicar('todas')} />
        </>
      ) : null}
      {cambiar && resuelto ? <Boton testID="revision-iva-factura-listo" label="Listo" onPress={() => { setCambiar(false); setEleccion(null); }} /> : null}
    </View>
  );
}

function textoResumenDescuento(resumen: ResumenDescuentoFactura): string {
  switch (resumen.tipo) {
    case 'ninguno':
      return 'Descuento de la factura: ninguno';
    case 'porcentajes':
      return `Descuento de la factura: ${resumen.porcentajes.map(p => `${p} %`).join(' + ')} (antes del IVA)`;
    case 'incluidos':
      return 'Descuento de la factura: ya incluido en los precios';
    default:
      return 'Descuento de la factura: revisar';
  }
}

/**
 * Percentages for the whole invoice, in order and before VAT, stored as the existing header discount correction. Never
 * written on its own: only Aplicar or Sin descuento writes, and replacing a discount read from the document (already
 * included, or not a plain percentage) asks first so it is not applied twice.
 */
function DescuentoFactura({ descuentos, habilitado, contextoActual, onEditarVarios }: AjusteProps & { descuentos: FacturaEfectiva['descuentos'] }): React.JSX.Element {
  const { colors } = useTheme();
  const resumen = resumenDescuentoFactura(descuentos.valor);
  const [edicion, setEdicion] = useState<{ texto: string; contexto: string } | null>(null);
  const [pendiente, setPendiente] = useState<Edicion | null>(null);
  const leido = edicion === null ? null : leerPorcentajesFactura(edicion.texto);
  const reemplazaLeido = resumen.tipo === 'incluidos' || resumen.tipo === 'otro';

  function abrir(): void {
    setEdicion({ texto: resumen.tipo === 'porcentajes' ? resumen.porcentajes.join('+') : '', contexto: contextoActual() });
    setPendiente(null);
  }

  function cerrar(): void {
    setEdicion(null);
    setPendiente(null);
  }

  function escribir(texto: string): void {
    if (edicion === null) return;
    setEdicion({ ...edicion, texto });
    setPendiente(null);
  }

  function enviar(nueva: Edicion, confirmado: boolean): void {
    if (edicion === null || !habilitado) return;
    if (reemplazaLeido && !confirmado) {
      setPendiente(nueva);
      return;
    }
    if (onEditarVarios([nueva], edicion.contexto).ok) cerrar();
  }

  return (
    <View testID="revision-descuento-factura" style={[styles.ajuste, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View testID="revision-descuento-factura-fila" style={styles.filaResumen}>
        <View testID="revision-descuento-factura-texto" style={styles.textoResumen}>
          <Texto testID="revision-descuento-factura-resumen">{textoResumenDescuento(resumen)}</Texto>
        </View>
        {edicion === null ? <Boton testID="revision-descuento-factura-cambiar" label="Cambiar" onPress={abrir} /> : null}
      </View>
      {resumen.tipo === 'otro' ? (
        <Texto testID="revision-descuento-factura-aviso" small tone="warning">El descuento leído no es solo un porcentaje: escribe el porcentaje aquí o corrígelo en Detalles para soporte.</Texto>
      ) : null}
      {edicion !== null ? (
        <>
          <Entrada
            testID="revision-descuento-factura-valor"
            label="Descuento de la factura (%)"
            hint="Ejemplo: 10 o 20+5. Se aplica en orden, antes del IVA."
            placeholder="10 o 20+5"
            value={edicion.texto}
            keyboardType="decimal-pad"
            onChangeText={escribir}
          />
          {leido && !leido.ok && edicion.texto.trim() !== '' ? <Texto testID="revision-descuento-factura-error" small tone="danger">{leido.error}</Texto> : null}
          {pendiente ? (
            <>
              <Texto testID="revision-descuento-factura-confirmar-aviso" small tone="warning">Esto reemplaza el descuento leído de la factura. Si ya está incluido en los precios, no lo apliques de nuevo.</Texto>
              <Boton testID="revision-descuento-factura-confirmar" label="Sí, reemplazar" danger disabled={!habilitado} onPress={() => enviar(pendiente, true)} />
            </>
          ) : null}
          <View style={styles.fila}>
            <Boton
              testID="revision-descuento-factura-aplicar"
              label="Aplicar a toda la factura"
              disabled={!habilitado || !leido?.ok}
              onPress={() => { if (leido?.ok) enviar(edicionDescuentoFactura(leido.porcentajes), false); }}
            />
            {resumen.tipo !== 'ninguno' ? <Boton testID="revision-descuento-factura-quitar" label="Sin descuento" disabled={!habilitado} onPress={() => enviar(edicionDescuentoFactura([]), false)} /> : null}
            <Boton testID="revision-descuento-factura-cancelar" label="Cancelar" onPress={cerrar} />
          </View>
        </>
      ) : null}
    </View>
  );
}

function textoDescuentoCorto(resumen: ResumenDescuentoFactura): string {
  switch (resumen.tipo) {
    case 'porcentajes':
      return `Descuento ${resumen.porcentajes.map(p => `${p} %`).join(' + ')}`;
    case 'incluidos':
      return 'Descuento ya incluido en los precios';
    default:
      return 'Sin descuento';
  }
}

function textoValoresAjustes(estado: EstadoIvaFactura, resumen: ResumenDescuentoFactura): string {
  const descuento = textoDescuentoCorto(resumen);
  if (estado.total === 0) return descuento;
  const iva = estado.tasas.length === 1 ? `IVA ${estado.tasas[0]} %` : `IVA mixto (${listaTasas(estado.tasas)})`;
  return `${iva} · ${descuento}`;
}

/**
 * The existing explicit "1 unit" batch for products whose units are still unconfirmed: never a default, never applied
 * to a product that already has a factor (a package factor survives), fenced by the context captured on choice.
 */
function UnidadesFactura({ lineas, habilitado, contextoActual, onEditarVarios }: AjusteProps & { lineas: readonly LineaEfectiva[] }): React.JSX.Element | null {
  const { colors } = useTheme();
  const [eleccion, setEleccion] = useState<{ contexto: string } | null>(null);
  const pendientes = lineas.filter(linea => linea.factorConversion === null).map(linea => linea.lineaId);
  if (pendientes.length === 0) return null;

  function aplicar(): void {
    if (eleccion === null || !habilitado) return;
    if (onEditarVarios(pendientes.map(edicionFactorUno), eleccion.contexto).ok) setEleccion(null);
  }

  return (
    <View testID="revision-lote" style={[styles.ajuste, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Texto tone="primary">Usar 1 unidad en los que faltan</Texto>
      <Texto small tone="warning">{`Faltan las unidades de ${productos(pendientes.length)}`}</Texto>
      <Texto small tone="muted">No cambia los productos que ya tienen unidades.</Texto>
      <View style={styles.fila}>
        <Boton testID="revision-lote-factor-uno" label="1 unidad" selected={eleccion !== null} disabled={!habilitado} onPress={() => setEleccion({ contexto: contextoActual() })} />
        {eleccion ? (
          <Boton testID="revision-lote-factor-aplicar" label={`Usar 1 unidad en ${productos(pendientes.length)} pendientes`} disabled={!habilitado} onPress={aplicar} />
        ) : null}
      </View>
    </View>
  );
}

function textoPaquetes(lineas: readonly LineaEfectiva[]): string | null {
  const conPaquete = lineas.filter(linea => linea.factorConversion !== null && linea.factorConversion !== '1').length;
  return conPaquete === 0 ? null : `Unidades: ${productos(conPaquete)} con paquete`;
}

/** Inputs of the invoice-wide settings; the document questions travel with them so all of it collapses as one. */
export interface AjustesFacturaProps extends AjusteProps {
  tipoDocumento: TipoDocumento | null;
  precioIncluyeIva: boolean | null;
  onEditar: OnEditar;
}

/**
 * Document type, price inclusion, VAT, units still unconfirmed and discount, set once for every product. Once all of them are answered they
 * collapse into one summary with a single Cambiar that reopens the same explicit controls; anything unanswered, or a
 * read discount that needs review, keeps the controls open.
 */
function AjustesFactura(props: AjustesFacturaProps & { efectiva: FacturaEfectiva }): React.JSX.Element {
  const { colors } = useTheme();
  const { efectiva, tipoDocumento, precioIncluyeIva, onEditar, ...ajuste } = props;
  const [abierto, setAbierto] = useState(false);
  const estadoIva = estadoIvaFactura(efectiva.lineas);
  const resumen = resumenDescuentoFactura(efectiva.descuentos.valor);
  const unidadesListas = efectiva.lineas.every(linea => linea.factorConversion !== null);
  const respondido = tipoDocumento !== null && precioIncluyeIva !== null && estadoIva.faltan === 0 && unidadesListas && resumen.tipo !== 'otro';
  const paquetes = textoPaquetes(efectiva.lineas);

  if (respondido && !abierto) {
    return (
      <View testID="revision-ajustes-factura" style={[styles.filaResumen, styles.resumenCompacto, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <View style={styles.textoResumen}>
          <Texto testID="revision-ajustes-resumen-documento">{`${tipoDocumento === 'factura' ? 'Factura' : 'Nota de entrega'} · precios ${precioIncluyeIva ? 'con' : 'sin'} IVA`}</Texto>
          <Texto testID="revision-ajustes-resumen-valores" small tone="muted">{textoValoresAjustes(estadoIva, resumen)}</Texto>
          {paquetes ? <Texto testID="revision-ajustes-resumen-unidades" small tone="muted">{paquetes}</Texto> : null}
        </View>
        <BotonDespliegue testID="revision-ajustes-cambiar" label="Cambiar" abierto={false} onPress={() => setAbierto(true)} />
      </View>
    );
  }
  return (
    <View testID="revision-ajustes-factura" style={styles.cabeceraCompacta}>
      <PreguntasDocumento tipoDocumento={tipoDocumento} precioIncluyeIva={precioIncluyeIva} onEditar={onEditar} />
      <IvaFactura lineas={efectiva.lineas} {...ajuste} />
      <UnidadesFactura lineas={efectiva.lineas} {...ajuste} />
      <DescuentoFactura descuentos={efectiva.descuentos} {...ajuste} />
      {respondido ? <Boton testID="revision-ajustes-listo" label="Listo" onPress={() => setAbierto(false)} /> : null}
    </View>
  );
}

/**
 * Reading stage content: the summary plus the two required questions. With `ajustes`, the questions are part of the
 * invoice-wide settings (VAT and discount), which collapse together once answered.
 */
export default function FacturaRevisionCabecera(props: {
  efectiva: FacturaEfectiva;
  decisiones: Readonly<Record<DecisionCabecera, boolean | null>>;
  tipoDocumento: TipoDocumento | null;
  calculo: CalculoRevision;
  onEditar: OnEditar;
  ajustes?: AjusteProps;
}): React.JSX.Element {
  const { efectiva, decisiones, tipoDocumento, calculo, onEditar, ajustes } = props;
  const [detalles, setDetalles] = useState(false);
  return (
    <View style={styles.cabeceraCompacta}>
      {ajustes ? (
        <AjustesFactura efectiva={efectiva} tipoDocumento={tipoDocumento} precioIncluyeIva={decisiones.precioIncluyeIva} onEditar={onEditar} {...ajustes} />
      ) : (
        <PreguntasDocumento tipoDocumento={tipoDocumento} precioIncluyeIva={decisiones.precioIncluyeIva} onEditar={onEditar} />
      )}
      {calculo.moneda !== 'USD' ? <Texto tone="warning">La moneda no es USD o falta definirla. Corrige la moneda en Más detalles.</Texto> : null}
      <BotonDespliegue testID="revision-cab-detalles" label="Más detalles" abierto={detalles} onPress={() => setDetalles(actual => !actual)} />
      {detalles ? <ResumenCabecera efectiva={efectiva} calculo={calculo} onEditar={onEditar} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  seccion: { gap: 10 },
  cabeceraCompacta: { gap: 6 },
  resumenInline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  resumenTexto: { flexGrow: 1, flexShrink: 1, minWidth: 150 },
  ajuste: { gap: 8, borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  filaResumen: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  textoResumen: { flex: 1, gap: 2 },
  resumenCompacto: { borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  tarjeta: { borderWidth: 0.5, borderRadius: 12, padding: 12, gap: 10 },
  filaDatoCaja: { gap: 6 },
  despliegue: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, alignSelf: 'flex-start' },
  despliegueBorde: { alignSelf: 'stretch', justifyContent: 'space-between', borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  despliegueTextoIzq: { textAlign: 'left' },
  campo: { borderWidth: 0.5, borderRadius: 10, padding: 10, gap: 6 },
  filaCaja: { borderWidth: 0.5, borderRadius: 8, padding: 8, gap: 6 },
  fila: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  triestado: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  triestadoEtiqueta: { minWidth: 140, flexShrink: 1 },
  crece: { flexGrow: 1, flexShrink: 1, flexBasis: 160 },
  boton: { minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  botonTexto: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold', flexShrink: 1, textAlign: 'center' },
  entrada: { minHeight: 44, borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_400Regular' },
  texto: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_500Medium', flexShrink: 1 },
  chico: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(16), flexShrink: 1 },
});
