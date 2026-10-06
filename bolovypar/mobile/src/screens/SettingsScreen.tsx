import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useAuth } from '../auth/AuthProvider';
import { AppButton } from '../components/AppButton';
import { AppCard } from '../components/AppCard';
import { AppField } from '../components/AppField';
import { BusinessFields, type BusinessFormValues } from '../components/BusinessFields';
import { Screen } from '../components/Screen';
import { accountApi } from '../services/accountApi';
import { signInWithGoogle, signOut } from '../services/auth';
import { colors, spacing, type } from '../theme/tokens';

export function SettingsScreen() {
  const { session, account, refreshAccount } = useAuth();
  const business = account?.business;
  const [name, setName] = useState(account?.profile?.display_name ?? '');
  const [contactPhone, setContactPhone] = useState(account?.profile?.phone ?? '');
  const [values, setValues] = useState<BusinessFormValues>({
    name: business?.name ?? '', phone: business?.phone ?? '',
    address_line1: business?.address_line1 ?? '', address_line2: business?.address_line2 ?? '',
    city: business?.city ?? '', state: business?.state ?? '',
    postal_code: business?.postal_code ?? '', gstin: business?.gstin ?? ''
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setField(field: keyof BusinessFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    if (!session) return;
    if (!values.name.trim()) { setError('Business name is required'); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await accountApi.updateProfile(session.access_token, { display_name: name.trim() || null, phone: contactPhone.trim() || null });
      await accountApi.updateBusiness(session.access_token, {
        name: values.name.trim(), phone: values.phone.trim() || null,
        address_line1: values.address_line1.trim() || null, address_line2: values.address_line2.trim() || null,
        city: values.city.trim() || null, state: values.state.trim() || null,
        postal_code: values.postal_code.trim() || null, gstin: values.gstin.trim().toUpperCase() || null
      });
      setMessage('Profile saved.');
      refreshAccount();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save profile'); }
    finally { setBusy(false); }
  }

  async function linkGoogle() {
    setBusy(true); setError(null); setMessage(null);
    try {
      if (Platform.OS !== 'web' && Constants.appOwnership === 'expo') throw new Error('Google linking needs a development build.');
      await signInWithGoogle(true);
      setMessage('Google account linked.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not link Google account'); }
    finally { setBusy(false); }
  }

  return <Screen>
    <View style={styles.container}>
      <Text style={styles.title}>Business profile</Text>
      <Text style={styles.body}>Signed in as {account?.user.email}. Your {business?.kind} role and ownership are permanent.</Text>
      <AppCard style={styles.card}>
        <Text style={styles.heading}>Contact details</Text>
        <AppField label="Your name" value={name} onChangeText={setName} autoComplete="name" />
        <AppField label="Your phone" value={contactPhone} onChangeText={setContactPhone} keyboardType="phone-pad" />
        <Text style={styles.heading}>Business details</Text>
        <BusinessFields values={values} setField={setField} />
        <AppButton title={busy ? 'Saving…' : 'Save changes'} disabled={busy} onPress={() => void save()} />
        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </AppCard>
      <AppCard style={styles.card}>
        <Text style={styles.heading}>Account</Text>
        <Text style={styles.body}>A verified Google account with the same email is linked automatically by Supabase. Manual linking requires enabling it in Supabase Auth.</Text>
        <AppButton title="Link a Google account" variant="secondary" disabled={busy} onPress={() => void linkGoogle()} />
        <AppButton title="Sign out" variant="secondary" disabled={busy} onPress={() => void signOut()} />
      </AppCard>
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: spacing.xl },
  title: { color: colors.ink, fontSize: type.title, fontWeight: '800' },
  body: { color: colors.muted, fontSize: type.body, lineHeight: 24 },
  card: { gap: spacing.lg },
  heading: { color: colors.ink, fontSize: type.heading, fontWeight: '800' },
  message: { color: colors.primaryDark, backgroundColor: colors.primarySoft, padding: spacing.md, borderRadius: 8 },
  error: { color: colors.error, backgroundColor: colors.errorSoft, padding: spacing.md, borderRadius: 8 }
});
