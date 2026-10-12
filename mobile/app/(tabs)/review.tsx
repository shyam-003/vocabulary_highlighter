import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  getUnknownVocabulary,
  LocalVocabWord,
  updateVocabularyWordDetails,
} from '../../src/db/sqlite';
import { colors, radius } from '../../src/theme';

const CEFR_COLORS: Record<string, { bg: string; text: string }> = {
  A1: { bg: colors.sageSoft, text: colors.sage },
  A2: { bg: colors.sageSoft, text: colors.sage },
  B1: { bg: colors.primarySoft, text: colors.primary },
  B2: { bg: colors.primarySoft, text: colors.primary },
  C1: { bg: colors.surfaceMuted, text: colors.warning },
  C2: { bg: colors.surfaceMuted, text: colors.warning },
};

/**
 * Selects a random word from the pool.
 * Prevents immediate consecutive repetition if pool has at least 2 words.
 */
function pickNextWord(pool: LocalVocabWord[], excludeId?: string | null): LocalVocabWord | null {
  if (!pool || pool.length === 0) return null;
  if (pool.length === 1) return pool[0];

  const candidates = excludeId ? pool.filter((w) => w.id !== excludeId) : pool;
  const targetList = candidates.length > 0 ? candidates : pool;
  const randomIndex = Math.floor(Math.random() * targetList.length);
  return targetList[randomIndex];
}

export default function ReviewScreen() {
  const router = useRouter();

  // In-memory pool of unknown words
  const [unknownWords, setUnknownWords] = useState<LocalVocabWord[]>([]);
  const [currentWord, setCurrentWord] = useState<LocalVocabWord | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [loading, setLoading] = useState(true);

  // Keep track of the last displayed word ID to avoid immediate repeats
  const previousWordIdRef = useRef<string | null>(null);

  /**
   * One-time database query when entering/focusing the Review tab.
   * Loads only words with status === 'unknown'.
   */
  const loadUnknownWords = useCallback(async () => {
    try {
      setLoading(true);
      const words = await getUnknownVocabulary();
      setUnknownWords(words);

      if (words.length > 0) {
        const next = pickNextWord(words, null);
        setCurrentWord(next);
        previousWordIdRef.current = next?.id || null;
      } else {
        setCurrentWord(null);
        previousWordIdRef.current = null;
      }
      setIsRevealed(false);
    } catch (err) {
      console.error('Failed to load unknown vocabulary for review:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadUnknownWords();
    }, [loadUnknownWords])
  );

  /**
   * "Keep Unknown" / "Next" action:
   * - Retains word in the in-memory pool
   * - Selects another random word from unknownWords (no DB query)
   * - Avoids immediate repetition if pool >= 2
   */
  const handleKeepUnknown = () => {
    if (!currentWord || unknownWords.length === 0) return;

    previousWordIdRef.current = currentWord.id;
    const next = pickNextWord(unknownWords, currentWord.id);
    setCurrentWord(next);
    setIsRevealed(false);
  };

  /**
   * "Mark as Known" action:
   * - Removes current word from in-memory pool immediately
   * - Updates counter immediately
   * - Picks another random word immediately
   * - Persists status change to SQLite asynchronously with error rollback
   */
  const handleMarkAsKnown = () => {
    if (!currentWord) return;

    const wordToMark = currentWord;
    const remainingPool = unknownWords.filter((w) => w.id !== wordToMark.id);

    // Immediate optimistic state updates
    setUnknownWords(remainingPool);
    setIsRevealed(false);

    if (remainingPool.length > 0) {
      const next = pickNextWord(remainingPool, null);
      setCurrentWord(next);
      previousWordIdRef.current = next?.id || null;
    } else {
      setCurrentWord(null);
      previousWordIdRef.current = null;
    }

    // Async database update
    updateVocabularyWordDetails(wordToMark.id, { status: 'known' }).catch((err) => {
      console.error('Failed to update word status in SQLite:', err);
      // Rollback memory pool on error to keep state consistent
      setUnknownWords((prev) => {
        if (prev.some((w) => w.id === wordToMark.id)) return prev;
        return [wordToMark, ...prev];
      });
    });
  };

  // Loading State
  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading unknown words…</Text>
      </View>
    );
  }

  // Completion or Empty State
  if (unknownWords.length === 0 || !currentWord) {
    return (
      <View style={styles.centerContainer}>
        <View style={styles.celebrationBadge}>
          <Text style={styles.celebrationEmoji}>🎉</Text>
        </View>
        <Text style={styles.doneTitle}>All caught up!</Text>
        <Text style={styles.doneSubtitle}>
          You have no unknown words left to review.
        </Text>

        <TouchableOpacity
          style={styles.primaryActionButton}
          onPress={() => router.push('/(tabs)/vocabulary')}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryActionButtonText}>Explore Vocabulary</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryActionButton}
          onPress={() => router.push('/(tabs)')}
          activeOpacity={0.8}
        >
          <Text style={styles.secondaryActionButtonText}>Return Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const cefrStyle = currentWord.cefr_level ? CEFR_COLORS[currentWord.cefr_level.toUpperCase()] : null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Review</Text>
          <Text style={styles.headerSubtitle}>Continuous random practice</Text>
        </View>
        <View style={styles.counterBadge}>
          <Text style={styles.counterText}>
            {unknownWords.length.toLocaleString()} unknown
          </Text>
        </View>
      </View>

      {/* Center Flashcard Area */}
      <View style={styles.cardContainer}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.reviewWrapper}>
            <TouchableOpacity
              style={[styles.card, isRevealed && styles.cardRevealed]}
              activeOpacity={0.9}
              onPress={() => setIsRevealed((prev) => !prev)}
            >
              {/* Card Front / Top Section */}
              <View style={styles.cardTop}>
                {currentWord.pronunciation ? (
                  <Text style={styles.pronText}>{currentWord.pronunciation}</Text>
                ) : null}

                <Text style={styles.wordTitle}>{currentWord.word}</Text>

                <View style={styles.metaRow}>
                  {currentWord.cefr_level ? (
                    <View
                      style={[
                        styles.cefrBadge,
                        { backgroundColor: cefrStyle?.bg || colors.surfaceMuted },
                      ]}
                    >
                      <Text
                        style={[
                          styles.cefrBadgeText,
                          { color: cefrStyle?.text || colors.textMuted },
                        ]}
                      >
                        {currentWord.cefr_level.toUpperCase()}
                      </Text>
                    </View>
                  ) : null}

                  {currentWord.part_of_speech ? (
                    <Text style={styles.posText}>{currentWord.part_of_speech}</Text>
                  ) : null}
                </View>
              </View>

              {/* Card Front: Tap to Reveal Cue */}
              {!isRevealed ? (
                <View style={styles.unrevealedCue}>
                  <View style={styles.tapIndicator}>
                    <Text style={styles.tapIndicatorIcon}>👁</Text>
                    <Text style={styles.tapIndicatorText}>Tap anywhere to reveal</Text>
                  </View>
                </View>
              ) : (
                /* Card Revealed: Definition & Example */
                <View style={styles.revealedContent}>
                  <View style={styles.divider} />

                  <View style={styles.meaningSection}>
                    <Text style={styles.sectionHeading}>DEFINITION</Text>
                    <Text style={styles.definitionText}>
                      {currentWord.definition || 'No definition available.'}
                    </Text>
                  </View>

                  {currentWord.example_sentence ? (
                    <View style={styles.meaningSection}>
                      <Text style={styles.sectionHeading}>EXAMPLE</Text>
                      <Text style={styles.exampleText}>
                        “{currentWord.example_sentence}”
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>

      {/* Action Buttons Pushed to Bottom (Known on Left, Next on Right) */}
      <View style={styles.bottomBar}>
        <View style={styles.bottomBarInner}>
          <TouchableOpacity
            style={[styles.actionButton, styles.knownButton]}
            onPress={handleMarkAsKnown}
            activeOpacity={0.8}
          >
            <Text style={styles.knownButtonText}>Known</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.nextButton]}
            onPress={handleKeepUnknown}
            activeOpacity={0.8}
          >
            <Text style={styles.nextButtonText}>Next</Text>
          </TouchableOpacity>
        </View>
      </View>
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
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
    padding: 24,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 15,
    marginTop: 12,
    fontWeight: '500',
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
  celebrationEmoji: {
    fontSize: 34,
  },
  doneTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  doneSubtitle: {
    fontSize: 15,
    color: colors.textMuted,
    marginBottom: 28,
    textAlign: 'center',
    lineHeight: 22,
  },
  primaryActionButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: radius.md,
    width: '100%',
    maxWidth: 280,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryActionButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryActionButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: radius.md,
    width: '100%',
    maxWidth: 280,
    alignItems: 'center',
  },
  secondaryActionButtonText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 15,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  counterBadge: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  counterText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  cardContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewWrapper: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 28,
    minHeight: 320,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  cardRevealed: {
    justifyContent: 'flex-start',
  },
  cardTop: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  pronText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  wordTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cefrBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  cefrBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  posText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '600',
    textTransform: 'lowercase',
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
  revealedContent: {
    width: '100%',
    marginTop: 10,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 16,
    width: '100%',
  },
  meaningSection: {
    marginBottom: 16,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 6,
  },
  definitionText: {
    fontSize: 16,
    color: colors.text,
    lineHeight: 24,
    fontWeight: '500',
  },
  exampleText: {
    fontSize: 15,
    color: colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 22,
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    alignItems: 'center',
    width: '100%',
  },
  bottomBarInner: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    maxWidth: 480,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knownButton: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  knownButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  nextButton: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  nextButtonText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 15,
  },
});
