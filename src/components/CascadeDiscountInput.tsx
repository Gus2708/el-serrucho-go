import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { scaleFont } from '../theme/responsive';
import { pressScale } from '../theme/motion';
import { PressableScale } from './PressableScale';
import {
  descuentosIguales,
  MAX_DESCUENTO_STEPS,
  normalizarDescuentos,
  parseDescuentoTexto,
} from '../lib/compraDescuentos';

export interface CascadeDiscountInputProps {
  value:               number[];
  onChange:            (steps: number[]) => void;
  onValidationChange?: (hasError: boolean) => void;
  placeholder?:        string;
  compact?:            boolean;
  autoFocus?:          boolean;
  testIDPrefix?:       string;
  accessibilityLabel?: string;
}

/**
 * Editable percentage discount control supporting single percentages (e.g. `15`)
 * and cascaded discounts (e.g. `20%` + `5%` = 24% real) via `+` button or typing `+`.
 * Emits updates live on every valid keystroke without requiring blur or pressing `+`.
 */
export function CascadeDiscountInput({
  value,
  onChange,
  onValidationChange,
  placeholder = 'Desc %',
  compact = false,
  autoFocus = false,
  testIDPrefix = 'cascade-discount',
  accessibilityLabel = 'Descuento en porcentaje',
}: CascadeDiscountInputProps): React.JSX.Element {
  const { colors } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [committedSteps, setCommittedSteps] = useState<number[]>(() => normalizarDescuentos(value));
  const [activeText, setActiveText] = useState<string>('');
  const [errorText, setErrorText] = useState<string | null>(null);

  const stateRef = useRef({ committedSteps, activeText });
  stateRef.current = { committedSteps, activeText };

  useEffect(() => {
    const incoming = normalizarDescuentos(value);
    const { committedSteps: curCommitted, activeText: curActive } = stateRef.current;
    const parsedActive = parseDescuentoTexto(curActive);
    const curEffective =
      parsedActive.draftValue !== null
        ? [...curCommitted, parsedActive.draftValue].slice(0, MAX_DESCUENTO_STEPS)
        : curCommitted;

    if (!descuentosIguales(curEffective, incoming)) {
      setCommittedSteps(incoming);
      setActiveText('');
      setErrorText(null);
      onValidationChange?.(false);
    }
  }, [value, onValidationChange]);

  const decimalKeyboard = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad';
  const parsedCurrent = parseDescuentoTexto(activeText);
  const canAddStep =
    parsedCurrent.draftValue !== null &&
    parsedCurrent.error === null &&
    committedSteps.length + 1 < MAX_DESCUENTO_STEPS;

  function emitSteps(committed: number[], draftVal: number | null): void {
    const combined =
      draftVal !== null ? [...committed, draftVal].slice(0, MAX_DESCUENTO_STEPS) : committed;
    onChange(combined);
  }

  function handleTextChange(raw: string): void {
    const parsed = parseDescuentoTexto(raw);
    let nextCommitted = committedSteps;

    if (parsed.committed.length > 0) {
      nextCommitted = [...committedSteps, ...parsed.committed].slice(0, MAX_DESCUENTO_STEPS);
      setCommittedSteps(nextCommitted);
    }

    setActiveText(parsed.draft);
    setErrorText(parsed.error);
    onValidationChange?.(Boolean(parsed.error));

    if (!parsed.error) {
      emitSteps(nextCommitted, parsed.draftValue);
    } else {
      emitSteps(nextCommitted, null);
    }
  }

  function handleCommitStep(): void {
    if (!canAddStep || parsedCurrent.draftValue === null) return;
    const nextCommitted = [...committedSteps, parsedCurrent.draftValue].slice(0, MAX_DESCUENTO_STEPS);
    setCommittedSteps(nextCommitted);
    setActiveText('');
    setErrorText(null);
    onValidationChange?.(false);
    emitSteps(nextCommitted, null);
    inputRef.current?.focus();
  }

  function handleRemoveStep(index: number): void {
    const nextCommitted = committedSteps.filter((_, i) => i !== index);
    setCommittedSteps(nextCommitted);
    emitSteps(nextCommitted, parsedCurrent.error ? null : parsedCurrent.draftValue);
  }

  const borderColor = errorText ? colors.danger : colors.border;

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.row,
          compact ? styles.rowCompact : styles.rowRegular,
          { borderColor, backgroundColor: colors.surfaceAlt },
        ]}
      >
        {committedSteps.map((step, index) => (
          <View
            key={`${step}-${index}`}
            testID={`${testIDPrefix}-chip-${index}`}
            style={[
              styles.chip,
              {
                backgroundColor: colors.primaryFaded,
                borderColor:     colors.primary + '55',
              },
            ]}
          >
            <Text style={[styles.chipText, { color: colors.primary }]}>-{step}%</Text>
            <PressableScale
              testID={`${testIDPrefix}-chip-remove-${index}`}
              onPress={() => handleRemoveStep(index)}
              hitSlop={8}
              activeScale={pressScale.icon}
              accessibilityRole="button"
              accessibilityLabel={`Quitar descuento ${step}%`}
              style={styles.chipRemoveBtn}
            >
              <Feather name="x" size={11} color={colors.primary} />
            </PressableScale>
          </View>
        ))}

        {committedSteps.length < MAX_DESCUENTO_STEPS ? (
          <View style={styles.inputGroup}>
            <TextInput
              ref={inputRef}
              testID={`${testIDPrefix}-input`}
              style={[
                styles.input,
                compact ? styles.inputCompact : styles.inputRegular,
                { color: colors.text },
              ]}
              value={activeText}
              onChangeText={handleTextChange}
              placeholder={committedSteps.length > 0 ? '+ %' : placeholder}
              placeholderTextColor={colors.textDim}
              keyboardType={decimalKeyboard}
              autoFocus={autoFocus}
              selectTextOnFocus
              accessibilityLabel={accessibilityLabel}
            />
            <Text style={[styles.percentSuffix, { color: colors.textMuted }]}>%</Text>
          </View>
        ) : null}

        {canAddStep ? (
          <PressableScale
            testID={`${testIDPrefix}-add-step`}
            onPress={handleCommitStep}
            hitSlop={8}
            activeScale={pressScale.icon}
            accessibilityRole="button"
            accessibilityLabel="Encadenar otro descuento"
            style={[
              styles.addStepBtn,
              {
                backgroundColor: colors.primaryFaded,
                borderColor:     colors.primary + '55',
              },
            ]}
          >
            <Feather name="plus" size={12} color={colors.primary} />
          </PressableScale>
        ) : null}
      </View>

      {errorText ? (
        <View testID={`${testIDPrefix}-error`} style={styles.errorRow}>
          <Feather name="alert-circle" size={11} color={colors.danger} />
          <Text style={[styles.errorText, { color: colors.danger }]}>{errorText}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 4, flex: 1 },
  row: {
    flexDirection:     'row',
    flexWrap:          'wrap',
    alignItems:        'center',
    gap:               6,
    borderWidth:       1,
    borderRadius:      8,
    paddingHorizontal: 8,
  },
  rowCompact: { minHeight: 34, paddingVertical: 3 },
  rowRegular: { minHeight: 40, paddingVertical: 5 },
  chip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               3,
    borderRadius:      6,
    borderWidth:       0.5,
    paddingLeft:       6,
    paddingRight:      4,
    paddingVertical:   2,
  },
  chipText: {
    fontSize:    scaleFont(11),
    fontFamily:  'JetBrainsMono_700Bold',
    fontVariant: ['tabular-nums'],
  } as any,
  chipRemoveBtn: { padding: 2 },
  inputGroup: {
    flex:          1,
    minWidth:      56,
    flexDirection: 'row',
    alignItems:    'center',
    gap:           2,
  },
  input: {
    flex:              1,
    minWidth:          40,
    fontFamily:        'JetBrainsMono_700Bold',
    paddingVertical:   0,
    paddingHorizontal: 0,
    includeFontPadding: false,
    fontVariant:       ['tabular-nums'],
  } as any,
  inputCompact: { fontSize: scaleFont(12), height: 26 },
  inputRegular: { fontSize: scaleFont(14), height: 28 },
  percentSuffix: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_500Medium',
  },
  addStepBtn: {
    width:          26,
    height:         26,
    borderRadius:   6,
    borderWidth:    0.5,
    alignItems:     'center',
    justifyContent: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
  },
  errorText: {
    fontSize:   scaleFont(10),
    fontFamily: 'JetBrainsMono_500Medium',
  },
});
