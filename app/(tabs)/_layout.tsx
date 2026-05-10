import { Platform, View } from 'react-native';
import { Tabs } from 'expo-router';
import { FloatingTabBar } from '../../src/components/FloatingTabBar';
import { Sidebar } from '../../src/components/Sidebar';
import { useDeviceSize } from '../../src/hooks/useDeviceSize';

export default function TabLayout() {
  const { isDesktop } = useDeviceSize();
  const useWebSidebar = Platform.OS === 'web' && isDesktop;

  return (
    <View style={{ flex: 1, flexDirection: useWebSidebar ? 'row' : 'column' }}>
      {useWebSidebar && <Sidebar />}
      <View style={{ flex: 1, minWidth: 0 }}>
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
      </View>
    </View>
  );
}
