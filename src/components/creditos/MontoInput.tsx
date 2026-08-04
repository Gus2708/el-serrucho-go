import { scaleFont } from '../../theme/responsive';
import * as React from 'react';
import { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

interface MontoInputProps {
  valor:        string;
  onChange:     (texto: string) => void;
  autoFocus?:   boolean;
  placeholder?: string;
}

/**
 * Filtra lo que el usuario teclea antes de que llegue a `onChange`: solo
 * dígitos, un único separador decimal (`.` o `,`) y máximo 2 decimales. El
 * padre nunca recibe un texto inválido, así que no hace falta validar recién
 * al enviar — la caja misma no lo permite.
 */
function filtrarEntrada(texto: string): string {
  let limpio = texto.replace(/[^0-9.,]/g, '');

  const primerSeparador = limpio.search(/[.,]/);
  if (primerSeparador !== -1) {
    const separador = limpio[primerSeparador];
    const entera = limpio.slice(0, primerSeparador);
    const resto = limpio.slice(primerSeparador + 1).replace(/[.,]/g, '');
    limpio = `${entera}${separador}${resto.slice(0, 2)}`;
  }

  return limpio;
}

/**
 * Input de monto compartido por todos los sheets de crédito: texto gigante,
 * centrado, con un "$" fijo a la izquierda. Maneja TEXTO — la conversión a
 * número confiable (`parseMonto`) la hace el padre al enviar.
 */
export function MontoInput({ valor, onChange, autoFocus, placeholder = '0.00' }: MontoInputProps): React.ReactElement {
  const { colors } = useTheme();
  const [enfocado, setEnfocado] = useState<boolean>(false);

  function handleChangeText(texto: string): void {
    onChange(filtrarEntrada(texto));
  }

  return (
    <View style={styles.root}>
      <View style={styles.fila}>
        <Text style={[styles.signo, { color: colors.textMuted }]}>$</Text>
        <TextInput
          style={[styles.input, { color: colors.text }]}
          value={valor}
          onChangeText={handleChangeText}
          keyboardType="decimal-pad"
          placeholder={placeholder}
          placeholderTextColor={colors.textDim}
          autoFocus={autoFocus}
          onFocus={() => setEnfocado(true)}
          onBlur={() => setEnfocado(false)}
        />
      </View>
      <View style={[styles.linea, { backgroundColor: enfocado ? colors.primary : colors.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
  },
  fila: {
    flexDirection: 'row',
    alignItems:    'center',
    justifyContent: 'center',
    gap:           4,
  },
  signo: {
    fontSize:   scaleFont(24),
    fontFamily: 'JetBrainsMono_700Bold',
    marginTop:  4,
  },
  input: {
    fontSize:   scaleFont(36),
    fontFamily: 'JetBrainsMono_700Bold',
    textAlign:  'center',
    minWidth:   140,
    padding:    0,
  },
  linea: {
    height:       2,
    width:        '60%',
    borderRadius: 1,
    marginTop:    10,
  },
});
