import * as React from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import type { ExtraidoDescuento } from '../lib/facturaExtractionContract';
import type { LineMatch } from '../lib/facturaMatching';
import type { CalculoLinea, Edicion, EstadoCodigoBarras, LineaCampoEscalar, LineaEfectiva } from '../lib/facturaRevision';
import { Boton, CampoCorregible, Entrada, FilasLista, Texto, avisoImporteOculto, etiquetaMonto, formatoUsdExacto } from './FacturaRevisionCabecera';

const CAMPOS: ReadonlyArray<{ campo: LineaCampoEscalar; label: string; decimal?: boolean; monetario?: boolean }> = [
  { campo: 'codigoProveedor', label: 'Código impreso del proveedor' },
  { campo: 'descripcion', label: 'Descripción' },
  { campo: 'cantidad', label: 'Cantidad del documento', decimal: true },
  { campo: 'unidad', label: 'Unidad del documento' },
  { campo: 'precioUnitario', label: 'Costo unitario (USD)', decimal: true, monetario: true },
  { campo: 'tasaIva', label: 'IVA (%)', decimal: true },
  { campo: 'total', label: 'Total impreso del renglón (USD)', decimal: true, monetario: true },
];

const ESTADO_BARRAS: Record<EstadoCodigoBarras, string> = {
  sin_codigo: 'Sin código impreso que usar.',
  unico_verificado: 'Único verificado: ningún producto lo usa (lectura completa).',
  ya_asignado_a_este_producto: 'Ya asignado a este mismo producto.',
  colision: 'Colisión: otro producto ya usa este código.',
  reemplazo_requiere_confirmacion: 'Reemplazaría el código de barras actual del producto: no se hace sin confirmación.',
  no_verificable: 'No verificado: la lectura del catálogo fue parcial o falló, así que no se puede afirmar que sea único.',
};

export interface FacturaRevisionLineaProps {
  llave: string;
  numero: string;
  pagina: number | null;
  efectiva: LineaEfectiva;
  calculo: CalculoLinea | undefined;
  match: LineMatch | undefined;
  catalogoParcial: boolean | null;
  /** Document currency when it is not confirmed USD (null when USD is confirmed or the currency is unknown, see esUsd). */
  moneda: string | null;
  esUsd: boolean;
  estadoBarras: EstadoCodigoBarras | undefined;
  onEditar: (edicion: Edicion) => void;
  onElegirCandidato: (codigoInterno: string) => void;
}

function decisionTexto(efectiva: LineaEfectiva): string {
  const { tipo, codigoInterno, evidencia, motivo } = efectiva.asociacion;
  if (tipo === 'pendiente') return 'Sin decidir: ningún producto está asociado todavía.';
  if (tipo === 'producto_nuevo') return `Producto nuevo (sin crear). Motivo: ${motivo ?? ''}`;
  return `Asociado a ${codigoInterno} (evidencia: ${evidencia === 'sugerencia' ? 'sugerencia' : 'manual'})${motivo ? `. Motivo: ${motivo}` : ''}`;
}

export default function FacturaRevisionLinea(props: FacturaRevisionLineaProps): React.JSX.Element {
  const { colors } = useTheme();
  const { llave, numero, pagina, efectiva, calculo, match, catalogoParcial, moneda, esUsd, estadoBarras, onEditar, onElegirCandidato } = props;
  const id = `revision-linea-${llave}`;
  const lineaId = efectiva.lineaId;
  const [factor, setFactor] = useState('');
  const [manualCodigo, setManualCodigo] = useState('');
  const [manualMotivo, setManualMotivo] = useState('');
  const [nuevoMotivo, setNuevoMotivo] = useState('');
  const codigo = efectiva.campos.codigoProveedor.valor;
  const confianza = efectiva.lecturaOcr?.confianza ?? null;
  const esManual = efectiva.numeroLinea === null;
  // Unconverted amounts stay internal: no figure is shown until a conversion to USD is approved.
  const oculto = esUsd ? null : avisoImporteOculto(moneda);
  const monto = (valor: string | null): string => oculto ?? formatoUsdExacto(valor);

  return (
    <View testID={id} style={[styles.tarjeta, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Texto tone="primary">{esManual ? `Renglón manual ${numero}` : `Renglón ${numero}`}</Texto>
      <Texto testID={`${id}-pagina`} small tone="muted">{pagina === null ? 'Página: sin dato' : `Página ${pagina}`}</Texto>
      <Texto small tone="muted">Código impreso (literal):</Texto>
      <Texto testID={`${id}-codigo`}>{codigo ?? ''}</Texto>
      <Texto testID={`${id}-ocr`} small tone="muted">
        {confianza === null ? 'Lectura OCR: sin dato de confianza' : `Lectura OCR: ${Math.round(confianza * 100)} %`}
      </Texto>
      {efectiva.lecturaOcr?.campoDudoso.length ? <Texto small tone="warning">{`Campos dudosos: ${efectiva.lecturaOcr.campoDudoso.join(', ')}`}</Texto> : null}

      {CAMPOS.map(({ campo, label, decimal, monetario }) => (
        <CampoCorregible
          key={campo}
          base={`${id}-${campo}`}
          label={etiquetaMonto(label, esUsd)}
          efectivo={efectiva.campos[campo]}
          keyboardType={decimal ? 'decimal-pad' : 'default'}
          oculto={monetario ? oculto : null}
          onAplicar={(valor, motivo) => onEditar({ tipo: 'linea_escalar', lineaId, campo, valor, motivo })}
          onRevertir={() => onEditar({ tipo: 'revertir_linea', lineaId, campo })}
        />
      ))}

      <FilasLista
        base={`${id}-descuentos`}
        tipo="descuentos"
        titulo="Descuentos del renglón (en orden)"
        oculto={oculto}
        efectivo={efectiva.descuentos}
        onAplicar={(valor, motivo) => onEditar({ tipo: 'linea_descuentos', lineaId, valor: valor as ExtraidoDescuento[], motivo })}
      />

      <View style={[styles.caja, { borderColor: colors.border }]}>
        <Texto small tone="muted">Unidades de inventario por unidad del documento (factor)</Texto>
        <Texto small tone={efectiva.factorConversion === null ? 'warning' : 'text'}>{efectiva.factorConversion === null ? 'Sin confirmar' : `Confirmado: ${efectiva.factorConversion}`}</Texto>
        <Entrada testID={`${id}-factor-valor`} label="Factor de conversión" value={factor} keyboardType="decimal-pad" onChangeText={setFactor} />
        <Boton testID={`${id}-factor-aplicar`} label="Confirmar factor" disabled={factor.trim() === ''} onPress={() => { onEditar({ tipo: 'factor_conversion', lineaId, valor: factor.trim() }); setFactor(''); }} />
      </View>

      <View style={[styles.caja, { borderColor: colors.border }]}>
        <Texto small tone="muted">{esUsd ? 'Importes calculados (USD, exactos)' : 'Importes calculados (sin convertir)'}</Texto>
        <Texto testID={`${id}-importe-final`}>{`Importe tras descuentos: ${monto(calculo?.importeFinal ?? null)}`}</Texto>
        <Texto testID={`${id}-base`} small>{esUsd ? `Base sin IVA: ${monto(calculo?.base ?? null)} · IVA: ${monto(calculo?.iva ?? null)}` : `Base sin IVA e IVA: ${oculto}`}</Texto>
        <Texto testID={`${id}-costo-unitario`}>{`Costo neto por unidad de inventario: ${monto(calculo?.costoNetoUnitarioStock ?? null)}`}</Texto>
        <Texto small tone="muted">{`Cantidad en inventario: ${calculo?.cantidadStock ?? 'desconocida'} · Cantidad del documento: ${calculo?.cantidadDocumento ?? 'sin dato'}`}</Texto>
      </View>

      <View style={[styles.caja, { borderColor: colors.border }]}>
        <Texto small tone="muted">Producto del catálogo (decisión humana, distinta de la lectura OCR)</Texto>
        <Texto testID={`${id}-decision`} tone={efectiva.asociacion.tipo === 'pendiente' ? 'warning' : 'text'}>{decisionTexto(efectiva)}</Texto>
        {match && match.candidates.length > 0 ? (
          match.candidates.map(candidato => (
            <Boton
              key={candidato.codigoInterno}
              testID={`${id}-candidato-${candidato.codigoInterno}`}
              label={`${candidato.codigoInterno} · ${candidato.descripcion}`}
              selected={efectiva.asociacion.codigoInterno === candidato.codigoInterno}
              onPress={() => onElegirCandidato(candidato.codigoInterno)}
            />
          ))
        ) : match ? (
          <Texto testID={`${id}-sin-candidatos`} small tone="warning">{catalogoParcial ? 'Sin candidatos en una lectura parcial: no prueba que el producto no exista. Sigue sin decidir.' : 'Sin candidatos en la lectura acotada del catálogo. Sigue sin decidir.'}</Texto>
        ) : null}
        {match && match.conflicts.length > 0 ? <Texto small tone="danger">Hay señales en conflicto entre código y descripción: revisa con cuidado.</Texto> : null}
        <Entrada testID={`${id}-manual-codigo`} label="Código interno (SKU) manual" value={manualCodigo} onChangeText={setManualCodigo} />
        <Entrada testID={`${id}-manual-motivo`} label="Motivo de la asociación manual" value={manualMotivo} onChangeText={setManualMotivo} />
        <Boton
          testID={`${id}-manual-aplicar`}
          label="Asociar manualmente"
          disabled={manualCodigo.trim() === '' || manualMotivo.trim() === ''}
          onPress={() => {
            onEditar({ tipo: 'asociacion', lineaId, asociacion: { tipo: 'confirmado', codigoInterno: manualCodigo.trim(), evidencia: 'manual', motivo: manualMotivo.trim() } });
            setManualCodigo('');
            setManualMotivo('');
          }}
        />
        <Entrada testID={`${id}-nuevo-motivo`} label="Motivo: es un producto nuevo" value={nuevoMotivo} onChangeText={setNuevoMotivo} />
        <Boton
          testID={`${id}-nuevo-aplicar`}
          label="Marcar como producto nuevo (no se crea)"
          disabled={nuevoMotivo.trim() === ''}
          onPress={() => {
            onEditar({ tipo: 'asociacion', lineaId, asociacion: { tipo: 'producto_nuevo', codigoInterno: null, evidencia: 'manual', motivo: nuevoMotivo.trim() } });
            setNuevoMotivo('');
          }}
        />
        {efectiva.asociacion.tipo !== 'pendiente' ? (
          <Boton testID={`${id}-pendiente`} label="Volver a sin decidir" danger onPress={() => onEditar({ tipo: 'asociacion', lineaId, asociacion: { tipo: 'pendiente', codigoInterno: null, evidencia: null, motivo: null } })} />
        ) : null}
      </View>

      <View style={[styles.caja, { borderColor: colors.border }]}>
        <Texto small tone="muted">Código de barras propuesto: el código impreso, tal cual</Texto>
        <Texto testID={`${id}-barras-codigo`}>{codigo ?? ''}</Texto>
        <Boton
          testID={`${id}-barras-usar`}
          label={efectiva.usarCodigoFactura ? 'Usar el código impreso: sí' : 'Usar el código impreso: no'}
          selected={efectiva.usarCodigoFactura}
          onPress={() => onEditar({ tipo: 'codigo_barras', lineaId, usarCodigoFactura: !efectiva.usarCodigoFactura })}
        />
        {efectiva.usarCodigoFactura ? (
          <Texto testID={`${id}-barras-estado`} small tone={estadoBarras === 'unico_verificado' || estadoBarras === 'ya_asignado_a_este_producto' ? 'success' : 'warning'}>
            {efectiva.asociacion.tipo === 'pendiente' ? 'Decide primero la asociación del renglón.' : ESTADO_BARRAS[estadoBarras ?? 'no_verificable']}
          </Texto>
        ) : null}
      </View>

      {esManual ? <Boton testID={`${id}-quitar`} label="Quitar renglón manual" danger onPress={() => onEditar({ tipo: 'quitar_linea_manual', lineaId })} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: { borderWidth: 0.5, borderRadius: 12, padding: 12, gap: 8 },
  caja: { borderWidth: 0.5, borderRadius: 10, padding: 10, gap: 6 },
});
