export interface DictionaryResult {
  definition: string | null;
  exampleSentence: string | null;
  partOfSpeech: string | null;
  pronunciation: string | null;
}

export function fallbackExample(word: string, pos: string | null): string | null {
  const w = word.toLowerCase();
  // switch (pos) {
  //   case 'verb':
  //     return `She likes to ${w} whenever she gets the chance.`;
  //   case 'adjective':
  //     return `It was a very ${w} moment for everyone there.`;
  //   case 'adverb':
  //     return `He finished the task ${w} and moved on.`;
  //   default:
  //     return `The word "${w}" came up several times in the conversation.`;
  // }
  return null;
}

export async function lookupWordDetails(word: string): Promise<DictionaryResult> {
  const term = word.trim().toLowerCase();
  if (!term) {
    return {
      definition: null,
      exampleSentence: null,
      partOfSpeech: null,
      pronunciation: null,
    };
  }

  let def: string | null = null;
  let pos: string | null = null;
  let pron: string | null = null;

  // Single fetch from Datamuse (fast & lightweight for definition, POS, and IPA pronunciation)
  try {
    const res = await fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(term)}&md=dpr&ipa=1&max=1`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const item = data[0];
        const tags = Array.isArray(item.tags) ? item.tags : [];
        const ipaTag = tags.find((t: string) => typeof t === 'string' && t.startsWith('ipa_pron:'));
        const pronTag = tags.find((t: string) => typeof t === 'string' && t.startsWith('pron:'));
        if (ipaTag) pron = `/${ipaTag.replace('ipa_pron:', '').trim()}/`;
        else if (pronTag) pron = `/${pronTag.replace('pron:', '').trim()}/`;

        if (item.defs && item.defs.length > 0) {
          const firstDefRow = item.defs[0];
          const parts = firstDefRow.split('\t');
          const posCode = parts[0];
          const rawDef = parts[1] || firstDefRow;
          const posMap: Record<string, string> = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb' };
          pos = posMap[posCode] || posCode || null;
          def = rawDef.charAt(0).toUpperCase() + rawDef.slice(1).trim();
        }
      }
    }
  } catch (err) {
    console.warn('Datamuse API error:', err);
  }

  return {
    definition: def,
    exampleSentence: null,
    partOfSpeech: pos,
    pronunciation: pron,
  };
}
