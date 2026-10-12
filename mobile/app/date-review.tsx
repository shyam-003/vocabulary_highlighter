import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  formatStatusLabel,
  getWordsByDate,
  LocalVocabWord,
  updateVocabularyWordDetails,
} from '../src/db/sqlite';
import { colors, radius } from '../src/theme';

const CEFR_COLORS: Record<string, { bg: string; text: string }> = {
  A1: { bg: colors.sageSoft, text: colors.sage },
  A2: { bg: colors.sageSoft, text: colors.sage },
  B1: { bg: colors.primarySoft, text: colors.primary },
  B2: { bg: colors.primarySoft, text: colors.primary },
  C1: { bg: colors.surfaceMuted, text: colors.warning },
  C2: { bg: colors.surfaceMuted, text: colors.warning },
};

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  known: { bg: colors.sageSoft, text: colors.sage, label: 'Known' },
  unknown: { bg: '#F1D5CF', text: colors.error, label: 'Unknown' },
};

export default function DateReviewScreen() {
  const router = useRouter();
  const { date } = useLocalSearchParams<{ date: string }>();

  const [queue, setQueue] = useState<LocalVocabWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [finished, setFinished] = useState(false);

  const [knownCount, setKnownCount] = useState(0);
  const [unknownCount, setUnknownCount] = useState(0);

  const indexRef = useRef(currentIndex);
  const queueRef = useRef(queue);

  useEffect(() => {
    indexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const loadDateWords = async () => {
    if (!date) return;
    setLoading(true);
    setFinished(false);
    setCurrentIndex(0);
    setRevealed(false);
    setKnownCount(0);
    setUnknownCount(0);

    try {
      const words = await getWordsByDate(date);
      setQueue(words);
      if (!words || words.length === 0) {
        setFinished(true);
      }
    } catch (err) {
      console.error('Failed to load date words for review:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDateWords();
  }, [date]);

  const advanceCard = () => {
    setRevealed(false);
    if (indexRef.current + 1 < queueRef.current.length) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setFinished(true);
    }
  };

  const handleMarkKnown = async () => {
    const word = queueRef.current[indexRef.current];
    if (!word) return;

    try {
      await updateVocabularyWordDetails(word.id, { status: 'known' });
    } catch (err) {
      console.error('Error marking known:', err);
    }

    setKnownCount((prev) => prev + 1);
    advanceCard();
  };

  const handleMarkUnknown = async () => {
    const word = queueRef.current[indexRef.current];
    if (!word) return;

    try {
      await updateVocabularyWordDetails(word.id, { status: 'unknown' });
    } catch (err) {
      console.error('Error marking unknown:', err);
    }

    setUnknownCount((prev) => prev + 1);
    advanceCard();
  };

  const handleGoHome = () => {
    try {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)');
      }
    } catch {
      router.replace('/(tabs)');
    }
  };

  const formatDateDisplay = (dateStr?: string) => {
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

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading words…</Text>
      </View>
    );
  }

  if (finished || queue.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <View style={styles.celebrationBadge}>
          <Text style={styles.doneEmoji}>🎉</Text>
        </View>
        <Text style={styles.doneTitle}>Words Reviewed!</Text>
        <Text style={styles.doneSub}>
          You reviewed all {queue.length} vocabulary words from {formatDateDisplay(date)}.
        </Text>

        <View style={styles.summaryBox}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>👍 Marked Known:</Text>
            <Text style={[styles.summaryVal, { color: colors.sage }]}>{knownCount}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>👎 Marked Unknown:</Text>
            <Text style={[styles.summaryVal, { color: colors.error }]}>{unknownCount}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.finishBtn} onPress={handleGoHome} activeOpacity={0.8}>
          <Text style={styles.finishBtnText}>Return to Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentWord = queue[currentIndex];
  const progressPercent = Math.round(((currentIndex + 1) / queue.length) * 100);
  const cefrTheme = currentWord.cefr_level ? CEFR_COLORS[currentWord.cefr_level.toUpperCase()] : null;
  const statusKey = (currentWord.status || 'known').toLowerCase();
  const statusTheme = STATUS_COLORS[statusKey] || STATUS_COLORS.known;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleGoHome} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>✕ Close</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerDateText}>{formatDateDisplay(date)}</Text>
        </View>

        <View style={styles.progressContainer}>
          <Text style={styles.progressText}>
            {currentIndex + 1} of {queue.length}
          </Text>
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
          </View>
        </View>
      </View>

      {/* Main Flashcard Container */}
      <ScrollView
        contentContainerStyle={styles.cardScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.cardWrapper}>
          <TouchableOpacity
            style={[styles.flashcard, revealed && styles.flashcardRevealed]}
            onPress={() => setRevealed((prev) => !prev)}
            activeOpacity={0.9}
          >
            {/* Card Header Tags */}
            <View style={styles.cardHeaderTags}>
              {cefrTheme ? (
                <View style={[styles.cefrTag, { backgroundColor: cefrTheme.bg }]}>
                  <Text style={[styles.cefrTagText, { color: cefrTheme.text }]}>
                    {currentWord.cefr_level?.toUpperCase()}
                  </Text>
                </View>
              ) : (
                <View style={styles.cefrPlaceholder} />
              )}

              <View style={[styles.statusTag, { backgroundColor: statusTheme.bg }]}>
                <Text style={[styles.statusTagText, { color: statusTheme.text }]}>
                  {formatStatusLabel(currentWord.status)}
                </Text>
              </View>
            </View>

            {/* Word Heading */}
            {currentWord.pronunciation ? (
              <Text style={styles.pronunciationText}>{currentWord.pronunciation}</Text>
            ) : null}

            <Text style={styles.wordTitle}>{currentWord.word}</Text>

            {currentWord.part_of_speech ? (
              <Text style={styles.partOfSpeechText}>{currentWord.part_of_speech}</Text>
            ) : null}

            {/* Reveal Meaning Button / Answer Section */}
            {!revealed ? (
              <View style={styles.unrevealedCue}>
                <View style={styles.tapIndicator}>
                  <Text style={styles.tapIndicatorIcon}>👁</Text>
                  <Text style={styles.tapIndicatorText}>Tap anywhere to reveal</Text>
                </View>
              </View>
            ) : (
              <View style={styles.meaningSection}>
                <View style={styles.divider} />

                <View style={styles.meaningBlock}>
                  <Text style={styles.meaningLabel}>DEFINITION</Text>
                  <Text style={styles.meaningValue}>
                    {currentWord.definition || 'No definition saved for this word.'}
                  </Text>
                </View>

                {currentWord.example_sentence ? (
                  <View style={styles.meaningBlock}>
                    <Text style={styles.meaningLabel}>EXAMPLE</Text>
                    <Text style={styles.exampleValue}>“{currentWord.example_sentence}”</Text>
                  </View>
                ) : null}
              </View>
            )}
          </TouchableOpacity>

          {/* Action Buttons Row directly below the Flashcard */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.knownBtn]}
              onPress={handleMarkKnown}
              activeOpacity={0.8}
            >
              <Text style={styles.knownBtnText}>Known</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.unknownBtn]}
              onPress={handleMarkUnknown}
              activeOpacity={0.8}
            >
              <Text style={styles.unknownBtnText}>Keep Unknown</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 54,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerDateText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backBtnText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  progressContainer: {
    alignItems: 'flex-end',
  },
  progressText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 4,
  },
  progressBarTrack: {
    width: 90,
    height: 6,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  cardScrollContent: {
    padding: 20,
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardWrapper: {
    width: '100%',
    maxWidth: 520,
  },
  flashcard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 28,
    minHeight: 340,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  flashcardRevealed: {
    justifyContent: 'flex-start',
  },
  cardHeaderTags: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
  },
  cefrTag: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  cefrTagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  cefrPlaceholder: {
    width: 30,
  },
  statusTag: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  statusTagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  wordTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  pronunciationText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: 'monospace',
  },
  partOfSpeechText: {
    fontSize: 13,
    color: colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: 14,
  },
  unrevealedCue: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  tapIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  tapIndicatorIcon: {
    fontSize: 15,
  },
  tapIndicatorText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  meaningSection: {
    width: '100%',
    marginTop: 8,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: 16,
  },
  meaningBlock: {
    marginBottom: 12,
  },
  meaningLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  meaningValue: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
    fontWeight: '500',
  },
  exampleValue: {
    fontSize: 14,
    color: colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 21,
    marginTop: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    width: '100%',
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unknownBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  unknownBtnText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  knownBtn: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  knownBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  celebrationBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primarySoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  doneEmoji: {
    fontSize: 34,
  },
  doneTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  doneSub: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  summaryBox: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
    gap: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  summaryVal: {
    fontSize: 18,
    fontWeight: '800',
  },
  finishBtn: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  finishBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
