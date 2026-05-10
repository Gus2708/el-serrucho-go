import { Platform, View } from 'react-native';
import { Tabs } from 'expo-router';
import { FloatingTabBar } from '../../src/components/FloatingTabBar';
import { Sidebar } from '../../src/components/Sidebar';
import { useDeviceSize } from '../../src/hooks/useDeviceSize';

export default function TabLayout() {
  const { isDesktop } = useDeviceSize();
  const useWebSidebar = Platform.OS === 'web' && isDesktop;

  const tabs = (
    <Tabs
      tabBar={useWebSidebar ? () => null : (props) => <FloatingTabBar {...props} />}
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

  return (
    <View style={{ flex: 1, flexDirection: useWebSidebar ? 'row' : 'column' }}>
      {useWebSidebar && <Sidebar />}

      {/* Content pane: fills the full remaining viewport width on desktop */}
      <View style={{ flex: 1, minWidth: 0 }}>
        {tabs}
      </View>
    </View>
  );
}
