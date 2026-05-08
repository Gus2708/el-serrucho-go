import * as React from 'react';
import { View } from 'react-native';
import { useTheme } from '../src/theme/ThemeContext';

/**
 * Esta es la ruta raíz '/'.
 * El RootLayout maneja la lógica de autenticación y redirección.
 * Retornamos un View con el color de fondo del tema para evitar parpadeos negros.
 */
export default function RootIndex() {
  const { colors } = useTheme();
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}
