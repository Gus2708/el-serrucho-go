import { Tabs } from 'expo-router';
import { FloatingTabBar } from '../../src/components/FloatingTabBar';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index"      options={{ title: 'Inicio'     }} />
      <Tabs.Screen name="ventas"     options={{ title: 'Ventas'     }} />
      <Tabs.Screen name="inventario" options={{ title: 'Inventario' }} />
      <Tabs.Screen name="alertas"    options={{ title: 'Alertas'    }} />
      <Tabs.Screen name="reportes"   options={{ title: 'Reportes'   }} />
      <Tabs.Screen name="ordenes"    options={{ title: 'Órdenes'    }} />
    </Tabs>
  );
}
