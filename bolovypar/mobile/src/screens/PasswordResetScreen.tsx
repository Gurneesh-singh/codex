import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { AppButton } from '../components/AppButton';
import { AppCard } from '../components/AppCard';
import { AppField } from '../components/AppField';
import { Screen } from '../components/Screen';
import { updatePassword } from '../services/auth';
import { colors, spacing, type } from '../theme/tokens';

export function PasswordResetScreen() {
  const { setRecoveryMode } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (password.length < 8) { setError('Use at least 8 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setBusy(true);
    setError(null);
    try { await updatePassword(password); setRecoveryMode(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update password'); }
    finally { setBusy(false); }
  }

  return <Screen includeTopInset><View style={styles.container}><AppCard style={styles.card}>
    <Text style={styles.title}>Choose a new password</Text>
    <Text style={styles.body}>Your reset link has been verified. Set a password to continue.</Text>
    <AppField label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
    <AppField label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" />
    <AppButton title={busy ? 'Saving…' : 'Save password'} disabled={busy} onPress={() => void save()} />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </AppCard></View></Screen>;
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingTop: spacing.xxl },
  card: { gap: spacing.lg },
  title: { color: colors.ink, fontSize: type.heading, fontWeight: '800' },
  body: { color: colors.muted, fontSize: type.body, lineHeight: 24 },
  error: { color: colors.error, backgroundColor: colors.errorSoft, padding: spacing.md, borderRadius: 8 }
});
