// Offline word normalization for vocabulary matching.
// This is lemmatization, not stemming: outputs are dictionary-like base forms.
(function attachNormalizer(global) {
  "use strict";

  const IRREGULAR = {
    am: "be",
    are: "be",
    is: "be",
    was: "be",
    were: "be",
    been: "be",
    being: "be",
    has: "have",
    had: "have",
    does: "do",
    did: "do",
    done: "do",
    went: "go",
    gone: "go",
    saw: "see",
    seen: "see",
    knew: "know",
    known: "know",
    made: "make",
    took: "take",
    taken: "take",
    gave: "give",
    given: "give",
    came: "come",
    ran: "run",
    better: "good",
    best: "good",
    worse: "bad",
    worst: "bad",
    children: "child",
    people: "person",
    men: "man",
    women: "woman",
    mice: "mouse",
    geese: "goose",
    teeth: "tooth",
    feet: "foot",
    oxen: "ox",
  };

  const LEGACY_MIGRATIONS = {
    amus: "amuse",
    amaz: "amaze",
    confus: "confuse",
    surpris: "surprise",
    inspir: "inspire",
    excit: "excite",
    invit: "invite",
    sav: "save",
    hop: "hope",
    smil: "smile",
    star: "stare",
    eras: "erase",
    chas: "chase",
    plac: "place",
    reduc: "reduce",
    produc: "produce",
    organiz: "organize",
    realiz: "realize",
    memoriz: "memorize",
    danc: "dance",
    chang: "change",
    clos: "close",
    decid: "decide",
    describ: "describe",
    driv: "drive",
    giv: "give",
    guid: "guide",
    hav: "have",
    includ: "include",
    leav: "leave",
    lik: "like",
    liv: "live",
    lov: "love",
    mak: "make",
    manag: "manage",
    mov: "move",
    prepar: "prepare",
    provid: "provide",
    rais: "raise",
    receiv: "receive",
    shar: "share",
    tak: "take",
    us: "use",
    writ: "write",
    anxiou: "anxious",
    curiou: "curious",
    famou: "famous",
    seriou: "serious",
    previou: "previous",
    dangerou: "dangerous",
    obviou: "obvious",
    variou: "various",
    numerou: "numerous",
    religiou: "religious",
    focu: "focus",
    statu: "status",
    viru: "virus",
    campu: "campus",
    bonu: "bonus",
    basi: "basis",
    analysi: "analysis",
    crisi: "crisis",
  };

  const DOUBLED_FINAL = /([bcdfghjklmnpqrstvwxyz])\1$/;
  const SIBILANT_PLURAL = /(ches|shes|xes|sses|zzes)$/;
  const CONSONANT_CLUSTER_ENDS = /(ck|ch|sh|ss|ff|ll|zz|ng|nk|rk|rm|rn|rt|rd|rp|rb|lk|lp|mp|nd|nt|ft|lt|pt|sk|sp|ct|th)$/;
  const VOWEL_SUFFIX_ENDS = /(en|er|or|ar|ow|aw|ew|ay|ey|oy)$/;
  const NON_PLURAL_S_ENDS = /(ous|us|is|as)$/;

  const INHERENT_ICS_NOUNS = new Set([
    "physics",
    "mathematics",
    "economics",
    "politics",
    "ethics",
    "statistics",
    "mechanics",
    "robotics",
    "linguistics",
    "electronics",
    "athletics",
    "genetics",
    "optics",
    "acoustics",
    "pediatrics",
    "tactics",
    "dynamics",
    "aerobics",
    "civics",
    "classics",
    "acrobatics",
    "hydraulics",
    "thermodynamics",
    "analytics",
    "logistics",
    "metrics",
    "graphics",
    "cosmetics",
  ]);

  const memo = new Map();

  function stripPunctuation(word) {
    return String(word || "")
      .toLowerCase()
      .replace(/^[^a-z]+|[^a-z]+$/g, "")
      .replace(/[’']/g, "");
  }

  function normalizeWord(word) {
    const clean = stripPunctuation(word);
    if (!clean) return "";
    const migrated = LEGACY_MIGRATIONS[clean] || clean;
    if (memo.has(migrated)) return memo.get(migrated);

    let lemma = IRREGULAR[migrated] || migrated;

    if (lemma === migrated) {
      lemma = lemmatizeRegular(migrated);
    }

    memo.set(clean, lemma);
    memo.set(migrated, lemma);
    return lemma;
  }

  function stepLemmatize(word) {
    if (word.length <= 3) return word;
    if (INHERENT_ICS_NOUNS.has(word)) return word;

    if (word.endsWith("ies") && word.length > 4) {
      return word.slice(0, -3) + "y";
    }

    if (SIBILANT_PLURAL.test(word) && word.length > 4) {
      return word.slice(0, -2);
    }

    if (word.endsWith("s") && !word.endsWith("ss") && !NON_PLURAL_S_ENDS.test(word) && word.length > 3) {
      return word.slice(0, -1);
    }

    if (word.endsWith("ying") && word.length > 5) {
      if (word === "dying") return "die";
      if (word === "tying") return "tie";
      if (word === "lying") return "lie";
      if (word === "vying") return "vie";
    }

    if (word.endsWith("ing") && word.length > 5) {
      const base = word.slice(0, -3);
      if (base.endsWith("y")) return base;
      if (CONSONANT_CLUSTER_ENDS.test(base) || VOWEL_SUFFIX_ENDS.test(base)) return base;
      if (DOUBLED_FINAL.test(base)) return base.slice(0, -1);
      if (/^[a-z]+[bcdfghjklmnpqrstvwxyz]$/.test(base)) return base + "e";
      return base;
    }

    if (word.endsWith("ied") && word.length > 4) {
      return word.slice(0, -3) + "y";
    }

    if (word.endsWith("ed") && word.length > 4) {
      const base = word.slice(0, -2);
      if (base.endsWith("i")) return base.slice(0, -1) + "y";
      if (CONSONANT_CLUSTER_ENDS.test(base) || VOWEL_SUFFIX_ENDS.test(base)) return base;
      if (DOUBLED_FINAL.test(base)) return base.slice(0, -1);
      if (/^[a-z]+[bcdfghjklmnpqrstvwxyz]$/.test(base)) return base + "e";
      return base;
    }

    return word;
  }

  function lemmatizeRegular(word) {
    let current = word;
    for (let i = 0; i < 3; i++) {
      const prev = current;
      current = stepLemmatize(current);
      current = LEGACY_MIGRATIONS[current] || current;
      if (current === prev) break;
    }
    return current;
  }

  function normalizeKnownMap(map) {
    const normalized = {};
    for (const word of Object.keys(map || {})) {
      const clean = stripPunctuation(word);
      const migrated = LEGACY_MIGRATIONS[clean] || clean;
      const lemma = normalizeWord(migrated);
      if (lemma) normalized[lemma] = true;
    }
    return normalized;
  }

  global.VHNormalizer = {
    normalizeWord,
    normalizeKnownMap,
  };
})(globalThis);
