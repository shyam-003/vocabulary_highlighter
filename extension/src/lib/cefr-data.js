// CEFR Classification Provider Layer
// Provides lexical complexity CEFR classification (A1-C2).

const CEFR_WORD_MAP = {
  // A1 Beginner
  a: 'A1', an: 'A1', the: 'A1', be: 'A1', is: 'A1', are: 'A1', can: 'A1', do: 'A1', go: 'A1',
  have: 'A1', know: 'A1', make: 'A1', see: 'A1', think: 'A1', time: 'A1', person: 'A1',
  year: 'A1', way: 'A1', day: 'A1', thing: 'A1', man: 'A1', world: 'A1', life: 'A1',
  hand: 'A1', part: 'A1', child: 'A1', eye: 'A1', woman: 'A1', place: 'A1', work: 'A1',
  week: 'A1', case: 'A1', point: 'A1', company: 'A1', number: 'A1', group: 'A1', problem: 'A1',
  book: 'A1', water: 'A1', house: 'A1', car: 'A1', food: 'A1', friend: 'A1', school: 'A1',
  about: 'A1', above: 'A1', after: 'A1', again: 'A1', all: 'A1', also: 'A1', always: 'A1',
  and: 'A1', any: 'A1', ask: 'A1', at: 'A1', back: 'A1', bad: 'A1', before: 'A1', best: 'A1',
  better: 'A1', big: 'A1', both: 'A1', but: 'A1', by: 'A1', call: 'A1', came: 'A1', come: 'A1',
  could: 'A1', each: 'A1', find: 'A1', first: 'A1', from: 'A1', get: 'A1', give: 'A1', good: 'A1',
  great: 'A1', had: 'A1', has: 'A1', he: 'A1', help: 'A1', her: 'A1', here: 'A1', him: 'A1',
  his: 'A1', how: 'A1', if: 'A1', in: 'A1', into: 'A1', just: 'A1', kind: 'A1', large: 'A1',
  last: 'A1', like: 'A1', little: 'A1', long: 'A1', look: 'A1', made: 'A1', many: 'A1', may: 'A1',
  me: 'A1', more: 'A1', most: 'A1', much: 'A1', must: 'A1', my: 'A1', name: 'A1', new: 'A1',
  no: 'A1', not: 'A1', now: 'A1', off: 'A1', old: 'A1', on: 'A1', once: 'A1', one: 'A1',
  only: 'A1', or: 'A1', other: 'A1', our: 'A1', out: 'A1', over: 'A1', own: 'A1', said: 'A1',
  same: 'A1', say: 'A1', she: 'A1', should: 'A1', some: 'A1', still: 'A1', such: 'A1', take: 'A1',
  than: 'A1', that: 'A1', their: 'A1', them: 'A1', then: 'A1', there: 'A1', these: 'A1', they: 'A1',
  this: 'A1', those: 'A1', through: 'A1', to: 'A1', too: 'A1', under: 'A1', up: 'A1', use: 'A1',
  very: 'A1', want: 'A1', was: 'A1', we: 'A1', well: 'A1', went: 'A1', were: 'A1', what: 'A1',
  when: 'A1', where: 'A1', which: 'A1', while: 'A1', who: 'A1', will: 'A1', with: 'A1', would: 'A1',
  you: 'A1', your: 'A1', angry: 'A1', happy: 'A1', sad: 'A1', small: 'A1', hungry: 'A1', cold: 'A1',
  hot: 'A1', easy: 'A1', hard: 'A1', fast: 'A1', slow: 'A1', clean: 'A1', dirty: 'A1', young: 'A1',

  // A2 Elementary
  ability: 'A2', accept: 'A2', accident: 'A2', achieve: 'A2', across: 'A2', activity: 'A2',
  actual: 'A2', addition: 'A2', address: 'A2', advance: 'A2', advantage: 'A2', advice: 'A2',
  against: 'A2', agreement: 'A2', airport: 'A2', almost: 'A2', already: 'A2', although: 'A2',
  amount: 'A2', analysis: 'A2', animal: 'A2', answer: 'A2', apartment: 'A2', appear: 'A2',
  application: 'A2', appointment: 'A2', approach: 'A2', appropriate: 'A2', argument: 'A2',

  // B1 Intermediate
  politics: 'B1', politic: 'B1', political: 'B1', resistance: 'B1', resist: 'B1', interview: 'B1',
  candidate: 'B1', campaign: 'B1', election: 'B1', democracy: 'B1', congress: 'B1', parliament: 'B1',
  legislation: 'B1', constitution: 'B1', policy: 'B1', diplomacy: 'B1', treaty: 'B1', alliance: 'B1',
  culture: 'B1', society: 'B1', economy: 'B1', financial: 'B1', market: 'B1', strategy: 'B1',
  authority: 'B1', consensus: 'B1', petition: 'B1', ballot: 'B1', coalition: 'B1', ideology: 'B1',

  // B2 Upper Intermediate
  technology: 'B2', technological: 'B2', algorithm: 'B2', architecture: 'B2', infrastructure: 'B2',
  implementation: 'B2', framework: 'B2', optimization: 'B2', synchronization: 'B2', repository: 'B2',
  integration: 'B2', parameter: 'B2', protocol: 'B2', specification: 'B2', cryptography: 'B2',
  authentication: 'B2', authorization: 'B2', vulnerability: 'B2', concurrency: 'B2', asynchronous: 'B2',

  // C1 Advanced
  ambiguity: 'C1', inherent: 'C1', unprecedented: 'C1', pervasive: 'C1', ubiquitous: 'C1',
  mitigate: 'C1', dichotomy: 'C1', juxtaposition: 'C1', epistemology: 'C1', paradigm: 'C1',
  substantiate: 'C1', disparate: 'C1', tacit: 'C1', nuance: 'C1', fastidious: 'C1',

  // C2 Proficient
  quintessential: 'C2', counterproductive: 'C2', disproportionate: 'C2', extraterrestrial: 'C2',
  anachronistic: 'C2', flabbergasted: 'C2', idiosyncratic: 'C2', obfuscate: 'C2', surreptitious: 'C2',
};

export class CEFRProvider {
  /**
   * Get the CEFR level for a normalized word.
   * @param {string} normalizedWord 
   * @param {string} [partOfSpeech] 
   * @returns {'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'}
   */
  getCefrLevel(normalizedWord, partOfSpeech) {
    if (!normalizedWord) return 'B1';
    const clean = String(normalizedWord).toLowerCase().trim().replace(/[^a-z]/g, '');
    if (!clean) return 'B1';

    // 1. Direct dictionary match
    if (CEFR_WORD_MAP[clean]) {
      return CEFR_WORD_MAP[clean];
    }

    // 2. Stem matching (strip common suffixes -ing, -ed, -s, -ly, -tion, -ment, -ity, -able, -al)
    const stem = clean
      .replace(/(ing|ed|s|ly|tion|ment|ity|able|al|ive|ous|ic|ism|ist)$/, '');

    if (stem && CEFR_WORD_MAP[stem]) {
      return CEFR_WORD_MAP[stem];
    }

    // 3. Fallback Heuristic by Lexical Complexity & Character Length
    const len = clean.length;
    if (len <= 4) return 'A1';
    if (len <= 6) return 'A2';
    if (len <= 8) return 'B1';
    if (len <= 10) return 'B2';
    if (len <= 12) return 'C1';
    return 'C2';
  }
}

export const cefrProvider = new CEFRProvider();

export function getCefrLevel(word, pos) {
  return cefrProvider.getCefrLevel(word, pos);
}
