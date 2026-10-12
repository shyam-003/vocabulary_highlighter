import { useFocusEffect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MonthlyCalendar } from '../../src/components/MonthlyCalendar';
import {
  CachedStats,
  getHeatmapActivityData,
  getVocabularyStats,
  getWordsByDate,
  LocalVocabWord,
  updateVocabularyWordDetails
} from '../../src/db/sqlite';
import { checkDailyAutoSync, getMobileSyncStatus, MobileSyncStatus } from '../../src/services/sync';
import { colors, radius } from '../../src/theme';

const CEFR_COLORS: Record<string, { bg: string; text: string }> = {
  A1: { bg: colors.sageSoft, text: colors.sage },
  A2: { bg: colors.sageSoft, text: colors.sage },
  B1: { bg: colors.primarySoft, text: colors.primary },
  B2: { bg: colors.primarySoft, text: colors.primary },
  C1: { bg: colors.surfaceMuted, text: colors.warning },
  C2: { bg: colors.surfaceMuted, text: colors.warning },
};

const getGreeting = (): string => {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good Morning ☀️';
  if (hr < 18) return 'Good Afternoon 🌤️';
  return 'Good Evening 🌙';
};

const calculateStreak = (activity: Record<string, number>): number => {
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${day}`;
    if (activity[dateStr] && activity[dateStr] > 0) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
};

export default function HomeScreen() {
  const router = useRouter();
  const [stats, setStats] = useState<CachedStats>({
    totalCount: 0,
    knownCount: 0,
    unknownCount: 0,
    cefrDist: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
  });
  const [activityData, setActivityData] = useState<Record<string, number>>({});
  const [syncStatus, setSyncStatus] = useState<MobileSyncStatus>({
    status: 'synced',
    pendingCount: 0,
    lastSyncedAt: null,
  });
  const [refreshing, setRefreshing] = useState(false);

  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dateWords, setDateWords] = useState<LocalVocabWord[]>([]);
  const [dateModalVisible, setDateModalVisible] = useState(false);

  const greeting = getGreeting();
  const streakCount = calculateStreak(activityData);

  const loadData = async () => {
    try {
      const s = await getVocabularyStats();
      setStats(s);
      const act = await getHeatmapActivityData();
      setActivityData(act);
      const sync = await getMobileSyncStatus();
      setSyncStatus(sync);
    } catch (err) {
      console.error('Error loading home data:', err);
    }
  };

  // Instant local data loading on focus - ZERO network calls
  useFocusEffect(
    React.useCallback(() => {
      loadData();
    }, [])
  );

  // Check 24-hour daily auto-sync once on app start
  useEffect(() => {
    checkDailyAutoSync()
      .then((res) => {
        if (res?.ok && !res?.skipped) {
          loadData();
        }
      })
      .catch(() => { });
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const formatDateTitle = (dateStr: string | null) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      return new Date(y, m, d).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    return dateStr;
  };

  const handleToggleWordStatus = async (word: LocalVocabWord) => {
    const isCurrentlyUnknown = (word.status || 'known').toLowerCase() === 'unknown';
    const nextStatus = isCurrentlyUnknown ? 'known' : 'unknown';
    try {
      await updateVocabularyWordDetails(word.id, { status: nextStatus });
      setDateWords((prev) =>
        prev.map((w) => (w.id === word.id ? { ...w, status: nextStatus } : w))
      );
      loadData();
    } catch (err) {
      console.error('Failed to toggle status:', err);
    }
  };

  const handleSelectDate = async (dateStr: string, count?: number) => {
    if (count !== undefined && count <= 0) return;
    try {
      const words = await getWordsByDate(dateStr);
      if (!words || words.length === 0) return;
      setSelectedDate(dateStr);
      setDateWords(words);
      setDateModalVisible(true);
    } catch (err) {
      console.error('Failed to load words for date:', err);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Top Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.appTitle}>VocabHighlighter</Text>
          <Text style={styles.subtitle}>{greeting}</Text>
        </View>

        {/* Top-Right Header Actions */}
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.headerIconBtn, showCalendar && styles.headerIconBtnActive]}
            onPress={() => setShowCalendar(!showCalendar)}
            activeOpacity={0.7}
          >
            <Text style={styles.headerIconText}>📅</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.headerSyncBtn,
              syncStatus.pendingCount > 0 && styles.headerSyncBtnPending,
              syncStatus.status === 'error' && styles.headerSyncBtnError,
            ]}
            onPress={() => router.push('/settings')}
            activeOpacity={0.7}
          >
            {syncStatus.status === 'unauthenticated' ? (
              <Text style={styles.headerSyncText}>☁️ Offline</Text>
            ) : syncStatus.status === 'error' ? (
              <Text style={styles.headerSyncText}>⚠️ Error</Text>
            ) : syncStatus.pendingCount > 0 ? (
              <Text style={styles.headerSyncTextPending}>↻ {syncStatus.pendingCount}</Text>
            ) : (
              <Text style={styles.headerSyncTextSynced}>✓ Synced</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Vocabulary Overview Hero Card */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <Text style={styles.heroLabel}>VOCABULARY OVERVIEW</Text>
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>
              {(Number(stats.unknownCount) || 0) > 0 ? `${stats.unknownCount} Unknown` : 'All Known ✓'}
            </Text>
          </View>
        </View>

        <Text style={styles.heroNumber}>{(Number(stats.totalCount) || 0).toLocaleString()}</Text>
        <Text style={styles.heroSubtext}>Total vocabulary words saved across devices</Text>

        <TouchableOpacity
          style={styles.heroButton}
          onPress={() => router.push('/vocabulary')}
          activeOpacity={0.8}
        >
          <Text style={styles.heroButtonText}>Browse Dictionary →</Text>
        </TouchableOpacity>
      </View>

      {/* Interactive Monthly Calendar (Toggled via Header Button) */}
      {showCalendar && (
        <MonthlyCalendar activityData={activityData} onSelectDate={handleSelectDate} />
      )}

      {/* Overview Stats Row */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statBoxLabel}>Known Words</Text>
          <Text style={styles.statBoxNumber}>
            {(isNaN(Number(stats.knownCount)) ? Number(stats.totalCount) || 0 : Number(stats.knownCount)).toLocaleString()}
          </Text>
          <Text style={styles.statBoxSub}>Active vocabulary</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statBoxLabel}>Learning Streak</Text>
          <Text style={styles.statBoxNumber}>{streakCount} Days 🔥</Text>
          <Text style={styles.statBoxSub}>Daily consistency</Text>
        </View>
      </View>

      {/* CEFR Level Distribution */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>CEFR Classification</Text>
          <Text style={styles.sectionSub}>A1 – C2 Level Coverage</Text>
        </View>
        <View style={styles.cefrGrid}>
          {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((level) => {
            const count = Number(stats?.cefrDist?.[level]) || 0;
            const theme = CEFR_COLORS[level] || CEFR_COLORS.B1;
            return (
              <View
                key={level}
                style={[
                  styles.cefrCard,
                  { backgroundColor: theme.bg, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.cefrLevel, { color: theme.text }]}>{level}</Text>
                <Text style={styles.cefrCount}>{count}</Text>
                <Text style={styles.cefrLabel}>words</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Date Words Modal Dialog */}
      <Modal
        visible={dateModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDateModalVisible(false)}
      >
        <View style={styles.sheetOverlay}>
          <TouchableOpacity
            style={styles.sheetBackdropDismiss}
            activeOpacity={1}
            onPress={() => setDateModalVisible(false)}
          />

          <View style={styles.dialogCard}>
            {/* Header */}
            <View style={styles.dialogHeader}>
              <View style={styles.dialogHeaderTopRow}>
                <Text style={styles.dialogDateTitle}>📅 {selectedDate}</Text>

                <View style={styles.dialogHeaderActions}>
                  <TouchableOpacity
                    style={styles.dialogReviewBtn}
                    onPress={() => {
                      setDateModalVisible(false);
                      router.push({ pathname: '/date-review', params: { date: selectedDate! } });
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.dialogReviewBtnText}>Review 🧠</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.dialogCloseIconBtn}
                    onPress={() => setDateModalVisible(false)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.dialogCloseIcon}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.dialogSubtitle}>
                {dateWords.filter((w) => (w.status || 'known').toLowerCase() === 'known').length}{' '}
                {dateWords.filter((w) => (w.status || 'known').toLowerCase() === 'known').length === 1 ? 'word' : 'words'} learned,{' '}
                {dateWords.filter((w) => (w.status || 'known').toLowerCase() === 'unknown').length}{' '}
                {dateWords.filter((w) => (w.status || 'known').toLowerCase() === 'unknown').length === 1 ? 'word' : 'words'} unknown
              </Text>
            </View>

            {/* Words List */}
            <FlatList
              data={dateWords}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.dialogListContent}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isItemUnknown = (item.status || 'known').toLowerCase() === 'unknown';
                const cefrLvl = item.cefr_level ? item.cefr_level.toUpperCase() : null;

                return (
                  <View style={styles.wordCard}>
                    {/* Top Row: Word, Pronunciation, POS, CEFR */}
                    <View style={styles.wordCardHeader}>
                      <View style={styles.wordTitleContainer}>
                        <Text style={styles.cardWordName}>{item.word} </Text>
                        {item.pronunciation ? (
                          <Text style={styles.cardPronText}>{item.pronunciation} </Text>
                        ) : null}
                        {item.part_of_speech ? (
                          <Text style={styles.cardPosText}>({item.part_of_speech})</Text>
                        ) : null}
                      </View>

                      {cefrLvl ? (
                        cefrLvl === 'B1' || cefrLvl === 'B2' ? (
                          <View style={styles.cefrBadgePill}>
                            <Text style={styles.cefrBadgePillText}>{cefrLvl}</Text>
                          </View>
                        ) : (
                          <Text style={styles.cefrPlainLabel}>{cefrLvl}</Text>
                        )
                      ) : null}
                    </View>

                    {/* Definition */}
                    {item.definition ? (
                      <Text style={styles.cardDefinition}>{item.definition}</Text>
                    ) : null}

                    {/* Example sentence if present */}
                    {item.example_sentence ? (
                      <Text style={styles.cardExampleSentence}>“{item.example_sentence}”</Text>
                    ) : null}

                    {/* Status Pill (Known / Unknown) */}
                    <TouchableOpacity
                      style={[
                        styles.cardStatusPill,
                        isItemUnknown ? styles.cardStatusPillUnknown : styles.cardStatusPillKnown,
                      ]}
                      onPress={() => handleToggleWordStatus(item)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.cardStatusPillText,
                          isItemUnknown ? styles.cardStatusPillUnknownText : styles.cardStatusPillKnownText,
                        ]}
                      >
                        {isItemUnknown ? 'Unknown' : 'Known'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
            />

            {/* Bottom Full-width Close Button */}
            <TouchableOpacity
              style={styles.dialogBottomCloseBtn}
              onPress={() => setDateModalVisible(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.dialogBottomCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: 20,
    paddingTop: 54,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  appTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
    fontWeight: '500',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconBtn: {
    width: 54,
    height: 38,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  headerIconBtnActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  headerIconText: {
    fontSize: 16,
  },
  headerSyncBtn: {
    height: 38,
    minWidth: 54,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  headerSyncBtnPending: {
    backgroundColor: colors.primarySoft,
    borderColor: '#E8B69E',
  },
  headerSyncBtnError: {
    backgroundColor: '#FDE8E7',
    borderColor: colors.error,
  },
  headerSyncText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.textMuted,
  },
  headerSyncTextPending: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.primary,
  },
  headerSyncTextSynced: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.sage,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: 22,
    marginBottom: 20,
    shadowColor: '#292622',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  heroHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  heroLabel: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  statusPill: {
    backgroundColor: colors.sageSoft,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusPillText: {
    color: colors.sage,
    fontSize: 11,
    fontWeight: '700',
  },
  heroNumber: {
    color: colors.text,
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: -1,
  },
  heroSubtext: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
    marginBottom: 16,
  },
  heroButton: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroButtonText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statBoxLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 6,
  },
  statBoxNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  statBoxSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  sectionSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  cefrGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  cefrCard: {
    width: '31%',
    flexGrow: 1,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  cefrLevel: {
    fontSize: 16,
    fontWeight: '800',
  },
  cefrCount: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    marginVertical: 2,
  },
  cefrLabel: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '500',
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  sheetBackdropDismiss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 540,
    maxHeight: '84%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
  },
  dialogHeader: {
    marginBottom: 14,
  },
  dialogHeaderTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dialogDateTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#292622',
    letterSpacing: -0.3,
  },
  dialogHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dialogReviewBtn: {
    backgroundColor: '#C96F4A',
    paddingVertical: 6.5,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  dialogReviewBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  dialogCloseIconBtn: {
    padding: 6,
  },
  dialogCloseIcon: {
    fontSize: 18,
    color: '#81786D',
    fontWeight: '600',
  },
  dialogSubtitle: {
    fontSize: 13,
    color: '#C96F4A',
    fontWeight: '600',
    marginTop: 4,
  },
  dialogListContent: {
    paddingBottom: 12,
  },
  wordCard: {
    backgroundColor: '#F3EDE6',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 12,
  },
  wordCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  wordTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 4,
    marginRight: 8,
  },
  cardWordName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#292622',
  },
  cardPronText: {
    fontSize: 13.5,
    color: '#C96F4A',
    fontFamily: 'monospace',
  },
  cardPosText: {
    fontSize: 12.5,
    color: '#81786D',
    fontStyle: 'italic',
  },
  cefrPlainLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#C49455',
  },
  cefrBadgePill: {
    backgroundColor: '#F4D5C3',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  cefrBadgePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#C96F4A',
  },
  cardDefinition: {
    fontSize: 13.5,
    color: '#555550',
    lineHeight: 19,
    marginVertical: 4,
  },
  cardExampleSentence: {
    fontSize: 12.5,
    color: '#81786D',
    fontStyle: 'italic',
    lineHeight: 18,
    marginBottom: 4,
  },
  cardStatusPill: {
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  cardStatusPillText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  cardStatusPillKnown: {
    backgroundColor: '#DCE5D8',
  },
  cardStatusPillKnownText: {
    color: '#5E7B54',
    fontSize: 11.5,
    fontWeight: '700',
  },
  cardStatusPillUnknown: {
    backgroundColor: '#F1D5CF',
  },
  cardStatusPillUnknownText: {
    color: '#B85C54',
    fontSize: 11.5,
    fontWeight: '700',
  },
  dialogBottomCloseBtn: {
    backgroundColor: '#EFEAE2',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  dialogBottomCloseBtnText: {
    color: '#292622',
    fontWeight: '700',
    fontSize: 15,
  },
});



