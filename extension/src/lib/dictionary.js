// Word lookup using Datamuse API (fast, reliable, high availability).
// Returns a normalized shape that popup and storage can render directly.
// Runs in the background service worker.

import { normalizeWord } from "./normalizer.js";

const DATAMUSE_API = "https://api.datamuse.com/words";
const REQUEST_TIMEOUT = 3000;

export function fallbackExample(word, pos) {
  return null;
}

async function fetchDatamuseMeta(word) {
  try {
    const res = await fetch(`${DATAMUSE_API}?sp=${encodeURIComponent(word.toLowerCase())}&md=dpr&ipa=1&max=1`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return data[0];
    }
  } catch (e) {
    // Network / timeout error
    return null;
  }
  return null;
}

// Returns { word, pos, pronunciation, definition, example, exampleIsFallback, found } on a
// hit. On a miss, notFound: true is set.
export async function lookupWord(word) {
  const clean = String(word || "").trim();
  if (!clean) return { word, found: false, notFound: true };

  try {
    let res = await fetchDatamuseMeta(clean);
    const lemma = normalizeWord(clean);

    // If initial query didn't have defs, try its base lemma
    if ((!res || !res.defs || res.defs.length === 0) && lemma && lemma !== clean.toLowerCase()) {
      const lemmaMeta = await fetchDatamuseMeta(lemma);
      if (lemmaMeta?.defs?.length > 0) {
        res = lemmaMeta;
      }
    }

    if (res && res.defs && res.defs.length > 0) {
      const defRow = res.defs[0];
      const parts = defRow.split("\t");
      const posCode = parts[0];
      const rawDef = (parts[1] || defRow).trim();
      const posMap = { n: "noun", v: "verb", adj: "adjective", adv: "adverb", u: "unknown" };
      const pos = posMap[posCode] || posCode || "";
      const capitalizedDef = rawDef.charAt(0).toUpperCase() + rawDef.slice(1);
      const ex = fallbackExample(clean, pos);

      // Extract IPA pronunciation from tags
      const tags = Array.isArray(res.tags) ? res.tags : [];
      const ipaTag = tags.find((t) => typeof t === "string" && t.startsWith("ipa_pron:"));
      const pronTag = tags.find((t) => typeof t === "string" && t.startsWith("pron:"));
      let pronunciation = null;
      if (ipaTag) {
        pronunciation = `/${ipaTag.replace("ipa_pron:", "").trim()}/`;
      } else if (pronTag) {
        pronunciation = `/${pronTag.replace("pron:", "").trim()}/`;
      }

      return {
        word: clean,
        pos,
        pronunciation,
        definition: capitalizedDef,
        example: null,
        exampleIsFallback: false,
        found: true,
      };
    }

    return { word: clean, found: false, notFound: true };
  } catch (e) {
    return { word: clean, found: false, transient: true, error: String(e) };
  }
}
