import React, { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getDB, recalculateAndCacheStats } from '../../src/db/sqlite';
import {
  clearStoredConfig,
  getMobileSyncStatus,
  getStoredConfig,
  runMobileSync,
  saveStoredConfig,
} from '../../src/services/sync';
import { DEFAULT_SUPABASE_ANON_KEY, DEFAULT_SUPABASE_URL, getSupabaseClient } from '../../src/services/supabase';
import { colors, radius } from '../../src/theme';

export default function SettingsScreen() {
  const [supabaseUrl, setSupabaseUrl] = useState(DEFAULT_SUPABASE_URL || '');
  const [supabaseKey, setSupabaseKey] = useState(DEFAULT_SUPABASE_ANON_KEY || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<any>(null);
  const [syncStatus, setSyncStatus] = useState<any>({});
  const [loading, setLoading] = useState(false);

  const loadStatus = async () => {
    const s = await getMobileSyncStatus();
    setSyncStatus(s);
  };

  const formatSyncTime = (isoString: string | null): string => {
    if (!isoString) return 'Not yet synced';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return 'Not yet synced';
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    } catch {
      return 'Not yet synced';
    }
  };

  useEffect(() => {
    let subscription: any = null;

    const initFormAndAuth = async () => {
      try {
        const cfg = await getStoredConfig();
        const activeUrl = cfg.url || DEFAULT_SUPABASE_URL || '';
        const activeKey = cfg.key || DEFAULT_SUPABASE_ANON_KEY || '';
        if (activeUrl) setSupabaseUrl(activeUrl);
        if (activeKey) setSupabaseKey(activeKey);

        if (activeUrl && activeKey) {
          const client = getSupabaseClient(activeUrl, activeKey);
          if (client) {
            const { data } = await client.auth.getSession();
            setUser(data.session?.user || null);

            const { data: subData } = client.auth.onAuthStateChange((_event: any, session: any) => {
              setUser(session?.user || null);
              loadStatus();
            });
            subscription = subData?.subscription;
          }
        }
        await loadStatus();
      } catch (err) {
        console.error('Error initializing settings auth:', err);
      }
    };

    initFormAndAuth();

    return () => {
      if (subscription?.unsubscribe) {
        subscription.unsubscribe();
      }
    };
  }, []);

  const handleLogin = async () => {
    const effectiveUrl = (supabaseUrl || DEFAULT_SUPABASE_URL).trim();
    const effectiveKey = (supabaseKey || DEFAULT_SUPABASE_ANON_KEY).trim();

    if (!effectiveUrl || !effectiveKey) {
      Alert.alert(
        'Configuration Missing',
        'Supabase URL & Public Anon Key are missing in mobile/.env.'
      );
      return;
    }
    if (!email || !password) {
      Alert.alert('Credentials Missing', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const client = getSupabaseClient(effectiveUrl, effectiveKey);
      if (!client) {
        Alert.alert('Error', 'Invalid Supabase URL or Anon Key configuration.');
        setLoading(false);
        return;
      }
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;

      await saveStoredConfig(effectiveUrl, effectiveKey);
      setUser(data.user);
      setPassword('');

      // Perform immediate full sync upon login
      const res = await runMobileSync(effectiveUrl, effectiveKey, { fullSync: true });
      await loadStatus();

      if (res.ok) {
        Alert.alert('Success', `Logged in & synchronized ${res.pulledCount ?? 0} words from Supabase!`);
      } else {
        Alert.alert('Logged In', `Logged in successfully. Sync status: ${res.error || 'Ready'}`);
      }
    } catch (err: any) {
      Alert.alert('Login Failed', err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    const effectiveUrl = (supabaseUrl || DEFAULT_SUPABASE_URL).trim();
    const effectiveKey = (supabaseKey || DEFAULT_SUPABASE_ANON_KEY).trim();
    const client = getSupabaseClient(effectiveUrl, effectiveKey);
    if (client) {
      await client.auth.signOut();
    }
    await clearStoredConfig();
    setUser(null);
    setSupabaseUrl(DEFAULT_SUPABASE_URL || '');
    setSupabaseKey(DEFAULT_SUPABASE_ANON_KEY || '');
    setEmail('');
    setPassword('');
    await loadStatus();
    Alert.alert('Logged Out', 'Successfully logged out.');
  };

  const handleSyncNow = async () => {
    setLoading(true);
    try {
      const res = await runMobileSync(supabaseUrl, supabaseKey, { fullSync: true, force: true });
      if (res.ok) {
        Alert.alert('Sync Completed', `Synchronized successfully! Pulled ${res.pulledCount ?? 0} words from cloud.`);
      } else if (res.reason === 'not_authenticated' || res.reason === 'unauthenticated' || res.reason === 'missing_config') {
        Alert.alert('Cloud Account Required', 'Please connect to Supabase and log in below.');
      } else {
        Alert.alert('Sync Status', `Sync failed: ${res.error || 'Unknown error'}`);
      }
      await loadStatus();
    } catch (err: any) {
      Alert.alert('Sync Error', err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClearAll = async () => {
    const doClear = async () => {
      setLoading(true);
      try {
        // Clear local storage & SQLite tables only (does NOT touch Supabase database)
        if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
          localStorage.removeItem('vh_web_vocab');
          localStorage.removeItem('vh_web_queue');
        }
        const db = await getDB();
        await db.runAsync(`DELETE FROM vocabulary_words`);
        await db.runAsync(`DELETE FROM sync_queue`);
        await recalculateAndCacheStats(db);

        const msg = 'All local words cleared from app storage (cloud database remains untouched).';
        if (Platform.OS === 'web') {
          alert(msg);
        } else {
          Alert.alert('Cleared', msg);
        }
        await loadStatus();
      } catch (err: any) {
        if (Platform.OS === 'web') {
          alert(`Error: ${err.message || String(err)}`);
        } else {
          Alert.alert('Error', err.message || String(err));
        }
      } finally {
        setLoading(false);
      }
    };

    if (Platform.OS === 'web') {
      const confirmClear = window.confirm('Are you sure you want to clear local words from this app? (Your cloud database will NOT be deleted).');
      if (confirmClear) {
        await doClear();
      }
    } else {
      Alert.alert(
        'Clear Local Words',
        'Are you sure you want to clear local words from this app? (Your cloud database will NOT be deleted).',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Clear Local Words', style: 'destructive', onPress: doClear },
        ]
      );
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.headerTitle}>Settings & Sync</Text>

      {/* Cloud Sync Status Box */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Cloud Synchronization</Text>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Sync Status:</Text>
          <Text
            style={[
              styles.statusValue,
              syncStatus.status === 'unauthenticated'
                ? { color: colors.warning }
                : syncStatus.status === 'error'
                ? { color: colors.error }
                : { color: colors.sage },
            ]}
          >
            {syncStatus.status === 'unauthenticated'
              ? 'Login Required'
              : syncStatus.status === 'error'
              ? (syncStatus.error || 'Sync Error')
              : syncStatus.pendingCount > 0
              ? `${syncStatus.pendingCount} pending`
              : 'Up to date'}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Last Synced:</Text>
          <Text style={styles.statusValue}>
            {formatSyncTime(syncStatus.lastSyncedAt)}
          </Text>
        </View>
        {syncStatus.error && syncStatus.status !== 'unauthenticated' ? (
          <Text style={styles.errorBannerText}>{syncStatus.error}</Text>
        ) : null}
        <TouchableOpacity style={styles.syncButton} onPress={handleSyncNow} disabled={loading}>
          <Text style={styles.syncButtonText}>{loading ? 'Syncing…' : 'Sync now (Pull & Push)'}</Text>
        </TouchableOpacity>
      </View>

      {/* Supabase Account Section */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Account & Supabase Auth</Text>
        {user ? (
          <View style={styles.loggedInBox}>
            <View style={styles.profileHeader}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>
                  {(user.email || 'U').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.profileDetails}>
                <View style={styles.connectedBadge}>
                  <Text style={styles.connectedBadgeText}>✓ Connected to cloud</Text>
                </View>
                <Text style={styles.userEmailText}>{user.email}</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutButtonText}>Disconnect / Logout</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <Text style={styles.cardDesc}>
              Sign in with your Supabase account to sync your 7,000+ words and learning states across devices.
            </Text>
            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="user@example.com"
              placeholderTextColor="#64748b"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="#64748b"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <TouchableOpacity style={styles.loginButton} onPress={handleLogin} disabled={loading}>
              <Text style={styles.loginButtonText}>{loading ? 'Signing in & Syncing…' : 'Sign In & Sync Words'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Data Reset Section */}
      <View style={styles.card}>
        <Text style={[styles.cardTitle, { color: colors.error }]}>Local Data Reset</Text>
        <Text style={styles.cardDesc}>Clears all local vocabulary words from this device. (Your Supabase cloud database entries will remain safe).</Text>
        <TouchableOpacity
          style={[styles.exportButton, { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' }]}
          onPress={handleClearAll}
        >
          <Text style={[styles.exportButtonText, { color: colors.error, fontWeight: '700' }]}>Clear Local Words</Text>
        </TouchableOpacity>
      </View>

      {/* App Info */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>VocabHighlighter Mobile v1.0.0</Text>
        <Text style={styles.footerSub}>Offline-first • Instant Local SQLite • Cloud Sync</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 50, paddingBottom: 40 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: 20 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.xl, padding: 20, marginBottom: 18 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 14 },
  cardDesc: { fontSize: 13, color: colors.textMuted, marginBottom: 14, lineHeight: 19 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  statusLabel: { color: colors.textMuted, fontSize: 14 },
  statusValue: { color: colors.sage, fontSize: 14, fontWeight: '700' },
  syncButton: { backgroundColor: colors.primary, paddingVertical: 13, borderRadius: radius.md, alignItems: 'center', marginTop: 10 },
  syncButtonText: { color: colors.surface, fontWeight: '700', fontSize: 14 },
  inputLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderWidth: 1, color: colors.text, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14 },
  loginButton: { backgroundColor: colors.primary, paddingVertical: 13, borderRadius: radius.md, alignItems: 'center', marginTop: 18 },
  loginButtonText: { color: colors.surface, fontWeight: '700', fontSize: 14 },
  loggedInBox: {
    paddingVertical: 4,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 14,
    borderRadius: radius.lg,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.sageSoft,
    borderColor: colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.sage,
    textAlign: 'center',
    lineHeight: Platform.OS === 'web' ? 44 : 22,
  },
  profileDetails: {
    flex: 1,
  },
  connectedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.sageSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
    marginBottom: 4,
  },
  connectedBadgeText: {
    color: colors.sage,
    fontSize: 11,
    fontWeight: '700',
  },
  userEmailText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  logoutButton: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 1,
    paddingVertical: 11,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: colors.error,
    fontWeight: '600',
    fontSize: 13,
  },
  exportButton: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderWidth: 1, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center' },
  exportButtonText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  errorBannerText: { color: colors.error, fontSize: 12, marginTop: 4, marginBottom: 8 },
  footer: { alignItems: 'center', marginTop: 20 },
  footerText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  footerSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
