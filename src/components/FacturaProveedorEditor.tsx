import * as React from 'react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { scaleFont } from '../theme/responsive';
import { useTheme } from '../theme/ThemeContext';
import { pressScale } from '../theme/motion';
import { notify, confirm } from '../lib/notify';
import { PressableScale } from './PressableScale';
import {
  addLinea,
  createDraft,
  draftFromRecord,
  removeLinea,
  updateLinea,
  type FacturaDraft,
  type FacturaLineaDraft,
  type FacturaRecord,
} from '../lib/facturaProveedor';
import type { EditorController, FeedbackKind } from '../lib/facturaEditorController';
import { FacturaError, mapFacturaError } from '../lib/facturaProveedorRepository';
import { newUuid, pickFacturaDocument } from '../lib/facturaDocumentoPicker';
import {
  facturaBorradoresQueryKey,
  facturaEditorService,
  facturaRepository,
  facturasQueryKey,
} from '../hooks/useFacturasProveedor';

interface FacturaProveedorEditorProps {
  facturaId: string;
  /** Saved invoice to reopen; null starts a new one. Only seeds a controller that has no local draft. */
  record: FacturaRecord | null;
  ownerId: string;
  proveedorCodigo?: string;
  proveedorNombre?: string;
  onClose: () => void;
  /** Discards local edits and loads the server's current version. */
  onReload: () => void;
}

interface FieldProps {
  label: string;
  value: string;
  testID: string;
  error?: string;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad';
  multiline?: boolean;
  onChangeText: (text: string) => void;
}

function Field({ label, value, testID, error, placeholder, keyboardType = 'default', multiline = false, onChangeText }: FieldProps): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          { color: colors.text, borderColor: error ? colors.danger : colors.border, backgroundColor: colors.surface },
        ]}
        value={value}
        testID={testID}
        accessibilityLabel={label}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCorrect={false}
      />
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

type BannerTone = 'ok' | 'warning' | 'error';

interface Banner {
  tone: BannerTone;
  text: string;
  kind?: FeedbackKind;
}

const SAVED_ON_SERVER = 'Guardada en el servidor.';
const REPLAYED_ON_SERVER = 'Ya estaba guardada en el servidor.';
const SAVED_ON_DEVICE = 'Guardado en este dispositivo';
const UNSAVED_ON_DEVICE = 'Sin guardar en este dispositivo';
const UPLOAD_INTERRUPTED = 'Carga interrumpida: el archivo no se adjuntó. Vuelve a adjuntarlo.';

const WARNING_KINDS: readonly FeedbackKind[] = ['conflict', 'key_reused', 'retry_pending', 'upload_interrupted'];
const RETRYABLE_KINDS: readonly FeedbackKind[] = ['nondurable', 'retry_pending'];

function bannerToneColor(tone: BannerTone, colors: { success: string; warning: string; danger: string }): string {
  switch (tone) {
    case 'ok':
      return colors.success;
    case 'warning':
      return colors.warning;
    default:
      return colors.danger;
  }
}

function initialDraft(props: FacturaProveedorEditorProps): FacturaDraft {
  if (props.record) return draftFromRecord(props.record);
  return createDraft({
    facturaId: props.facturaId,
    proveedorCodigo: props.proveedorCodigo,
    proveedorNombre: props.proveedorNombre,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof FacturaError ? error.message : mapFacturaError(error as Error).message;
}

/** Acquires the durable controller for this account and invoice, then renders the editor bound to it. */
export default function FacturaProveedorEditor(props: FacturaProveedorEditorProps): React.JSX.Element {
  const { colors } = useTheme();
  const { facturaId, ownerId, record } = props;
  const [controller, setController] = useState<EditorController | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  const [attempt, setAttempt] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    let acquired: EditorController | null = null;
    facturaEditorService
      .acquire({
        uid: ownerId,
        facturaId,
        draft: initialDraft(props),
        savedDocumentPath: record?.documento_path ?? null,
      })
      .then(
        next => {
          acquired = next;
          if (cancelled) void next.close();
          else setController(next);
        },
        () => {
          if (!cancelled) setFailed(true);
        },
      );
    return () => {
      cancelled = true;
      // Leaving by any route (back gesture included) keeps unsaved content as a local draft.
      void acquired?.close();
    };
    // The seed only matters for the first acquisition of this account and invoice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, facturaId, attempt]);

  function retryOpen(): void {
    setFailed(false);
    setAttempt(current => current + 1);
  }

  if (controller === null) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]} testID="factura-editor-loading">
        {failed ? (
          <>
            <Text style={[styles.error, { color: colors.danger }]}>No se pudo abrir el editor. Inténtalo otra vez.</Text>
            <PressableScale onPress={retryOpen} style={[styles.bannerBtn, { borderColor: colors.danger }]} accessibilityRole="button">
              <Text style={[styles.bannerBtnText, { color: colors.danger }]}>Reintentar</Text>
            </PressableScale>
          </>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
    );
  }

  return <EditorBody {...props} controller={controller} />;
}

function EditorBody(props: FacturaProveedorEditorProps & { controller: EditorController }): React.JSX.Element {
  const { controller, ownerId, onClose, onReload } = props;
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const { draft } = state;

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Banner | null>(null);
  const [busyDocument, setBusyDocument] = useState<boolean>(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function refreshLists(): void {
    void queryClient.invalidateQueries({ queryKey: [...facturasQueryKey, 'lista'] });
    void queryClient.invalidateQueries({ queryKey: facturaBorradoresQueryKey(ownerId) });
  }

  function edit(update: (current: FacturaDraft) => FacturaDraft): void {
    controller.edit(update);
    setNotice(null);
  }

  function setField(field: keyof FacturaDraft, value: string): void {
    edit(current => ({ ...current, [field]: value }));
  }

  function setLineaField(lineaId: string, field: keyof FacturaLineaDraft, value: string): void {
    edit(current => updateLinea(current, lineaId, { [field]: value }));
  }

  async function handleAttach(): Promise<void> {
    setBusyDocument(true);
    try {
      const picked = await pickFacturaDocument();
      if (picked === null) return;
      if (!picked.ok) {
        notify('No se pudo adjuntar', picked.error);
        return;
      }
      const outcome = await controller.attach(picked.bytes, picked.nombre);
      if (outcome.status === 'invalid') {
        notify('No se pudo adjuntar', outcome.message);
        return;
      }
      setPreviewUrl(null);
      setNotice(outcome.status === 'attached' ? null : { tone: 'error', text: outcome.message });
    } catch (error) {
      notify('No se pudo adjuntar', errorMessage(error));
    } finally {
      setBusyDocument(false);
    }
  }

  function handleRemoveDocument(): void {
    setPreviewUrl(null);
    edit(current => ({ ...current, documento: null }));
    void controller.sweep();
  }

  async function handleViewDocument(): Promise<void> {
    if (!draft.documento) return;
    setBusyDocument(true);
    try {
      const url = await facturaRepository.urlDocumento(draft.documento.path);
      if (draft.documento.mime === 'application/pdf') {
        await Linking.openURL(url);
      } else {
        setPreviewUrl(url);
      }
    } catch (error) {
      notify('No se pudo abrir el documento', errorMessage(error));
    } finally {
      setBusyDocument(false);
    }
  }

  async function handleSave(): Promise<void> {
    setErrors({});
    const outcome = await controller.save();
    switch (outcome.status) {
      case 'invalid':
        setErrors(outcome.errors);
        setNotice({ tone: 'error', text: 'Revisa los campos marcados en rojo.' });
        return;
      case 'saved':
        setNotice({ tone: 'ok', text: outcome.replay ? REPLAYED_ON_SERVER : SAVED_ON_SERVER });
        refreshLists();
        void controller.sweep();
        return;
      default:
        setNotice({ tone: 'error', text: outcome.message });
    }
  }

  async function finishClose(): Promise<void> {
    const outcome = await controller.close();
    if (outcome.status === 'closed') {
      refreshLists();
      onClose();
      return;
    }
    setNotice({ tone: 'error', text: outcome.message });
  }

  function handleClose(): void {
    if (state.saving || state.uploading || !state.dirty) {
      void finishClose();
      return;
    }
    confirm({
      title: 'Cerrar con cambios sin guardar',
      message: 'Los cambios se conservan como borrador en este dispositivo.',
      confirmText: 'Cerrar',
      cancelText: 'Seguir editando',
      onConfirm: finishClose,
    });
  }

  async function discardDraft(): Promise<void> {
    const outcome = await controller.discard(true);
    if (outcome.status === 'discarded') {
      refreshLists();
      onClose();
      return;
    }
    setNotice({ tone: 'error', text: 'message' in outcome ? outcome.message : 'No se pudo descartar el borrador.' });
  }

  function handleDiscard(): void {
    confirm({
      title: 'Descartar borrador',
      message: 'Se borra este borrador del dispositivo. No afecta lo que ya está guardado en el servidor.',
      confirmText: 'Descartar',
      cancelText: 'Seguir editando',
      destructive: true,
      onConfirm: discardDraft,
    });
  }

  function handleReload(): void {
    confirm({
      title: 'Recargar la factura',
      message: 'Se descartan tus cambios locales y se carga la última versión guardada.',
      confirmText: 'Recargar',
      destructive: true,
      onConfirm: async () => {
        const outcome = await controller.discard(true);
        if (outcome.status === 'discarded') {
          refreshLists();
          onReload();
        } else {
          setNotice({ tone: 'error', text: 'message' in outcome ? outcome.message : 'No se pudo recargar la factura.' });
        }
      },
    });
  }

  const feedback = state.feedback;
  const banner: Banner | null = feedback
    ? { tone: WARNING_KINDS.includes(feedback.kind) ? 'warning' : 'error', text: feedback.message, kind: feedback.kind }
    : notice;
  const showInterrupted = state.interruptedUploads.length > 0 && feedback?.kind !== 'upload_interrupted';
  const canRetry = banner?.kind !== undefined && RETRYABLE_KINDS.includes(banner.kind);
  const canSave = (state.dirty || state.retryPending) && !state.saving && !state.uploading && !state.closed;
  const busy = busyDocument || state.uploading;
  const bannerColor = banner ? bannerToneColor(banner.tone, colors) : colors.danger;
  const isForeignCurrency = draft.moneda !== '' && draft.moneda !== 'USD';
  let deviceStatus: string | null = null;
  if (state.dirty) deviceStatus = state.localSaved ? SAVED_ON_DEVICE : UNSAVED_ON_DEVICE;

  return (
    <View style={[styles.flex, { backgroundColor: colors.bg }]} testID="factura-editor">
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <PressableScale onPress={handleClose} hitSlop={8} activeScale={pressScale.icon} accessibilityRole="button" accessibilityLabel="Cerrar factura" testID="factura-close">
          <Feather name="chevron-left" size={22} color={colors.text} />
        </PressableScale>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {draft.numeroDocumento.trim() !== '' ? `Factura ${draft.numeroDocumento.trim()}` : 'Factura de proveedor'}
        </Text>
        <Text style={[styles.version, { color: colors.textDim }]}>{draft.version > 0 ? `v${draft.version}` : 'nueva'}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {banner ? (
          <View style={[styles.banner, { borderColor: bannerColor, backgroundColor: colors.surface }]} testID="factura-banner">
            <Text style={[styles.bannerText, { color: bannerColor }]}>{banner.text}</Text>
            {canRetry ? (
              <PressableScale onPress={handleSave} style={[styles.bannerBtn, { borderColor: bannerColor }]} accessibilityRole="button" testID="factura-retry">
                <Text style={[styles.bannerBtnText, { color: bannerColor }]}>Reintentar</Text>
              </PressableScale>
            ) : null}
            {banner.kind === 'conflict' ? (
              <PressableScale onPress={handleReload} style={[styles.bannerBtn, { borderColor: bannerColor }]} accessibilityRole="button" testID="factura-reload">
                <Text style={[styles.bannerBtnText, { color: bannerColor }]}>Recargar versión del servidor</Text>
              </PressableScale>
            ) : null}
          </View>
        ) : null}
        {showInterrupted ? (
          <View style={[styles.banner, { borderColor: colors.warning, backgroundColor: colors.surface }]} testID="factura-carga-interrumpida">
            <Text style={[styles.bannerText, { color: colors.warning }]}>{UPLOAD_INTERRUPTED}</Text>
          </View>
        ) : null}
        {deviceStatus ? (
          <Text style={[styles.hint, { color: colors.textDim }]} testID="factura-estado-local">{deviceStatus}</Text>
        ) : null}

        <Text style={[styles.section, { color: colors.primary }]}>DOCUMENTO FUENTE</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {draft.documento ? (
            <>
              <View style={styles.row}>
                <Feather name={draft.documento.mime === 'application/pdf' ? 'file-text' : 'image'} size={18} color={colors.primary} />
                <Text style={[styles.docName, { color: colors.text }]} numberOfLines={1}>{draft.documento.nombre}</Text>
              </View>
              <View style={styles.row}>
                <PressableScale onPress={handleViewDocument} dimmed={busy} disabled={busy} style={[styles.secondaryBtn, { borderColor: colors.border }]} testID="factura-ver-documento">
                  <Feather name="eye" size={14} color={colors.text} />
                  <Text style={[styles.secondaryText, { color: colors.text }]}>Ver</Text>
                </PressableScale>
                <PressableScale onPress={handleAttach} dimmed={busy} disabled={busy} style={[styles.secondaryBtn, { borderColor: colors.border }]} testID="factura-replace">
                  <Feather name="refresh-cw" size={14} color={colors.text} />
                  <Text style={[styles.secondaryText, { color: colors.text }]}>Reemplazar</Text>
                </PressableScale>
                <PressableScale onPress={handleRemoveDocument} dimmed={busy} disabled={busy} style={[styles.secondaryBtn, { borderColor: colors.border }]} testID="factura-quitar-documento">
                  <Feather name="x" size={14} color={colors.danger} />
                  <Text style={[styles.secondaryText, { color: colors.danger }]}>Quitar</Text>
                </PressableScale>
              </View>
              {previewUrl ? <Image source={{ uri: previewUrl }} style={styles.preview} contentFit="contain" /> : null}
            </>
          ) : (
            <PressableScale onPress={handleAttach} dimmed={busy} disabled={busy} style={[styles.attachBtn, { borderColor: colors.primary, backgroundColor: colors.primaryFaded }]} testID="factura-attach">
              {busy ? <ActivityIndicator color={colors.primary} /> : <Feather name="paperclip" size={16} color={colors.primary} />}
              <Text style={[styles.attachText, { color: colors.primary }]}>Adjuntar PDF o imagen</Text>
            </PressableScale>
          )}
          <Text style={[styles.hint, { color: colors.textDim }]}>
            El archivo es privado. Máximo 10 MB. No se lee ni se crea ninguna compra: solo se guarda.
          </Text>
        </View>

        <Text style={[styles.section, { color: colors.primary }]}>DATOS DE LA FACTURA</Text>
        <Field label="Proveedor" testID="factura-field-proveedorNombre" value={draft.proveedorNombre} error={errors.proveedorNombre} onChangeText={t => setField('proveedorNombre', t)} />
        <Field label="Número de factura" testID="factura-field-numeroDocumento" value={draft.numeroDocumento} error={errors.numeroDocumento} onChangeText={t => setField('numeroDocumento', t)} />
        <Field label="Número de control" testID="factura-field-numeroControl" value={draft.numeroControl} error={errors.numeroControl} onChangeText={t => setField('numeroControl', t)} />
        <Field label="Fecha" testID="factura-field-fechaDocumento" value={draft.fechaDocumento} error={errors.fechaDocumento} placeholder="AAAA-MM-DD" onChangeText={t => setField('fechaDocumento', t)} />
        <Field label="Notas" testID="factura-field-notas" value={draft.notas} error={errors.notas} multiline onChangeText={t => setField('notas', t)} />
        <Text style={[styles.hint, { color: colors.textDim }]}>
          {`Importes en USD. Moneda del documento: ${draft.moneda || 'sin indicar'}.`}
          {isForeignCurrency ? ' Se muestran tal como están en el documento, sin convertir.' : ''}
        </Text>
        {errors.moneda ? <Text style={[styles.error, { color: colors.danger }]}>{errors.moneda}</Text> : null}

        <Text style={[styles.section, { color: colors.primary }]}>{`RENGLONES (${draft.lineas.length})`}</Text>
        {errors.lineas ? <Text style={[styles.error, { color: colors.danger }]}>{errors.lineas}</Text> : null}
        {draft.lineas.map((linea, index) => {
          const id = `factura-linea-${index}`;
          return (
            <View key={linea.lineaId} testID={id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.lineaHeader}>
                <Text style={[styles.lineaTitle, { color: colors.text }]}>{`Renglón ${index + 1}`}</Text>
                <PressableScale onPress={() => edit(current => removeLinea(current, linea.lineaId))} hitSlop={8} activeScale={pressScale.icon} accessibilityRole="button" accessibilityLabel={`Quitar renglón ${index + 1}`} testID={`${id}-quitar`}>
                  <Feather name="trash-2" size={16} color={colors.danger} />
                </PressableScale>
              </View>
              <Field label="Código del proveedor" testID={`${id}-codigoProveedor`} value={linea.codigoProveedor} error={errors[`${linea.lineaId}:codigoProveedor`]} onChangeText={t => setLineaField(linea.lineaId, 'codigoProveedor', t)} />
              <Field label="Código interno (SKU)" testID={`${id}-codigoProducto`} value={linea.codigoProducto} error={errors[`${linea.lineaId}:codigoProducto`]} onChangeText={t => setLineaField(linea.lineaId, 'codigoProducto', t)} />
              <Field label="Descripción" testID={`${id}-descripcion`} value={linea.descripcion} error={errors[`${linea.lineaId}:descripcion`]} onChangeText={t => setLineaField(linea.lineaId, 'descripcion', t)} />
              <Field label="Cantidad" testID={`${id}-cantidad`} value={linea.cantidad} error={errors[`${linea.lineaId}:cantidad`]} keyboardType="decimal-pad" onChangeText={t => setLineaField(linea.lineaId, 'cantidad', t)} />
              <Field label="Unidad" testID={`${id}-unidad`} value={linea.unidad} error={errors[`${linea.lineaId}:unidad`]} onChangeText={t => setLineaField(linea.lineaId, 'unidad', t)} />
              <Field label="Costo unitario (USD)" testID={`${id}-costoUnitario`} value={linea.costoUnitario} error={errors[`${linea.lineaId}:costoUnitario`]} keyboardType="decimal-pad" onChangeText={t => setLineaField(linea.lineaId, 'costoUnitario', t)} />
              <Field label="Total del renglón (USD)" testID={`${id}-total`} value={linea.total} error={errors[`${linea.lineaId}:total`]} keyboardType="decimal-pad" onChangeText={t => setLineaField(linea.lineaId, 'total', t)} />
              <Field label="Nota" testID={`${id}-nota`} value={linea.nota} error={errors[`${linea.lineaId}:nota`]} onChangeText={t => setLineaField(linea.lineaId, 'nota', t)} />
            </View>
          );
        })}
        <PressableScale onPress={() => edit(current => addLinea(current, newUuid(), {}))} style={[styles.attachBtn, { borderColor: colors.primary, backgroundColor: colors.primaryFaded }]} testID="factura-add-linea">
          <Feather name="plus" size={16} color={colors.primary} />
          <Text style={[styles.attachText, { color: colors.primary }]}>Agregar renglón</Text>
        </PressableScale>
        <Text style={[styles.hint, { color: colors.textDim }]}>
          Cada renglón se guarda tal como aparece en la factura, aunque el SKU se repita.
        </Text>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
        <PressableScale
          onPress={handleDiscard}
          dimmed={state.saving || state.uploading}
          disabled={state.saving || state.uploading}
          style={[styles.discardBtn, { borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Descartar borrador"
          testID="factura-discard"
        >
          <Feather name="trash-2" size={14} color={colors.danger} />
          <Text style={[styles.secondaryText, { color: colors.danger }]}>Descartar</Text>
        </PressableScale>
        <PressableScale
          onPress={handleSave}
          dimmed={!canSave}
          disabled={!canSave}
          style={[styles.saveBtn, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
          testID="factura-save"
        >
          {state.saving ? <ActivityIndicator color={colors.onPrimary} /> : <Feather name="save" size={16} color={colors.onPrimary} />}
          <Text style={[styles.saveText, { color: colors.onPrimary }]}>{canSave || state.saving ? 'Guardar factura' : 'Sin cambios'}</Text>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5 },
  title: { flex: 1, fontSize: scaleFont(15), fontFamily: 'JetBrainsMono_700Bold' },
  version: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_500Medium' },
  scroll: { padding: 16, gap: 12, paddingBottom: 32 },
  section: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_700Bold', letterSpacing: 1, marginTop: 8 },
  card: { borderWidth: 0.5, borderRadius: 12, padding: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  field: { gap: 4 },
  label: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_500Medium' },
  input: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_400Regular', borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top' },
  error: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular' },
  hint: { fontSize: scaleFont(11), fontFamily: 'JetBrainsMono_400Regular', lineHeight: scaleFont(16) },
  banner: { borderWidth: 0.5, borderRadius: 12, padding: 12, gap: 8 },
  bannerText: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_500Medium', lineHeight: scaleFont(17) },
  bannerBtn: { borderWidth: 0.5, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  bannerBtnText: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_700Bold' },
  docName: { flex: 1, fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_500Medium' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  secondaryText: { fontSize: scaleFont(12), fontFamily: 'JetBrainsMono_500Medium' },
  attachBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 12 },
  attachText: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },
  preview: { width: '100%', height: 220, borderRadius: 8 },
  lineaHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineaTitle: { fontSize: scaleFont(13), fontFamily: 'JetBrainsMono_700Bold' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderTopWidth: 0.5 },
  discardBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 0.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14 },
  saveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 14 },
  saveText: { fontSize: scaleFont(14), fontFamily: 'JetBrainsMono_700Bold' },
});
