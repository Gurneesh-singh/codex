import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { AppButton } from './src/components/AppButton';
import { AuthScreen } from './src/screens/AuthScreen';
import { ConnectionScreen } from './src/screens/ConnectionScreen';
import { RetailerDashboardScreen, SupplierDashboardScreen } from './src/screens/DashboardScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { PasswordResetScreen } from './src/screens/PasswordResetScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ProductsScreen } from './src/screens/ProductsScreen';
import { ContactsScreen } from './src/screens/ContactsScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { VoiceOrderScreen } from './src/screens/VoiceOrderScreen';
import { signOut } from './src/services/auth';
import { orderIdFromLink } from './src/services/orderLinks';
import { colors, spacing } from './src/theme/tokens';

export type RootStackParams = {
  Auth: undefined;
  Onboarding: undefined;
  SupplierDashboard: undefined;
  RetailerDashboard: undefined;
  Settings: undefined;
  PasswordReset: undefined;
  Connection: undefined;
  Products: undefined;
  Contacts: undefined;
  Orders: { orderId?: string; openSend?: boolean; notice?: string } | undefined;
  VoiceOrder: undefined;
};

const Stack = createNativeStackNavigator<RootStackParams>();
const navigationRef = createNavigationContainerRef<RootStackParams>();
const pendingOrderKey = 'bolovyapar-pending-order';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider><AppNavigator /></AuthProvider>
    </SafeAreaProvider>
  );
}

function AppNavigator() {
  const { session, account, loading, error, recoveryMode, refreshAccount } = useAuth();
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [navigationEpoch, setNavigationEpoch] = useState(0);
  useEffect(() => {
    const capture = (url: string) => {
      const orderId = orderIdFromLink(url);
      if (!orderId) return;
      setPendingOrderId(orderId);
      if (Platform.OS === 'web') window.sessionStorage.setItem(pendingOrderKey, orderId);
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      capture(window.location.href);
      const saved = window.sessionStorage.getItem(pendingOrderKey);
      if (saved && orderIdFromLink(`bolovyapar://order/${saved}`)) setPendingOrderId(saved);
    }
    void Linking.getInitialURL().then((url) => { if (url) capture(url); });
    const subscription = Linking.addEventListener('url', ({ url }) => capture(url));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (loading || recoveryMode || error || !session || !account?.business || !pendingOrderId || !navigationRef.isReady()) return;
    navigationRef.navigate('Orders', { orderId: pendingOrderId, notice: 'Opened from order QR code.' });
    setPendingOrderId(null);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.sessionStorage.removeItem(pendingOrderKey);
      const clean = new URL(window.location.href);
      clean.searchParams.delete('order');
      window.history.replaceState(window.history.state, '', clean.pathname + clean.search + clean.hash);
    }
  }, [session, account?.business, loading, recoveryMode, error, pendingOrderId, navigationEpoch]);
  if (session && recoveryMode) return <NavigationContainer><StatusBar style="dark" /><Stack.Navigator><Stack.Screen name="PasswordReset" component={PasswordResetScreen} options={{ headerShown: false }} /></Stack.Navigator></NavigationContainer>;
  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /><Text style={styles.status}>Loading your workspace…</Text></View>;
  if (session && error) return <View style={styles.center}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><View style={styles.actions}><AppButton title="Retry" onPress={refreshAccount} /><AppButton title="Sign out" variant="secondary" onPress={() => void signOut()} /></View></View>;

  return <NavigationContainer ref={navigationRef} onReady={() => setNavigationEpoch((epoch) => epoch + 1)}>
    <StatusBar style="dark" />
    <Stack.Navigator screenOptions={{
      headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.ink,
      headerTitleStyle: { fontWeight: '700' }, contentStyle: { backgroundColor: colors.background }
    }}>
      {!session ? <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
        : !account?.business ? <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
            : account.business.kind === 'supplier' ? <>
              <Stack.Screen name="SupplierDashboard" component={SupplierDashboardScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Profile settings' }} />
              <Stack.Screen name="Connection" component={ConnectionScreen} options={{ title: 'Connection check' }} />
              <Stack.Screen name="Products" component={ProductsScreen} options={{ title: 'Products' }} />
              <Stack.Screen name="Contacts" component={ContactsScreen} options={{ title: 'Retailers' }} />
              <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: 'Orders and billing' }} />
              <Stack.Screen name="VoiceOrder" component={VoiceOrderScreen} options={{ title: 'Voice to order' }} />
            </> : <>
              <Stack.Screen name="RetailerDashboard" component={RetailerDashboardScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Profile settings' }} />
              <Stack.Screen name="Connection" component={ConnectionScreen} options={{ title: 'Connection check' }} />
              <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: 'Bills and orders' }} />
            </>}
    </Stack.Navigator>
  </NavigationContainer>;
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  status: { color: colors.muted },
  error: { color: colors.error, textAlign: 'center' },
  actions: { width: '100%', maxWidth: 280, gap: spacing.md }
});
