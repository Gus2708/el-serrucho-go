import { Platform, View } from 'react-native';
import { Tabs } from 'expo-router';
import { FloatingTabBar } from '../../src/components/FloatingTabBar';
import { Sidebar } from '../../src/components/Sidebar';
import { useDeviceSize } from '../../src/hooks/useDeviceSize';

// Max readable width for dashboard content on large screens
const CONTENT_MAX_WIDTH = 1080;

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

      {/* Content pane: centered at CONTENT_MAX_WIDTH on desktop */}
      <View style={{ flex: 1, minWidth: 0, alignItems: useWebSidebar ? 'center' : 'stretch' }}>
        <View style={{ flex: 1, width: '100%', maxWidth: useWebSidebar ? CONTENT_MAX_WIDTH : undefined }}>
          {tabs}
        </View>
      </View>
    </View>
  );
}
