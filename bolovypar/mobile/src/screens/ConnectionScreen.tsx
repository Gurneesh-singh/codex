import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../components/AppButton';
import { AppCard } from '../components/AppCard';
import { AppField } from '../components/AppField';
import { Screen } from '../components/Screen';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';
import { checkApi, checkDatabase, defaultApiUrl, type DatabaseHealth } from '../services/api';
import { isSupabaseConfigured } from '../services/supabase';
import { colors, spacing, type } from '../theme/tokens';

export function ConnectionScreen() {
  const { isMedium, isWide } = useResponsiveLayout();
  const [apiUrl, setApiUrl] = useState(defaultApiUrl);
  const [loading, setLoading] = useState(false);
  const [database, setDatabase] = useState<DatabaseHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiConnected, setApiConnected] = useState(false);

  async function runCheck() {
    setLoading(true);
    setError(null);
    setDatabase(null);
    setApiConnected(false);
    try {
      await checkApi(apiUrl.trim());
      setApiConnected(true);
      setDatabase(await checkDatabase(apiUrl.trim()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={styles.intro}>
        <Text style={styles.title}>Connect your workspace</Text>
        <Text style={styles.body}>Check that this device can reach the API and that the API can reach PostgreSQL.</Text>
      </View>
      <View style={[styles.layout, isWide && styles.layoutWide]}>
        <View style={styles.formColumn}>
          <AppField
            label="API base URL"
            hint="In a browser, use localhost. In an Android emulator, use 10.0.2.2. On a physical phone, use your computer's LAN IP address."
            value={apiUrl}
            onChangeText={setApiUrl}
            autoComplete="url"
            keyboardType="url"
            placeholder="http://192.168.1.10:4000"
          />
          <View style={[styles.action, isMedium && styles.actionMedium]}>
            <AppButton title={loading ? 'Checking…' : 'Run connection check'} onPress={() => void runCheck()} disabled={loading || !apiUrl.trim()} />
          </View>
          {loading ? <ActivityIndicator color={colors.primary} /> : null}
          <Text style={styles.note}>This checks connectivity only. Sign-in and business records are handled in your workspace.</Text>
        </View>
        <AppCard style={[styles.results, isWide && styles.resultsWide]}>
          <Text style={styles.sectionTitle}>Connection results</Text>
          <Text style={styles.result}>API: {apiConnected ? 'Connected' : 'Not checked'}</Text>
          <Text style={styles.result}>Database: {database?.database === 'connected' ? 'Connected' : database?.database === 'not_configured' ? 'Not configured' : database?.database === 'disconnected' ? 'Disconnected' : 'Not checked'}</Text>
          <Text style={styles.result}>Supabase app client: {isSupabaseConfigured ? 'Configured' : 'Not configured'}</Text>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </AppCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: spacing.md },
  title: { color: colors.ink, fontSize: type.heading, fontWeight: '800' },
  body: { color: colors.muted, fontSize: type.body, lineHeight: 24 },
  layout: { gap: spacing.xl },
  layoutWide: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xxxl },
  formColumn: { flex: 1, gap: spacing.xl },
  action: { width: '100%' },
  actionMedium: { maxWidth: 320 },
  results: { gap: spacing.md },
  resultsWide: { flex: 1 },
  sectionTitle: { color: colors.ink, fontSize: type.body, fontWeight: '700' },
  result: { color: colors.muted, fontSize: type.label, lineHeight: 20 },
  error: { color: colors.error, backgroundColor: colors.errorSoft, padding: spacing.md, borderRadius: 8, fontSize: type.label },
  note: { color: colors.muted, fontSize: type.caption, lineHeight: 19 }
});
