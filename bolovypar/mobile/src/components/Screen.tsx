import type { ReactNode } from 'react';
import type { Ref } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';
import { colors, spacing } from '../theme/tokens';

export function Screen({ children, includeTopInset = false, scrollViewRef }: {
  children: ReactNode; includeTopInset?: boolean; scrollViewRef?: Ref<ScrollView>
}) {
  const { isCompact, isWide, isShort } = useResponsiveLayout();

  return (
    <SafeAreaView style={styles.safe} edges={includeTopInset ? ['top', 'bottom'] : ['bottom']}>
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.content, { paddingHorizontal: isCompact ? spacing.lg : isWide ? spacing.xxxl : spacing.xl, paddingTop: isShort ? spacing.lg : isWide ? spacing.xxxl : spacing.xxl }]}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: 1240, paddingBottom: spacing.xxxl, gap: spacing.xxl }
});
