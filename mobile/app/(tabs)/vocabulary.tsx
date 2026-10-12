import { useFocusEffect } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  addNewVocabularyWord,
  formatStatusLabel,
  getAllVocabulary,
  LocalVocabWord,
  updateVocabularyWordDetails,
} from '../../src/db/sqlite';
import { getCefrLevel } from '../../src/services/cefr';
import { lookupWordDetails } from '../../src/services/dictionary';
import { colors, radius } from '../../src/theme';

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

export default function VocabularyScreen() {
  const [words, setWords] = useState<LocalVocabWord[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCefr, setSelectedCefr] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [selectedWord, setSelectedWord] = useState<LocalVocabWord | null>(null);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editDefinition, setEditDefinition] = useState('');
  const [editExample, setEditExample] = useState('');
  const [editCefr, setEditCefr] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<string>('known');

  // Add New Word state
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newDefinition, setNewDefinition] = useState('');
  const [newExample, setNewExample] = useState('');
  const [newPron, setNewPron] = useState('');
  const [newCefr, setNewCefr] = useState<string | null>('A1');
  const [newPos, setNewPos] = useState('');
  const [newStatus, setNewStatus] = useState<string>('known');
  const [isLookingUp, setIsLookingUp] = useState(false);

  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadWords = async () => {
    try {
      const data = await getAllVocabulary({
        search: search.trim(),
        cefr: selectedCefr || undefined,
        status: selectedStatus || undefined,
      });
      setWords(data);
    } catch (err) {
      console.error('Failed to load vocabulary list:', err);
    }
  };

  // Instant local load on focus - ZERO network sync
  useFocusEffect(
    React.useCallback(() => {
      loadWords();
    }, [search, selectedCefr, selectedStatus])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadWords();
    setRefreshing(false);
  };

  useEffect(() => {
    loadWords();
  }, [search, selectedCefr, selectedStatus]);

  const openWordModal = (word: LocalVocabWord) => {
    setSelectedWord(word);
    setIsEditing(false);
    setEditDefinition(word.definition || '');
    setEditExample(word.example_sentence || '');
    setEditCefr(word.cefr_level || null);
    setEditStatus(word.status || 'known');
  };

  const handleSaveEdit = async () => {
    if (!selectedWord) return;
    try {
      await updateVocabularyWordDetails(selectedWord.id, {
        definition: editDefinition.trim(),
        exampleSentence: editExample.trim(),
        cefrLevel: editCefr || null,
        status: editStatus,
      });

      const updated: LocalVocabWord = {
        ...selectedWord,
        definition: editDefinition.trim() || null,
        example_sentence: editExample.trim() || null,
        cefr_level: editCefr || null,
        status: editStatus,
      };

      setSelectedWord(updated);
      setIsEditing(false);
      await loadWords();
    } catch (err) {
      console.error('Failed to save word details:', err);
    }
  };

  const handleToggleWordStatus = async (word: LocalVocabWord) => {
    const nextStatus = (word.status || 'known') === 'known' ? 'unknown' : 'known';
    try {
      await updateVocabularyWordDetails(word.id, { status: nextStatus });
      await loadWords();
      if (selectedWord && selectedWord.id === word.id) {
        setSelectedWord({ ...selectedWord, status: nextStatus });
      }
    } catch (err) {
      console.error('Failed to toggle status:', err);
    }
  };

  const handleLookupNewWord = async () => {
    const term = newWord.trim();
    if (!term) return;
    setIsLookingUp(true);
    const autoCefr = getCefrLevel(term);
    setNewCefr(autoCefr);

    try {
      const res = await lookupWordDetails(term);
      if (res.definition) {
        setNewDefinition(res.definition);
        if (res.exampleSentence) setNewExample(res.exampleSentence);
        if (res.partOfSpeech) setNewPos(res.partOfSpeech);
        if (res.pronunciation) setNewPron(res.pronunciation);
      } else {
        const msg = `No definition found for "${term}". You can type one manually below.`;
        if (Platform.OS === 'web') {
          alert(msg);
        } else {
          Alert.alert('Lookup', msg);
        }
      }
    } catch (err) {
      console.error('Dictionary lookup error:', err);
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleSaveNewWord = async () => {
    if (!newWord.trim()) return;
    try {
      await addNewVocabularyWord({
        word: newWord.trim(),
        definition: newDefinition.trim() || undefined,
        exampleSentence: newExample.trim() || undefined,
        partOfSpeech: newPos || undefined,
        pronunciation: newPron.trim() || undefined,
        cefrLevel: newCefr,
        status: newStatus,
      });

      setAddModalVisible(false);
      setNewWord('');
      setNewDefinition('');
      setNewExample('');
      setNewPron('');
      setNewCefr('A1');
      setNewPos('');
      setNewStatus('known');
      await loadWords();
    } catch (err) {
      console.error('Failed to add new word:', err);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Vocabulary</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.addWordHeaderBtn}
            onPress={() => setAddModalVisible(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.addWordHeaderBtnText}>+ Add Word</Text>
          </TouchableOpacity>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{words.length} words</Text>
          </View>
        </View>
      </View>

      {/* Search Input */}
      <View style={[styles.searchBox, isSearchFocused && styles.searchBoxFocused]}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search word or lemma…"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          onFocus={() => setIsSearchFocused(true)}
          onBlur={() => setIsSearchFocused(false)}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')} style={styles.clearBtn}>
            <Text style={styles.clearIcon}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* CEFR Level Filter Pills */}
      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
          <TouchableOpacity
            style={[styles.filterPill, !selectedCefr && styles.filterPillActive]}
            onPress={() => setSelectedCefr('')}
          >
            <Text style={[styles.filterPillText, !selectedCefr && styles.filterPillTextActive]}>All CEFR</Text>
          </TouchableOpacity>
          {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((lvl) => (
            <TouchableOpacity
              key={lvl}
              style={[styles.filterPill, selectedCefr === lvl && styles.filterPillActive]}
              onPress={() => setSelectedCefr(selectedCefr === lvl ? '' : lvl)}
            >
              <Text style={[styles.filterPillText, selectedCefr === lvl && styles.filterPillTextActive]}>{lvl}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Status Filter Pills */}
      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
          <TouchableOpacity
            style={[styles.filterPill, !selectedStatus && styles.filterPillActive]}
            onPress={() => setSelectedStatus('')}
          >
            <Text style={[styles.filterPillText, !selectedStatus && styles.filterPillTextActive]}>All Statuses</Text>
          </TouchableOpacity>
          {[
            { id: 'known', label: 'Known' },
            { id: 'unknown', label: 'Unknown' },
          ].map((st) => (
            <TouchableOpacity
              key={st.id}
              style={[styles.filterPill, selectedStatus === st.id && styles.filterPillActive]}
              onPress={() => setSelectedStatus(selectedStatus === st.id ? '' : st.id)}
            >
              <Text style={[styles.filterPillText, selectedStatus === st.id && styles.filterPillTextActive]}>{st.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Word List */}
      <FlatList
        data={words}
        keyExtractor={(item: LocalVocabWord, idx: number) => item.id || `word_${item.normalized_word}_${idx}`}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        initialNumToRender={15}
        maxToRenderPerBatch={15}
        windowSize={7}
        removeClippedSubviews={Platform.OS !== 'web'}
        renderItem={({ item }: { item: LocalVocabWord }) => {
          const cefrStyle = item.cefr_level ? CEFR_COLORS[item.cefr_level] : null;
          const statusKey = (item.status || 'known').toLowerCase();
          const statusStyle = STATUS_COLORS[statusKey] || STATUS_COLORS.known;

          return (
            <TouchableOpacity style={styles.wordCard} onPress={() => openWordModal(item)} activeOpacity={0.7}>
              <View style={styles.wordHeader}>
                <View style={styles.wordTitleRow}>
                  <Text style={styles.wordTitle}>{item.word}</Text>
                  {item.pronunciation ? <Text style={styles.pronText}>{item.pronunciation}</Text> : null}
                  {item.part_of_speech ? <Text style={styles.posText}>({item.part_of_speech})</Text> : null}
                </View>
                {cefrStyle ? (
                  <View style={[styles.cefrTag, { backgroundColor: cefrStyle.bg }]}>
                    <Text style={[styles.cefrTagText, { color: cefrStyle.text }]}>{item.cefr_level}</Text>
                  </View>
                ) : (
                  <View style={styles.cefrMissingTag}>
                    <Text style={styles.cefrMissingText}>Set CEFR</Text>
                  </View>
                )}
              </View>

              {item.definition ? (
                <Text style={styles.defPreview} numberOfLines={2}>
                  {item.definition}
                </Text>
              ) : (
                <Text style={styles.noDefText}>Tap to add definition & CEFR level</Text>
              )}

              <View style={styles.cardFooter}>
                <TouchableOpacity
                  style={[styles.statusTag, { backgroundColor: statusStyle.bg }]}
                  onPress={() => handleToggleWordStatus(item)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.statusTagText, { color: statusStyle.text }]}>
                    {formatStatusLabel(item.status)}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.actionHintText}>View / Edit →</Text>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>🔍</Text>
            <Text style={styles.emptyTitle}>No matching vocabulary found</Text>
            <Text style={styles.emptySubtitle}>Try clearing filters or search terms.</Text>
          </View>
        }
      />

      {/* Add New Word Modal */}
      {addModalVisible && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setAddModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>+ Add New Word</Text>
                <TouchableOpacity onPress={() => setAddModalVisible(false)} style={styles.closeHeaderBtn}>
                  <Text style={styles.closeHeaderBtnText}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalBody}>
                <View style={styles.editContainer}>
                  <Text style={styles.inputLabel}>WORD / LEMMA *</Text>
                  <View style={styles.wordInputRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder="Type a new word (e.g. resilience)…"
                      placeholderTextColor="#94a3b8"
                      value={newWord}
                      onChangeText={(t) => {
                        setNewWord(t);
                        if (t.trim()) setNewCefr(getCefrLevel(t.trim()));
                      }}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={styles.lookupBtn}
                      onPress={handleLookupNewWord}
                      disabled={isLookingUp || !newWord.trim()}
                    >
                      <Text style={styles.lookupBtnText}>{isLookingUp ? '…' : '⚡ Lookup'}</Text>
                    </TouchableOpacity>
                  </View>

                  {newPron ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.inputLabel}>PRONUNCIATION:</Text>
                      <Text style={styles.pronText}>{newPron}</Text>
                    </View>
                  ) : null}

                  <Text style={styles.inputLabel}>CEFR LEVEL</Text>
                  <View style={styles.cefrPickerRow}>
                    {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((lvl) => (
                      <TouchableOpacity
                        key={lvl}
                        style={[
                          styles.cefrPickerPill,
                          newCefr === lvl && styles.cefrPickerPillActive,
                        ]}
                        onPress={() => setNewCefr(newCefr === lvl ? null : lvl)}
                      >
                        <Text
                          style={[
                            styles.cefrPickerText,
                            newCefr === lvl && styles.cefrPickerTextActive,
                          ]}
                        >
                          {lvl}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.inputLabel}>STATUS</Text>
                  <View style={styles.cefrPickerRow}>
                    {[
                      { id: 'known', label: 'Known' },
                      { id: 'unknown', label: 'Unknown' },
                    ].map((st) => (
                      <TouchableOpacity
                        key={st.id}
                        style={[
                          styles.cefrPickerPill,
                          newStatus === st.id && styles.cefrPickerPillActive,
                        ]}
                        onPress={() => setNewStatus(st.id)}
                      >
                        <Text
                          style={[
                            styles.cefrPickerText,
                            newStatus === st.id && styles.cefrPickerTextActive,
                          ]}
                        >
                          {st.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.inputLabel}>DEFINITION / MEANING</Text>
                  <TextInput
                    style={styles.textArea}
                    multiline
                    numberOfLines={3}
                    placeholder="Enter definition or tap ⚡ Lookup…"
                    placeholderTextColor="#94a3b8"
                    value={newDefinition}
                    onChangeText={setNewDefinition}
                  />

                  <Text style={styles.inputLabel}>EXAMPLE SENTENCE</Text>
                  <TextInput
                    style={styles.textArea}
                    multiline
                    numberOfLines={2}
                    placeholder="Enter example sentence…"
                    placeholderTextColor="#94a3b8"
                    value={newExample}
                    onChangeText={setNewExample}
                  />

                  <TouchableOpacity
                    style={[styles.saveEditBtn, !newWord.trim() && styles.disabledBtn]}
                    onPress={handleSaveNewWord}
                    disabled={!newWord.trim()}
                  >
                    <Text style={styles.saveEditBtnText}>Add to My Vocabulary ✓</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>

              <TouchableOpacity style={styles.closeBtn} onPress={() => setAddModalVisible(false)}>
                <Text style={styles.closeBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Word Detail / Edit Modal */}
      {selectedWord && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setSelectedWord(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Text style={styles.modalTitle}>{selectedWord.word}</Text>
                    {selectedWord.pronunciation ? (
                      <Text style={styles.modalPronText}>{selectedWord.pronunciation}</Text>
                    ) : null}
                  </View>
                  {selectedWord.part_of_speech ? (
                    <Text style={styles.modalPosText}>Part of Speech: {selectedWord.part_of_speech}</Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  style={styles.editToggleBtn}
                  onPress={() => setIsEditing(!isEditing)}
                >
                  <Text style={styles.editToggleText}>{isEditing ? 'Cancel Edit' : '✏️ Edit'}</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalBody}>
                {isEditing ? (
                  /* Edit Mode Inputs */
                  <View style={styles.editContainer}>
                    <Text style={styles.inputLabel}>CEFR LEVEL</Text>
                    <View style={styles.cefrPickerRow}>
                      {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((lvl) => (
                        <TouchableOpacity
                          key={lvl}
                          style={[
                            styles.cefrPickerPill,
                            editCefr === lvl && styles.cefrPickerPillActive,
                          ]}
                          onPress={() => setEditCefr(editCefr === lvl ? null : lvl)}
                        >
                          <Text
                            style={[
                              styles.cefrPickerText,
                              editCefr === lvl && styles.cefrPickerTextActive,
                            ]}
                          >
                            {lvl}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <Text style={styles.inputLabel}>STATUS</Text>
                    <View style={styles.cefrPickerRow}>
                      {[
                        { id: 'known', label: 'Known' },
                        { id: 'unknown', label: 'Unknown' },
                      ].map((st) => (
                        <TouchableOpacity
                          key={st.id}
                          style={[
                            styles.cefrPickerPill,
                            editStatus === st.id && styles.cefrPickerPillActive,
                          ]}
                          onPress={() => setEditStatus(st.id)}
                        >
                          <Text
                            style={[
                              styles.cefrPickerText,
                              editStatus === st.id && styles.cefrPickerTextActive,
                            ]}
                          >
                            {st.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <Text style={styles.inputLabel}>DEFINITION / MEANING</Text>
                    <TextInput
                      style={styles.textArea}
                      multiline
                      numberOfLines={3}
                      placeholder="Type definition or meaning…"
                      placeholderTextColor="#94a3b8"
                      value={editDefinition}
                      onChangeText={setEditDefinition}
                    />

                    <Text style={styles.inputLabel}>EXAMPLE SENTENCE</Text>
                    <TextInput
                      style={styles.textArea}
                      multiline
                      numberOfLines={2}
                      placeholder="Type example sentence…"
                      placeholderTextColor="#94a3b8"
                      value={editExample}
                      onChangeText={setEditExample}
                    />

                    <TouchableOpacity style={styles.saveEditBtn} onPress={handleSaveEdit}>
                      <Text style={styles.saveEditBtnText}>Save Changes ✓</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  /* Display Mode */
                  <View>
                    <View style={styles.detailBlock}>
                      <Text style={styles.detailHeading}>DEFINITION</Text>
                      <Text style={styles.detailValue}>
                        {selectedWord.definition || 'No definition available. Tap ✏️ Edit to add.'}
                      </Text>
                    </View>

                    {selectedWord.example_sentence ? (
                      <View style={styles.detailBlock}>
                        <Text style={styles.detailHeading}>EXAMPLE SENTENCE</Text>
                        <Text style={styles.detailValueItalic}>"{selectedWord.example_sentence}"</Text>
                      </View>
                    ) : null}

                    {/* CEFR Level & Status Side-by-Side */}
                    <View style={styles.sideBySideRow}>
                      <View style={[styles.detailBlock, styles.sideBySideBlock]}>
                        <Text style={styles.detailHeading}>CEFR LEVEL</Text>
                        <Text style={styles.detailValue}>
                          {selectedWord.cefr_level ? selectedWord.cefr_level : 'Unclassified'}
                        </Text>
                      </View>

                      <View style={[styles.detailBlock, styles.sideBySideBlock]}>
                        <Text style={styles.detailHeading}>STATUS</Text>
                        <Text style={styles.detailValue}>
                          {formatStatusLabel(selectedWord.status)}
                        </Text>
                      </View>
                    </View>
                  </View>
                )}
              </ScrollView>

              {/* Modal Actions */}
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.closeBtn} onPress={() => setSelectedWord(null)}>
                  <Text style={styles.closeBtnText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 50, paddingBottom: 14 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, letterSpacing: 0 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addWordHeaderBtn: { backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md },
  addWordHeaderBtnText: { color: colors.surface, fontWeight: '700', fontSize: 12 },
  countBadge: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.md },
  countText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1.5,
    marginHorizontal: 20,
    marginBottom: 14,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    height: 48,
  },
  searchBoxFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  searchIcon: {
    fontSize: 15,
    marginRight: 10,
    color: colors.textMuted,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
    paddingVertical: 0,
    ...Platform.select({
      web: {
        outlineStyle: 'none' as any,
      },
    }),
  },
  clearBtn: {
    padding: 6,
  },
  clearIcon: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  filterRow: { marginBottom: 8, height: 36 },
  filterContent: { paddingHorizontal: 20, gap: 8, alignItems: 'center' },
  filterPill: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 14, height: 32, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },
  filterPillActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  filterPillText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  filterPillTextActive: { color: colors.primary, fontWeight: '700' },
  listContent: { padding: 20, paddingTop: 8, paddingBottom: 40 },
  wordCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: 17, marginBottom: 12 },
  wordHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  wordTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flex: 1, flexWrap: 'wrap' },
  wordTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  pronText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  modalPronText: { fontSize: 16, color: colors.primary, fontWeight: '600' },
  posText: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
  cefrTag: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.sm },
  cefrTagText: { fontWeight: '700', fontSize: 12 },
  cefrMissingTag: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm },
  cefrMissingText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  defPreview: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  noDefText: { color: colors.primary, fontSize: 13, fontStyle: 'italic' },
  cardFooter: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm },
  statusTagText: { fontSize: 11, fontWeight: '700' },
  actionHintText: { fontSize: 11, color: colors.primary, fontWeight: '700' },
  emptyContainer: { padding: 40, alignItems: 'center', justifyContent: 'center' },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  emptySubtitle: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(30, 27, 24, 0.62)', justifyContent: 'center', padding: 20, alignItems: 'center' },
  modalContent: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.xl, padding: 24, width: '100%', maxWidth: 500, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  modalTitle: { fontSize: 28, fontWeight: '700', color: colors.text },
  modalPosText: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic', marginTop: 2 },
  closeHeaderBtn: { padding: 4 },
  closeHeaderBtnText: { color: colors.textMuted, fontSize: 18 },
  editToggleBtn: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md },
  editToggleText: { fontSize: 12, color: colors.primary, fontWeight: '700' },
  modalBody: { marginBottom: 20 },
  detailBlock: { marginBottom: 14, backgroundColor: colors.surfaceMuted, padding: 14, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1 },
  sideBySideRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  sideBySideBlock: { flex: 1, marginBottom: 0 },
  detailHeading: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 6 },
  detailValue: { fontSize: 14, color: colors.text, lineHeight: 22 },
  detailValueItalic: { fontSize: 14, color: colors.textMuted, fontStyle: 'italic', lineHeight: 22 },
  editContainer: { gap: 10 },
  inputLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginTop: 6 },
  wordInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, color: colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  lookupBtn: { backgroundColor: colors.surfaceMuted, borderColor: colors.primary, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },
  lookupBtnText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  cefrPickerRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 6 },
  cefrPickerPill: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm },
  cefrPickerPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  cefrPickerText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  cefrPickerTextActive: { color: colors.surface },
  textArea: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, color: colors.text, padding: 12, fontSize: 14, textAlignVertical: 'top' },
  saveEditBtn: { backgroundColor: colors.primary, paddingVertical: 13, borderRadius: radius.md, alignItems: 'center', marginTop: 10 },
  disabledBtn: { backgroundColor: colors.surfaceMuted },
  saveEditBtnText: { color: colors.surface, fontWeight: '700', fontSize: 14 },
  modalActions: { gap: 10 },
  closeBtn: { backgroundColor: colors.surfaceMuted, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center' },
  closeBtnText: { color: colors.text, fontWeight: '600', fontSize: 14 },
});
