import { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { AppButton } from '../components/AppButton';
import { AppCard } from '../components/AppCard';
import { AppField } from '../components/AppField';
import { Screen } from '../components/Screen';
import { useAuth } from '../auth/AuthProvider';
import { signIn, signInWithGoogle, signUp, sendPasswordReset } from '../services/auth';
import { isSupabaseConfigured, supabase } from '../services/supabase';
import { colors, spacing, type } from '../theme/tokens';

type Mode = 'login' | 'signup' | 'forgot' | 'verify';

export function AuthScreen() {
  const { error: authError } = useAuth();
  const canOpenAuthLinks = Platform.OS === 'web' || Constants.appOwnership !== 'expo';
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try { await task(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Something went wrong'); }
    finally { setBusy(false); }
  }

  async function submit() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) { setError('Enter your email address'); return; }
    if (mode === 'forgot') {
      await run(async () => {
        await sendPasswordReset(normalizedEmail);
        setMessage(canOpenAuthLinks
          ? 'If this address has an account, a reset email is on its way. Open it on this device.'
          : 'If this address has an account, a reset email is on its way. Open it in the web app or an Android development build.');
      });
    } else if (mode === 'signup') {
      if (password.length < 8) { setError('Use at least 8 characters for your password'); return; }
      await run(async () => {
        const result = await signUp(normalizedEmail, password, name);
        if (!result.session) {
          setMode('verify');
          setMessage(canOpenAuthLinks
            ? 'Check your email and open the confirmation link on this device, then sign in.'
            : 'Check your email and open the confirmation link in the web app or an Android development build, then sign in.');
        }
      });
    } else {
      await run(async () => { await signIn(normalizedEmail, password); });
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setMessage(null);
  }

  return (
    <Screen includeTopInset>
      <View style={styles.brand}><View style={styles.mark}><Text style={styles.markText}>B</Text></View><Text style={styles.brandName}>BoloVyapar</Text></View>
      <View style={styles.layout}>
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>YOUR BUSINESS, CONNECTED</Text>
          <Text style={styles.title}>Welcome to a simpler way to trade.</Text>
          <Text style={styles.body}>Sign in to set up your supplier or retailer workspace.</Text>
        </View>
        <AppCard style={styles.form}>
          <Text style={styles.heading}>{mode === 'signup' ? 'Create an account' : mode === 'forgot' ? 'Reset your password' : mode === 'verify' ? 'Check your email' : 'Sign in'}</Text>
          {mode === 'signup' ? <AppField label="Your name" value={name} onChangeText={setName} autoComplete="name" placeholder="Your name" /> : null}
          {mode !== 'verify' ? <AppField label="Email address" value={email} onChangeText={setEmail} autoComplete="email" keyboardType="email-address" placeholder="you@business.com" /> : null}
          {mode === 'login' || mode === 'signup' ? <AppField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="At least 8 characters" /> : null}
          {mode !== 'verify' ? <AppButton title={busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset email' : 'Sign in'} disabled={busy || !isSupabaseConfigured} onPress={() => void submit()} /> : null}
          {mode === 'verify' ? <AppButton title="Resend confirmation email" variant="secondary" disabled={busy} onPress={() => void run(async () => {
            const result = await supabase?.auth.resend({ type: 'signup', email: email.trim().toLowerCase() });
            if (result?.error) throw result.error;
            setMessage('If this address is awaiting verification, a new email is on its way.');
          })} /> : null}
          {mode === 'login' ? <AppButton title="Continue with Google" variant="secondary" disabled={busy || !isSupabaseConfigured} onPress={() => void run(async () => {
            if (Platform.OS !== 'web' && Constants.appOwnership === 'expo') throw new Error('Google sign-in needs a development build. Email sign-in works in Expo Go.');
            await signInWithGoogle();
          })} /> : null}
          {busy ? <ActivityIndicator color={colors.primary} /> : null}
          {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
          {error || authError ? <Text accessibilityRole="alert" style={styles.error}>{error ?? authError}</Text> : null}
          {!isSupabaseConfigured ? <Text style={styles.error}>Add the public Supabase URL and publishable key to mobile/.env.</Text> : null}
          {mode === 'login' ? <>
            <Text onPress={() => switchMode('forgot')} accessibilityRole="button" style={styles.link}>Forgot password?</Text>
            <Text onPress={() => switchMode('signup')} accessibilityRole="button" style={styles.link}>New here? Create an account</Text>
          </> : <Text onPress={() => switchMode('login')} accessibilityRole="button" style={styles.link}>Back to sign in</Text>}
        </AppCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  mark: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  markText: { color: colors.surface, fontSize: 19, fontWeight: '800' },
  brandName: { color: colors.ink, fontSize: 21, fontWeight: '800' },
  layout: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: spacing.xxl, paddingTop: spacing.xl },
  intro: { gap: spacing.md },
  eyebrow: { color: colors.primary, fontSize: type.caption, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: type.title, lineHeight: 38, fontWeight: '800' },
  body: { color: colors.muted, fontSize: type.body, lineHeight: 24 },
  form: { gap: spacing.lg },
  heading: { color: colors.ink, fontSize: type.heading, fontWeight: '800' },
  link: { color: colors.primaryDark, fontSize: type.label, fontWeight: '700', paddingVertical: spacing.sm },
  message: { color: colors.primaryDark, backgroundColor: colors.primarySoft, padding: spacing.md, borderRadius: 8, lineHeight: 21 },
  error: { color: colors.error, backgroundColor: colors.errorSoft, padding: spacing.md, borderRadius: 8, lineHeight: 21 }
});
