import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { getDB } from '../src/db/sqlite';
import { colors } from '../src/theme';

export default function RootLayout() {
  useEffect(() => {
    // Initialize local SQLite database on startup
    getDB().catch(console.error);
  }, []);

  return (
    <View style={styles.outerBackground}>
      <StatusBar style="dark" />
      <View style={styles.mobileShell}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerBackground: {
    flex: 1,
    backgroundColor: colors.darkBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mobileShell: {
    flex: 1,
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 560 : undefined,
    backgroundColor: colors.bg,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow: '0 22px 48px rgba(41, 38, 34, 0.24)',
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: colors.darkBorder,
      },
    }),
  },
});
