import { Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import { colors, radius, spacing, type } from '../theme/tokens';

type Props = Pick<PressableProps, 'onPress' | 'disabled' | 'accessibilityLabel'> & {
  title: string;
  variant?: 'primary' | 'secondary';
};

export function AppButton({ title, variant = 'primary', disabled, onPress, accessibilityLabel }: Props) {
  const secondary = variant === 'secondary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.base, secondary ? styles.secondary : styles.primary, (pressed || disabled) && styles.dimmed]}
    >
      <Text style={[styles.label, secondary ? styles.secondaryLabel : styles.primaryLabel]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 50, borderRadius: radius.sm, paddingHorizontal: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.primarySoft },
  dimmed: { opacity: 0.65 },
  label: { fontSize: type.body, fontWeight: '700' },
  primaryLabel: { color: colors.surface },
  secondaryLabel: { color: colors.primaryDark }
});
