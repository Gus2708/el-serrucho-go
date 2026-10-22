import * as React from 'react';
import { useState } from 'react';
import { View, Text, Modal, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { pressScale } from '../theme/motion';
import { PressableScale } from './PressableScale';
import FacturaProveedorEditor from './FacturaProveedorEditor';
import { useUserRole } from '../hooks/useUserRole';
import { useFacturaBorradores, useFacturaRecord, useFacturasList } from '../hooks/useFacturasProveedor';
import { newUuid } from '../lib/facturaDocumentoPicker';
import type { FacturaLocalRecord } from '../lib/facturaLocalStore';
import type { FacturaResumen } from '../lib/facturaProveedorRepository';

interface FacturasProveedorModalProps {
  visible: boolean;
  /** Supplier currently chosen in the purchase builder; prefills new invoices only. */
  proveedorCodigo?: string | null;
  proveedorNombre?: string | null;
  onClose: () => void;
}

/** `local` reopens a draft from this device: the editor restores it, so no server fetch is needed. */
type TargetSource = 'new' | 'server' | 'local';

interface EditorTarget {
  facturaId: string;
  source: TargetSource;
  reloadKey: number;
}

type ListRow =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'borrador'; key: string; record: FacturaLocalRecord }
  | { kind: 'servidor'; key: string; item: FacturaResumen };

function summaryTitle(item: FacturaResumen): string {
  const numero = item.numero_documento?.trim();
  return numero ? `Factura ${numero}` : 'Factura sin número';
}

function summarySubtitle(item: FacturaResumen): string {
  const parts = [item.proveedor_nombre, item.fecha_documento].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : 'Sin proveedor ni fecha';
}

function draftTitle(record: FacturaLocalRecord): string {
  const numero = record.draft.numeroDocumento.trim();
  return numero ? `Factura ${numero}` : 'Factura sin número';
}

function draftSubtitle(record: FacturaLocalRecord): string {
  const proveedor = record.draft.proveedorNombre.trim();
  return proveedor ? `${proveedor} · Sin enviar al servidor` : 'Sin enviar al servidor';
}

function buildRows(drafts: FacturaLocalRecord[], saved: FacturaResumen[]): ListRow[] {
  const draftIds = new Set(drafts.map(record => record.facturaId));
  const onServer = saved.filter(item => !draftIds.has(item.id));
  const rows: ListRow[] = [];
  if (drafts.length > 0) {
    rows.push({ kind: 'header', key: 'h-borradores', title: 'BORRADORES EN ESTE DISPOSITIVO' });
    drafts.forEach(record => rows.push({ kind: 'borrador', key: record.facturaId, record }));
  }
  if (onServer.length > 0) {
    if (drafts.length > 0) rows.push({ kind: 'header', key: 'h-servidor', title: 'GUARDADAS EN EL SERVIDOR' });
    onServer.forEach(item => rows.push({ kind: 'servidor', key: item.id, item }));
  }
  return rows;
}

export default function FacturasProveedorModal({
  visible,
  proveedorCodigo,
  proveedorNombre,
  onClose,
}: FacturasProveedorModalProps): React.JSX.Element {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { data: userAuth } = useUserRole();
  const ownerId = userAuth?.profile?.id ?? null;

  const [target, setTarget] = useState<EditorTarget | null>(null);
  const list = useFacturasList(visible && target === null);
  const borradores = useFacturaBorradores(ownerId, visible && target === null);
  const detail = useFacturaRecord(target?.source === 'server' ? target.facturaId : null);

  function closeEditor(): void {
    setTarget(null);
  }

  function handleClose(): void {
    setTarget(null);
    onClose();
  }

  function openNew(): void {
    setTarget({ facturaId: newUuid(), source: 'new', reloadKey: 0 });
  }

  function openExisting(item: FacturaResumen): void {
    if (ownerId === null) return;
    setTarget({ facturaId: item.id, source: 'server', reloadKey: 0 });
  }

  function openDraft(record: FacturaLocalRecord): void {
    if (ownerId === null) return;
    setTarget({ facturaId: record.facturaId, source: 'local', reloadKey: 0 });
  }

  async function reloadEditor(): Promise<void> {
    await detail.refetch();
    setTarget(current => (current ? { ...current, reloadKey: current.reloadKey + 1 } : current));
  }

  function renderEditor(): React.JSX.Element {
    if (target === null || ownerId === null) {
      return <View />;
    }
    if (target.source !== 'server') {
      return (
        <FacturaProveedorEditor
          key={`${target.facturaId}:${target.reloadKey}`}
          facturaId={target.facturaId}
          record={null}
          ownerId={ownerId}
          proveedorCodigo={target.source === 'new' ? proveedorCodigo ?? undefined : undefined}
          proveedorNombre={target.source === 'new' ? proveedorNombre ?? undefined : undefined}
          onClose={closeEditor}
          onReload={closeEditor}
        />
      );
    }
    if (detail.isFetching && !detail.data) {
      return <ActivityIndicator style={styles.center} color={colors.primary} />;
    }
    if (detail.error || !detail.data) {
      return (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>
            {detail.error ? 'No se pudo abrir la factura' : 'La factura no existe o no tienes acceso'}
          </Text>
          <PressableScale onPress={closeEditor} style={[styles.newBtn, { borderColor: colors.primary }]}>
            <Text style={[styles.newBtnText, { color: colors.primary }]}>Volver a la lista</Text>
          </PressableScale>
        </View>
      );
    }
    return (
      <FacturaProveedorEditor
        key={`${target.facturaId}:${target.reloadKey}`}
        facturaId={target.facturaId}
        record={detail.data}
        ownerId={ownerId}
        onClose={closeEditor}
        onReload={reloadEditor}
      />
    );
  }

  function renderRow(row: ListRow): React.JSX.Element {
    if (row.kind === 'header') {
      return <Text style={[styles.section, { color: colors.primary }]}>{row.title}</Text>;
    }
    if (row.kind === 'borrador') {
      return (
        <PressableScale onPress={() => openDraft(row.record)} activeScale={pressScale.row} testID={`factura-borrador-${row.key}`} style={[styles.rowCard, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
          <Feather name="edit-3" size={16} color={colors.primary} />
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>{draftTitle(row.record)}</Text>
            <Text style={[styles.rowSub, { color: colors.textMuted }]} numberOfLines={1}>{draftSubtitle(row.record)}</Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textDim} />
        </PressableScale>
      );
    }
    return (
      <PressableScale onPress={() => openExisting(row.item)} activeScale={pressScale.row} testID={`factura-servidor-${row.key}`} style={[styles.rowCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Feather name={row.item.documento_mime ? 'paperclip' : 'file'} size={16} color={colors.primary} />
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>{summaryTitle(row.item)}</Text>
          <Text style={[styles.rowSub, { color: colors.textMuted }]} numberOfLines={1}>{summarySubtitle(row.item)}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={colors.textDim} />
      </PressableScale>
    );
  }

  const rows = buildRows(borradores.data?.drafts ?? [], list.data ?? []);
  const unreadable = borradores.data?.problems.length ?? 0;

  function renderList(): React.JSX.Element {
    return (
      <>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>Facturas de proveedor</Text>
          <PressableScale onPress={handleClose} hitSlop={8} activeScale={pressScale.icon} accessibilityRole="button" accessibilityLabel="Cerrar">
            <Feather name="x" size={20} color={colors.textMuted} />
          </PressableScale>
        </View>

        <View style={styles.body}>
          <PressableScale onPress={openNew} dimmed={ownerId === null} disabled={ownerId === null} style={[styles.newBtn, { borderColor: colors.primary, backgroundColor: colors.primaryFaded }]}>
            <Feather name="plus" size={16} color={colors.primary} />
            <Text style={[styles.newBtnText, { color: colors.primary }]}>Nueva factura</Text>
          </PressableScale>
          <Text style={[styles.hint, { color: colors.textDim }]}>
            Guarda el documento y sus renglones para retomarlos después. No registra ninguna compra ni cambia el inventario.
          </Text>

          {list.isLoading ? <ActivityIndicator color={colors.primary} style={styles.center} /> : null}
          {list.error ? (
            <PressableScale onPress={() => list.refetch()} style={[styles.newBtn, { borderColor: colors.danger }]}>
              <Text style={[styles.newBtnText, { color: colors.danger }]}>No se pudo cargar. Reintentar</Text>
            </PressableScale>
          ) : null}
          {unreadable > 0 || borradores.error ? (
            <Text style={[styles.hint, { color: colors.warning }]}>
              Hay borradores en este dispositivo que no se pudieron leer.
            </Text>
          ) : null}

          <FlatList
            data={rows}
            keyExtractor={row => row.key}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              list.isLoading || list.error ? null : (
                <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Aún no hay facturas guardadas</Text>
              )
            }
            renderItem={({ item: row }) => renderRow(row)}
          />
        </View>
      </>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={target === null ? handleClose : closeEditor}>
      <View style={[styles.flex, { backgroundColor: colors.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {target === null ? renderList() : renderEditor()}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  title: { fontSize: scaleFont(16), fontFamily: 'JetBrainsMono_700Bold' },
  body: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  newBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16 },
  newBtnText: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },
  hint: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(16) },
  listContent: { gap: 8, paddingBottom: 24 },
  section: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 1, marginTop: 4 },
  emptyTitle: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_500Medium', textAlign: 'center', marginTop: 24 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 0.5, borderRadius: 12, padding: 12 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
  rowSub: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular' },
});
