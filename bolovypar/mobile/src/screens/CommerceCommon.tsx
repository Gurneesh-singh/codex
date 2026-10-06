import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { colors, spacing, type } from '../theme/tokens';

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const decimal = (integer: number, places: number) => (integer / 10 ** places).toString();
export function parseDecimal(value: string, places: number, label: string): number {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(value.trim())) throw new Error(`Enter a valid ${label} with at most ${places} decimal places`);
  const number = Math.round(Number(value) * 10 ** places);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} is too large`);
  return number;
}
export function Choice({ title, selected, onPress, subtitle }: { title: string; selected?: boolean; onPress: () => void; subtitle?: string }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, selected && styles.selected]}>
    <Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
  </Pressable>;
}
export function Notice({ error, message }: { error?: string | null; message?: string | null }) {
  return <>{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}</>;
}
export function SectionTitle({ children }: { children: ReactNode }) { return <Text style={styles.heading}>{children}</Text>; }
export function Row({ children }: { children: ReactNode }) { return <View style={styles.row}>{children}</View>; }

const styles = StyleSheet.create({
  choice: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, gap: spacing.xs, minWidth: 120 },
  selected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  title: { color: colors.ink, fontSize: type.body, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: type.caption },
  error: { color: colors.error, backgroundColor: colors.errorSoft, padding: spacing.md, borderRadius: 8 },
  message: { color: colors.primaryDark, backgroundColor: colors.primarySoft, padding: spacing.md, borderRadius: 8 },
  heading: { color: colors.ink, fontSize: type.heading, fontWeight: '800' },
  row: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' }
});
