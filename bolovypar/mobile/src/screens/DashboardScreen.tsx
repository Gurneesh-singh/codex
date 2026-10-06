import { useCallback, useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { RootStackParams } from '../../App';
import { useAuth } from '../auth/AuthProvider';
import { AppButton } from '../components/AppButton';
import { AppCard } from '../components/AppCard';
import { AppField } from '../components/AppField';
import { Screen } from '../components/Screen';
import { accountApi, type BusinessKind, type RetailerLink } from '../services/accountApi';
import { colors, spacing, type } from '../theme/tokens';

type SupplierProps = NativeStackScreenProps<RootStackParams, 'SupplierDashboard'>;
type RetailerProps = NativeStackScreenProps<RootStackParams, 'RetailerDashboard'>;

export function SupplierDashboardScreen({ navigation }: SupplierProps) {
  return <Dashboard kind="supplier" openSettings={() => navigation.navigate('Settings')} openConnection={() => navigation.navigate('Connection')}
    openProducts={() => navigation.navigate('Products')} openContacts={() => navigation.navigate('Contacts')} openOrders={() => navigation.navigate('Orders')}
    openVoice={() => navigation.navigate('VoiceOrder')} />;
}

export function RetailerDashboardScreen({ navigation }: RetailerProps) {
  return <Dashboard kind="retailer" openSettings={() => navigation.navigate('Settings')} openConnection={() => navigation.navigate('Connection')}
    openOrders={() => navigation.navigate('Orders')} />;
}

function Dashboard({ kind, openSettings, openConnection, openProducts, openContacts, openOrders, openVoice }: {
  kind: BusinessKind; openSettings: () => void; openConnection: () => void;
  openProducts?: () => void; openContacts?: () => void; openOrders: () => void; openVoice?: () => void;
}) {
  const { session, account } = useAuth();
  const [links, setLinks] = useState<RetailerLink[]>([]);
  const [retailerId, setRetailerId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const business = account?.business;

  const loadLinks = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try { setLinks((await accountApi.links(session.access_token)).links); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load relationships'); }
    finally { setLoading(false); }
  }, [session]);

  useEffect(() => { void loadLinks(); }, [loadLinks]);

  async function requestLink() {
    if (!session) return;
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(retailerId.trim())) { setError('Enter the retailer’s full business ID'); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await accountApi.requestLink(session.access_token, retailerId.trim());
      setRetailerId('');
      setMessage('Request sent. The retailer must accept it.');
      await loadLinks();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not request link'); }
    finally { setBusy(false); }
  }

  async function respond(id: string, accept: boolean) {
    if (!session) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await accountApi.respondLink(session.access_token, id, accept);
      setMessage(accept ? 'Supplier connected.' : 'Request declined.');
      await loadLinks();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not respond'); }
    finally { setBusy(false); }
  }

  return <Screen includeTopInset>
    <View style={styles.top}>
      <View><Text style={styles.eyebrow}>{kind === 'supplier' ? 'SUPPLIER WORKSPACE' : 'RETAILER WORKSPACE'}</Text><Text style={styles.title}>{business?.name}</Text></View>
      <Text accessibilityRole="button" onPress={openSettings} style={styles.settings}>Edit profile</Text>
    </View>
    <View style={styles.layout}>
      <AppCard style={styles.card}>
        <Text style={styles.heading}>{kind === 'supplier' ? 'Sell and bill' : 'Orders and bills'}</Text>
        <Text style={styles.body}>{kind === 'supplier' ? 'Manage products, retailer prices, orders and invoices.' : 'View confirmed orders, invoices and payment status from linked suppliers.'}</Text>
        <View style={styles.actions}>
          {openProducts ? <View style={styles.action}><AppButton title="Products" onPress={openProducts} /></View> : null}
          {openContacts ? <View style={styles.action}><AppButton title="Retailers" onPress={openContacts} /></View> : null}
          <View style={styles.action}><AppButton title={kind === 'supplier' ? 'Orders & billing' : 'My bills'} onPress={openOrders} /></View>
          {openVoice ? <View style={styles.action}><AppButton title="Voice to order" onPress={openVoice} /></View> : null}
        </View>
      </AppCard>
      <AppCard style={styles.card}>
        <Text style={styles.heading}>{kind === 'supplier' ? 'Your retailer network' : 'Your supplier network'}</Text>
        <Text style={styles.body}>{kind === 'supplier' ? 'Ask a retailer for their business ID, then send a connection request.' : 'Share your business ID with a supplier you trust. Approve their request here.'}</Text>
        {kind === 'supplier' ? <>
          <AppField label="Retailer business ID" value={retailerId} onChangeText={setRetailerId} autoCapitalize="none" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          <AppButton title={busy ? 'Sending…' : 'Request connection'} onPress={() => void requestLink()} disabled={busy} />
        </> : <View style={styles.shareCode}><Text style={styles.label}>Your business ID</Text><Text selectable style={styles.code}>{business?.id}</Text></View>}
        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </AppCard>
      <AppCard style={styles.card}>
        <View style={styles.sectionHead}><Text style={styles.heading}>Connections</Text><Text accessibilityRole="button" onPress={() => void loadLinks()} style={styles.refresh}>Refresh</Text></View>
        {loading ? <ActivityIndicator color={colors.primary} /> : links.length === 0 ? <Text style={styles.body}>No connections yet.</Text> : links.map((link) => <View key={link.id} style={styles.linkRow}>
          <Text style={styles.linkName}>{kind === 'supplier' ? link.retailer?.name ?? 'Retailer' : link.supplier?.name ?? 'Supplier'}</Text>
          <Text style={styles.status}>Status: {link.status}</Text>
          {kind === 'retailer' && link.status === 'pending' ? <View style={styles.actions}>
            <View style={styles.action}><AppButton title="Accept" disabled={busy} onPress={() => void respond(link.id, true)} /></View>
            <View style={styles.action}><AppButton title="Decline" variant="secondary" disabled={busy} onPress={() => void respond(link.id, false)} /></View>
          </View> : null}
        </View>)}
      </AppCard>
    </View>
    <View style={styles.footer}>
      <Text accessibilityRole="button" onPress={openConnection} style={styles.refresh}>Check API and database connection</Text>
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' },
  eyebrow: { color: colors.primary, fontSize: type.caption, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: type.title, fontWeight: '800', marginTop: spacing.sm },
  settings: { color: colors.primaryDark, fontSize: type.label, fontWeight: '700', padding: spacing.sm },
  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl },
  card: { flexGrow: 1, flexBasis: 340, flexShrink: 1, minWidth: 0, gap: spacing.lg },
  heading: { color: colors.ink, fontSize: type.heading, fontWeight: '800' },
  body: { color: colors.muted, fontSize: type.body, lineHeight: 24 },
  label: { color: colors.muted, fontSize: type.label, fontWeight: '700' },
  shareCode: { gap: spacing.sm, backgroundColor: colors.primarySoft, padding: spacing.lg, borderRadius: 10 },
  code: { color: colors.primaryDark, fontSize: type.label, fontWeight: '700' },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  refresh: { color: colors.primaryDark, fontSize: type.label, fontWeight: '700', paddingVertical: spacing.sm },
  linkRow: { borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.md, gap: spacing.sm },
  linkName: { color: colors.ink, fontSize: type.body, fontWeight: '700' },
  status: { color: colors.muted, fontSize: type.label },
  actions: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1 },
  footer: { gap: spacing.md },
  message: { color: colors.primaryDark, backgroundColor: colors.primarySoft, padding: spacing.md, borderRadius: 8 },
  error: { color: colors.error, backgroundColor: colors.errorSoft, padding: spacing.md, borderRadius: 8 }
});
