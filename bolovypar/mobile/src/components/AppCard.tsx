import { StyleSheet, View, type ViewProps } from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';

export function AppCard({ children, style, ...props }: ViewProps) {
  return <View style={[styles.card, style]} {...props}>{children}</View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.xl }
});
