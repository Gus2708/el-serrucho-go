import * as React from 'react';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import type { ExtraidoDescuento, ExtraidoImpuesto } from '../lib/facturaExtractionContract';
import type {
  CabeceraCampoEscalar,
  CalculoRevision,
  DecisionCabecera,
  Edicion,
  FacturaEfectiva,
  ValorEfectivo,
} from '../lib/facturaRevision';

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
}

export function Boton({ testID, label, onPress, disabled = false, selected = false, danger = false }: BotonProps): React.JSX.Element {
  const { colors } = useTheme();
  const tone = danger ? colors.danger : colors.primary;
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
        { borderColor: disabled ? colors.border : tone, backgroundColor: selected ? colors.primaryFaded : colors.surface, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.botonTexto, { color: disabled ? colors.textMuted : tone }]}>{label}</Text>
    </Pressable>
  );
}

export function Entrada({ testID, label, value, onChangeText, keyboardType = 'default' }: { testID: string; label: string; value: string; onChangeText: (text: string) => void; keyboardType?: 'default' | 'decimal-pad' }): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <TextInput
      testID={testID}
      accessibilityLabel={label}
      placeholder={label}
      placeholderTextColor={colors.textDim}
      value={value}
      onChangeText={onChangeText}
      keyboardType={keyboardType}
      autoCorrect={false}
      style={[styles.entrada, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
    />
  );
}

export function Texto({ testID, children, tone = 'text', small = false }: { testID?: string; children: React.ReactNode; tone?: 'text' | 'muted' | 'danger' | 'warning' | 'success' | 'primary'; small?: boolean }): React.JSX.Element {
  const { colors } = useTheme();
  const color = { text: colors.text, muted: colors.textMuted, danger: colors.danger, warning: colors.warning, success: colors.success, primary: colors.primary }[tone];
  return (
    <Text testID={testID} style={[small ? styles.chico : styles.texto, { color }]}>
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
  return (
    <View style={styles.fila}>
      <View style={styles.crece}>
        <Texto>{label}</Texto>
        <Texto small tone={valor === null ? 'warning' : 'muted'}>{valor === null ? 'Sin definir' : valor ? 'Sí' : 'No'}</Texto>
      </View>
      <Boton testID={`${base}-si`} label="Sí" selected={valor === true} onPress={() => onChange(true)} />
      <Boton testID={`${base}-no`} label="No" selected={valor === false} onPress={() => onChange(false)} />
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

const CAMPOS: ReadonlyArray<{ campo: CabeceraCampoEscalar; label: string; decimal?: boolean; monetario?: boolean }> = [
  { campo: 'proveedorNombre', label: 'Proveedor' },
  { campo: 'numeroDocumento', label: 'Número de factura' },
  { campo: 'numeroControl', label: 'Número de control' },
  { campo: 'fechaEmision', label: 'Fecha (AAAA-MM-DD)' },
  { campo: 'moneda', label: 'Moneda del documento' },
  { campo: 'subtotal', label: 'Subtotal impreso', decimal: true, monetario: true },
  { campo: 'total', label: 'Total impreso', decimal: true, monetario: true },
];

const DECISIONES: ReadonlyArray<{ campo: DecisionCabecera; label: string }> = [
  { campo: 'documentoCompletoConfirmado', label: 'El documento está completo (todas las páginas y renglones)' },
  { campo: 'recepcionCompleta', label: 'Se recibió toda la mercancía' },
  { campo: 'precioIncluyeIva', label: 'Los precios incluyen IVA' },
];

export default function FacturaRevisionCabecera(props: {
  efectiva: FacturaEfectiva;
  decisiones: Readonly<Record<DecisionCabecera, boolean | null>>;
  calculo: CalculoRevision;
  onEditar: (edicion: Edicion) => void;
}): React.JSX.Element {
  const { efectiva, decisiones, calculo, onEditar } = props;
  const oculto = calculo.moneda === 'USD' ? null : avisoImporteOculto(calculo.moneda);
  return (
    <View style={styles.seccion}>
      <Texto tone="primary">DATOS DEL DOCUMENTO</Texto>
      {CAMPOS.map(({ campo, label, decimal, monetario }) => (
        <CampoCorregible
          key={campo}
          base={`revision-cab-${campo}`}
          label={label}
          efectivo={efectiva.campos[campo]}
          keyboardType={decimal ? 'decimal-pad' : 'default'}
          oculto={monetario ? oculto : null}
          onAplicar={(valor, motivo) => onEditar({ tipo: 'cabecera_escalar', campo, valor, motivo })}
          onRevertir={() => onEditar({ tipo: 'revertir_cabecera', campo })}
        />
      ))}
      {calculo.moneda !== null && calculo.moneda !== 'USD' ? (
        <Texto small tone="warning">{`Moneda ${calculo.moneda}: los importes se conservan sin convertir. No hay tasa de cambio aprobada, así que la conversión está bloqueada.`}</Texto>
      ) : null}
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
      <Texto tone="primary">CONFIRMACIONES</Texto>
      {DECISIONES.map(({ campo, label }) => (
        <Triestado key={campo} base={`revision-decision-${campo}`} label={label} valor={decisiones[campo]} onChange={valor => onEditar({ tipo: 'decision_cabecera', campo, valor })} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  seccion: { gap: 10 },
  campo: { borderWidth: 0.5, borderRadius: 10, padding: 10, gap: 6 },
  filaCaja: { borderWidth: 0.5, borderRadius: 8, padding: 8, gap: 6 },
  fila: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  crece: { flexGrow: 1, flexShrink: 1, flexBasis: 160 },
  boton: { minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  botonTexto: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold', flexShrink: 1, textAlign: 'center' },
  entrada: { minHeight: 44, borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_400Regular' },
  texto: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_500Medium', flexShrink: 1 },
  chico: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(16), flexShrink: 1 },
});
