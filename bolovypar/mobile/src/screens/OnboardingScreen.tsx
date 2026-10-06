import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { AppButton } from '../components/AppButton';
import { AppCard } from '../components/AppCard';
import { AppField } from '../components/AppField';
import { BusinessFields, emptyBusinessForm, type BusinessFormValues } from '../components/BusinessFields';
import { Screen } from '../components/Screen';
import { accountApi, type BusinessKind } from '../services/accountApi';
import { signOut } from '../services/auth';
import { colors, spacing, type } from '../theme/tokens';

export function OnboardingScreen() {
  const { session, account, refreshAccount } = useAuth();
  const [kind, setKind] = useState<BusinessKind>('supplier');
  const [personName, setPersonName] = useState(account?.profile?.display_name ?? '');
  const [values, setValues] = useState<BusinessFormValues>(emptyBusinessForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(field: keyof BusinessFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    if (!session) return;
    if (!values.name.trim()) { setError('Enter your business name'); return; }
    if (values.postal_code && !/^[1-9][0-9]{5}$/.test(values.postal_code.trim())) { setError('Enter a valid 6-digit PIN code'); return; }
    setBusy(true);
    setError(null);
    try {
      await accountApi.updateProfile(session.access_token, { display_name: personName.trim() || null });
      await accountApi.onboard(session.access_token, {
        kind, name: values.name.trim(), phone: values.phone.trim() || null,
        address_line1: values.address_line1.trim() || null,
        address_line2: values.address_line2.trim() || null,
        city: values.city.trim() || null, state: values.state.trim() || null,
        postal_code: values.postal_code.trim() || null, gstin: values.gstin.trim().toUpperCase() || null
      });
      refreshAccount();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create business');
    } finally { setBusy(false); }
  }

  return <Screen includeTopInset>
    <View style={styles.container}>
      <Text style={styles.eyebrow}>STEP 1 OF 1</Text>
      <Text style={styles.title}>Set up your business</Text>
      <Text style={styles.body}>Choose the role this account will use. Your role cannot be changed after setup.</Text>
      <AppCard style={styles.card}>
        <Text style={styles.label}>I am a…</Text>
        <View style={styles.roles}>
          <View style={styles.role}><AppButton title="Supplier" variant={kind === 'supplier' ? 'primary' : 'secondary'} onPress={() => setKind('supplier')} /></View>
          <View style={styles.role}><AppButton title="Retailer" variant={kind === 'retailer' ? 'primary' : 'secondary'} onPress={() => setKind('retailer')} /></View>
        </View>
        <Text style={styles.hint}>{kind === 'supplier' ? 'Manage retailer relationships and future orders.' : 'Connect with suppliers and view future bills.'}</Text>
        <AppField label="Your name" value={personName} onChangeText={setPersonName} autoComplete="name" placeholder="Contact person" />
        <BusinessFields values={values} setField={setField} />
        <AppButton title={busy ? 'Saving…' : 'Create business profile'} disabled={busy || !account?.user.email_verified} onPress={() => void save()} />
        {!account?.user.email_verified ? <>
          <Text style={styles.hint}>Verify your email before completing onboarding.</Text>
          <AppButton title="I verified my email" variant="secondary" onPress={refreshAccount} />
        </> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </AppCard>
      <Text accessibilityRole="button" onPress={() => void signOut()} style={styles.link}>Sign out</Text>
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 600, alignSelf: 'center', gap: spacing.lg },
  eyebrow: { color: colors.primary, fontSize: type.caption, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: type.title, fontWeight: '800' },
  body: { color: colors.muted, fontSize: type.body, lineHeight: 24 },
  card: { gap: spacing.lg },
  label: { color: colors.ink, fontSize: type.label, fontWeight: '700' },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  role: { flexGrow: 1, flexBasis: 145, flexShrink: 1, minWidth: 0 },
  hint: { color: colors.muted, fontSize: type.label, lineHeight: 21 },
  error: { color: colors.error, backgroundColor: colors.errorSoft, padding: spacing.md, borderRadius: 8 },
  link: { color: colors.primaryDark, fontWeight: '700', paddingVertical: spacing.md, alignSelf: 'center' }
});
