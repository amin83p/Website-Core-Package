// MVC/services/ielts/essayAnalysisService.js

/**
 * Step 2: Deterministic feature extraction for IELTS Task 2.
 * Key design choices:
 * - Paragraph roles are positional (stable across messy student writing).
 * - Conclusion markers are diagnostics (do not control roles).
 * - Reuse Step 1 sentence segmentation (avoid drift).
 */

// --- CONSTANTS ---
const DEFAULT_CONNECTORS = [
  // Contrast
  "however", "nevertheless", "nonetheless", "on the contrary", "in contrast", "whereas", "while", "although", "but", "yet",
  // Cause/effect
  "because", "since", "as", "therefore", "thus", "consequently", "as a result", "hence", "so",
  // Addition
  "moreover", "furthermore", "in addition", "also", "and",
  // Example
  "for example", "for instance", "such as", "like",
  // Sequence / conclusion
  "first", "firstly", "second", "secondly", "finally", "in conclusion", "to conclude", "overall", "to sum up"
];

const DEFAULT_STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","else","so","because","as","since","of","to","in","on","at","for",
  "with","by","from","into","about","over","under","between","through","during","before","after",
  "is","are","was","were","be","been","being","do","does","did","have","has","had",
  "i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","their","our",
  "this","that","these","those","there","here"
]);

const CONCLUSION_MARKERS = [
  "in conclusion",
  "to conclude",
  "to sum up",
  "in summary",
  "to summarise",
  "to summarize",
  "overall",
  "ultimately",
  "all in all",
  "conclusively"
];

// For “early window” Tier-3 scanning inside first sentence
const TASK_ECHO_STOPWORDS = new Set([
  ...DEFAULT_STOPWORDS,
  "task", "question", "statement", "prompt", "essay", "response", "write",
  "words", "minimum", "approximately", "reason", "reasons", "example",
  "examples", "support", "argument", "arguments"
]);

const CONCLUSION_EARLY_WINDOW = 160;

// --- HELPERS ---
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function lower(text) {
  return (text ?? "").toLowerCase();
}

/**
 * Marker checks (Tier 1-3), applied to already-segmented sentences.
 */
function startsWithMarker(s) {
  const t = String(s ?? "").trim().toLowerCase();
  return CONCLUSION_MARKERS.some(m =>
    new RegExp(`^${m.replace(/ /g, "\\s+")}\\b`).test(t)
  );
}

function containsMarkerEarly(s, windowChars = CONCLUSION_EARLY_WINDOW) {
  const t = String(s ?? "").toLowerCase();
  const w = t.slice(0, windowChars);
  return CONCLUSION_MARKERS.some(m =>
    new RegExp(`\\b${m.replace(/ /g, "\\s+")}\\b`).test(w)
  );
}

function hasConclusionSignpostFromSentences(paragraphText, paragraphSentences) {
  const para = String(paragraphText ?? "").trim();
  if (!para) return false;

  // Tier 1: paragraph starts with marker
  if (startsWithMarker(para)) return true;

  // Tier 2: any sentence starts with marker
  const sents = (paragraphSentences ?? []).map(s => s.text).filter(Boolean);
  if (sents.some(startsWithMarker)) return true;

  // Tier 3: marker appears early in first sentence
  if (sents.length > 0 && containsMarkerEarly(sents[0], CONCLUSION_EARLY_WINDOW)) return true;

  return false;
}

/**
 * Roles by position (stable).
 * If n>=3: intro + bodies + conclusion.
 * If n==2: intro + body (do not force "conclusion").
 */
function classifyParagraphRolesByPosition(paragraphs) {
  const n = paragraphs.length;
  if (n === 0) return [];
  if (n === 1) return ["body"];

  const roles = Array(n).fill("body");
  roles[0] = "intro";

  if (n >= 3) roles[n - 1] = "conclusion";
  return roles;
}

/**
 * Build a paragraph->sentences map once (fast + consistent with Step 1).
 */
function groupSentencesByParagraph(sentences, paragraphCount) {
  const map = Array.from({ length: paragraphCount }, () => []);
  for (const s of (sentences ?? [])) {
    if (Number.isInteger(s.paragraphIndex) && s.paragraphIndex >= 0 && s.paragraphIndex < paragraphCount) {
      map[s.paragraphIndex].push(s);
    }
  }
  return map;
}

/**
 * Connector counting with overlap protection:
 * - Count multi-word connectors first, mask them, then count single words.
 */
function countConnectorsNoOverlap(normalizedText, connectorList) {
  const original = lower(normalizedText);
  let text = original;

  const connectors = [...connectorList];

  const phrases = connectors.filter(c => c.includes(" ")).sort((a, b) => b.length - a.length);
  const singles = connectors.filter(c => !c.includes(" "));

  const counts = {};
  let total = 0;

  // Count phrases first and mask them
  for (const c of phrases) {
    const pattern = `\\b${escapeRegex(c).replace(/ /g, "\\s+")}\\b`;
    const re = new RegExp(pattern, "g");
    const matches = text.match(re);
    const k = matches ? matches.length : 0;
    if (k > 0) {
      counts[c] = k;
      total += k;
      // mask matched spans with spaces of same length so char offsets remain irrelevant but boundaries break
      text = text.replace(re, (m) => " ".repeat(m.length));
    }
  }

  // Then count singles on masked text
  for (const c of singles) {
    const pattern = `\\b${escapeRegex(c)}\\b`;
    const re = new RegExp(pattern, "g");
    const matches = text.match(re);
    const k = matches ? matches.length : 0;
    if (k > 0) {
      counts[c] = (counts[c] ?? 0) + k;
      total += k;
    }
  }

  const distinctUsed = Object.keys(counts).length;
  return { total, distinctUsed, counts };
}

/**
 * Tokenize words (deterministic).
 */
function tokenizeWords(text) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const seg = new Intl.Segmenter("en", { granularity: "word" });
    const out = [];
    for (const it of seg.segment(text ?? "")) {
      if (it.isWordLike) out.push(it.segment.toLowerCase());
    }
    return out;
  }
  return String(text ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function getTopRepeatedWords(words, stopwords, topN = 10) {
  const freq = new Map();
  for (const w of words) {
    if (w.length < 3) continue;
    if (stopwords.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

function countReferencingTokens(words) {
  const refs = new Set(["it","they","them","their","this","these","those","that","he","she","his","her","we","our","us"]);
  let count = 0;
  for (const w of words) if (refs.has(w)) count++;
  return count;
}

function countVirtualSplitSentences(sentenceRows) {
  return (Array.isArray(sentenceRows) ? sentenceRows : []).reduce((sum, row) => {
    return sum + (row?.meta?.virtualSplit ? 1 : 0);
  }, 0);
}

function toFixedNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function tokenizeEchoWords(text) {
  return String(text ?? "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

function normalizeEchoToken(token) {
  let t = String(token || "").toLowerCase().trim();
  if (!t) return "";

  if (t.length > 4 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
  else if (t.length > 5 && /(sses|shes|ches|xes|zes)$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);

  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith("ly")) t = t.slice(0, -2);

  if (t.length > 5 && t.endsWith("ment")) t = t.slice(0, -4);

  return t;
}

function toContentWordTokens(tokens, options = {}) {
  const normalize = options?.normalize !== false;
  return (Array.isArray(tokens) ? tokens : [])
    .map((token) => (normalize ? normalizeEchoToken(token) : String(token || "").toLowerCase().trim()))
    .filter((token) => token.length >= 3 && !TASK_ECHO_STOPWORDS.has(token));
}

function splitSentenceLikeUnits(text, sentenceRows = []) {
  const fromRows = (Array.isArray(sentenceRows) ? sentenceRows : [])
    .map((row, unitIndex) => ({
      unitIndex,
      paragraphIndex: Number.isInteger(row?.paragraphIndex) ? row.paragraphIndex : null,
      sentenceIndex: Number.isInteger(row?.index) ? row.index : null,
      text: String(row?.text || "").trim()
    }))
    .filter((row) => row.text);
  if (fromRows.length) return fromRows;

  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/[.!?]+\s+|\n+/g)
    .map((unitText, unitIndex) => ({ unitIndex, paragraphIndex: null, sentenceIndex: null, text: unitText.trim() }))
    .filter((row) => row.text);
}

function buildPromptReuseSegments(promptTokens, essayTokens, minSeed = 4) {
  if (!Array.isArray(promptTokens) || !Array.isArray(essayTokens)) return [];
  if (promptTokens.length < minSeed || essayTokens.length < minSeed) return [];

  const promptSeedIndex = new Map();
  for (let i = 0; i <= promptTokens.length - minSeed; i += 1) {
    const key = promptTokens.slice(i, i + minSeed).join(" ");
    const existing = promptSeedIndex.get(key) || [];
    existing.push(i);
    promptSeedIndex.set(key, existing);
  }

  const segments = [];
  let essayIndex = 0;
  while (essayIndex <= essayTokens.length - minSeed) {
    const seedKey = essayTokens.slice(essayIndex, essayIndex + minSeed).join(" ");
    const candidates = promptSeedIndex.get(seedKey);
    if (!candidates || !candidates.length) {
      essayIndex += 1;
      continue;
    }

    let bestLength = 0;
    let bestPromptStart = 0;
    for (const promptStart of candidates) {
      let length = 0;
      while (
        essayIndex + length < essayTokens.length &&
        promptStart + length < promptTokens.length &&
        essayTokens[essayIndex + length] === promptTokens[promptStart + length]
      ) {
        length += 1;
      }
      if (length > bestLength) {
        bestLength = length;
        bestPromptStart = promptStart;
      }
    }

    if (bestLength >= minSeed) {
      segments.push({
        start: essayIndex,
        end: essayIndex + bestLength,
        length: bestLength,
        promptStart: bestPromptStart,
        promptEnd: bestPromptStart + bestLength
      });
      essayIndex += bestLength;
      continue;
    }

    essayIndex += 1;
  }

  return segments;
}

function countTokenOverlap(tokens, tokenSet) {
  let overlap = 0;
  for (const token of (Array.isArray(tokens) ? tokens : [])) {
    if (tokenSet.has(token)) overlap += 1;
  }
  return overlap;
}

function buildNgramSet(tokens, n) {
  const out = new Set();
  const arr = Array.isArray(tokens) ? tokens : [];
  if (!Number.isInteger(n) || n <= 1 || arr.length < n) return out;
  for (let i = 0; i <= arr.length - n; i += 1) {
    out.add(arr.slice(i, i + n).join(" "));
  }
  return out;
}

function countSharedNgrams(tokens, ngramSet, n) {
  const arr = Array.isArray(tokens) ? tokens : [];
  if (!Number.isInteger(n) || n <= 1 || arr.length < n || !(ngramSet instanceof Set) || !ngramSet.size) return 0;
  let count = 0;
  for (let i = 0; i <= arr.length - n; i += 1) {
    const key = arr.slice(i, i + n).join(" ");
    if (ngramSet.has(key)) count += 1;
  }
  return count;
}

function longestCommonSubsequenceLength(aTokens, bTokens) {
  const a = Array.isArray(aTokens) ? aTokens : [];
  const b = Array.isArray(bTokens) ? bTokens : [];
  if (!a.length || !b.length) return 0;

  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) curr[j] = prev[j - 1] + 1;
      else curr[j] = Math.max(prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[b.length];
}

function longestCommonContiguousLength(aTokens, bTokens) {
  const a = Array.isArray(aTokens) ? aTokens : [];
  const b = Array.isArray(bTokens) ? bTokens : [];
  if (!a.length || !b.length) return 0;

  let maxLen = 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > maxLen) maxLen = curr[j];
      }
    }
    prev = curr;
  }
  return maxLen;
}

function computeTaskEchoSignals(essayObj, taskPrompt) {
  const essayText = String(essayObj?.normalizedText || "").trim();
  const rawWordCount = Math.max(0, Number(essayObj?.stats?.wordCount || tokenizeEchoWords(essayText).length || 0));
  const promptText = String(taskPrompt || "").trim();

  const defaultEcho = {
    wordOverlapRatio: 0,
    reusedPromptPhraseCount: 0,
    reusedPromptSentenceLikeCount: 0,
    copiedWordEstimate: 0,
    effectiveContentWordCount: rawWordCount,
    effectiveContentRatio: rawWordCount > 0 ? 1 : 0,
    severity: "none",
    anchorReuseCount: 0,
    detectionVersion: "v2_robust_phrase",
    matchedPromptAnchors: [],
    matchedPromptSegments: [],
    matchedUnitDiagnostics: []
  };

  if (!promptText || !essayText || rawWordCount === 0) return defaultEcho;

  const promptTokens = tokenizeEchoWords(promptText);
  const essayTokens = tokenizeEchoWords(essayText);
  if (promptTokens.length < 6 || essayTokens.length < 20) return defaultEcho;

  const promptContentTokens = toContentWordTokens(promptTokens, { normalize: true });
  const essayContentTokens = toContentWordTokens(essayTokens, { normalize: true });
  if (promptContentTokens.length < 5 || essayContentTokens.length < 12) return defaultEcho;

  const promptContentSet = new Set(promptContentTokens);
  const promptContentUnique = [...promptContentSet];
  const promptAnchorTokens = promptContentUnique.filter((token) => token.length >= 4);
  const promptAnchorSet = new Set(promptAnchorTokens.length ? promptAnchorTokens : promptContentUnique);

  const overlapCount = countTokenOverlap(essayContentTokens, promptContentSet);
  const wordOverlapRatio = essayContentTokens.length > 0
    ? overlapCount / essayContentTokens.length
    : 0;

  const promptNgrams2 = buildNgramSet(promptContentTokens, 2);
  const promptNgrams3 = buildNgramSet(promptContentTokens, 3);
  const reuseSegments = buildPromptReuseSegments(promptContentTokens, essayContentTokens, 4);
  const segmentCopiedWordEstimate = Math.round(
    reuseSegments.reduce((sum, segment) => sum + Number(segment?.length || 0), 0) * 1.25
  );
  const segmentSentenceLikeCount = reuseSegments.filter((segment) => Number(segment?.length || 0) >= 7).length;

  const essayUnits = splitSentenceLikeUnits(essayText, essayObj?.sentences);
  let sentenceLikeCountFromUnits = 0;
  let phraseLikeCountFromUnits = 0;
  let copiedWordEstimateFromUnits = 0;
  const matchedUnitDiagnostics = [];
  const matchedAnchorFrequency = new Map();

  for (const unit of essayUnits) {
    const unitText = String(unit?.text || "");
    const rawUnitTokens = tokenizeEchoWords(unitText);
    const unitContentTokens = toContentWordTokens(rawUnitTokens, { normalize: true });
    if (rawUnitTokens.length < 8 || unitContentTokens.length < 4) continue;

    const unitContentSet = new Set(unitContentTokens);
    const uniqueUnitTokens = [...unitContentSet];
    const uniqueOverlapCount = countTokenOverlap(uniqueUnitTokens, promptContentSet);
    const promptCoverage = promptContentSet.size > 0 ? uniqueOverlapCount / promptContentSet.size : 0;
    const unitCoverage = uniqueUnitTokens.length > 0 ? uniqueOverlapCount / uniqueUnitTokens.length : 0;
    const anchorHits = countTokenOverlap(uniqueUnitTokens, promptAnchorSet);
    const lcsLength = longestCommonSubsequenceLength(promptContentTokens, unitContentTokens);
    const contiguousLength = longestCommonContiguousLength(promptContentTokens, unitContentTokens);
    const ngram3Hits = countSharedNgrams(unitContentTokens, promptNgrams3, 3);
    const ngram2Hits = countSharedNgrams(unitContentTokens, promptNgrams2, 2);

    const phraseLike = (
      contiguousLength >= 4 ||
      ngram3Hits >= 1 ||
      (ngram2Hits >= 3 && promptCoverage >= 0.34) ||
      (lcsLength >= 5 && promptCoverage >= 0.4)
    );

    const sentenceLike = (
      (contiguousLength >= 4 && promptCoverage >= 0.34) ||
      (
        lcsLength >= Math.max(5, Math.ceil(promptContentTokens.length * 0.4)) &&
        (promptCoverage >= 0.34 || anchorHits >= 4)
      ) ||
      (promptCoverage >= 0.52 && anchorHits >= 4) ||
      (ngram3Hits >= 2 && promptCoverage >= 0.3)
    );

    if (!phraseLike && !sentenceLike) continue;

    const lcsPromptCoverage = promptContentTokens.length > 0 ? (lcsLength / promptContentTokens.length) : 0;
    const reuseStrength = Math.max(
      promptCoverage * 0.88,
      unitCoverage * 0.75,
      lcsPromptCoverage * 0.95,
      contiguousLength >= 4 ? Math.min(0.9, 0.4 + ((contiguousLength - 4) * 0.08)) : 0,
      ngram3Hits >= 1 ? Math.min(0.85, 0.28 + (ngram3Hits * 0.12) + (ngram2Hits * 0.04)) : 0
    );

    const estimatedCopiedWords = sentenceLike
      ? Math.round(
        Math.min(
          rawUnitTokens.length * Math.min(0.62, reuseStrength * 0.75),
          Math.max(5, uniqueOverlapCount * 1.7)
        )
      )
      : Math.round(
        Math.min(rawUnitTokens.length * 0.28, Math.max(3, uniqueOverlapCount * 1.2))
      );

    for (const token of uniqueUnitTokens) {
      if (!promptAnchorSet.has(token)) continue;
      matchedAnchorFrequency.set(token, (matchedAnchorFrequency.get(token) || 0) + 1);
    }

    phraseLikeCountFromUnits += phraseLike ? 1 : 0;
    sentenceLikeCountFromUnits += sentenceLike ? 1 : 0;
    copiedWordEstimateFromUnits += Math.max(0, estimatedCopiedWords);

    matchedUnitDiagnostics.push({
      unitIndex: Number(unit?.unitIndex),
      paragraphIndex: Number.isInteger(unit?.paragraphIndex) ? unit.paragraphIndex : null,
      sentenceIndex: Number.isInteger(unit?.sentenceIndex) ? unit.sentenceIndex : null,
      promptCoverage: toFixedNumber(promptCoverage, 4),
      unitCoverage: toFixedNumber(unitCoverage, 4),
      lcsLength,
      contiguousLength,
      ngram3Hits,
      ngram2Hits,
      anchorHits,
      sentenceLike,
      phraseLike,
      estimatedCopiedWords
    });
  }

  const matchedPromptSegments = reuseSegments
    .slice(0, 12)
    .map((segment) => ({
      start: Number(segment?.start || 0),
      end: Number(segment?.end || 0),
      length: Number(segment?.length || 0),
      promptStart: Number(segment?.promptStart || 0),
      promptEnd: Number(segment?.promptEnd || 0)
    }));

  const reusedPromptPhraseCount = Math.max(reuseSegments.length, phraseLikeCountFromUnits);
  const reusedPromptSentenceLikeCount = Math.max(
    sentenceLikeCountFromUnits,
    Math.min(segmentSentenceLikeCount, sentenceLikeCountFromUnits + 1)
  );
  const copiedWordEstimate = Math.max(
    0,
    Math.min(
      rawWordCount,
      Math.round(
        Math.max(
          segmentCopiedWordEstimate,
          copiedWordEstimateFromUnits,
          (segmentCopiedWordEstimate + copiedWordEstimateFromUnits) / 2
        )
      )
    )
  );

  const effectiveContentWordCount = Math.max(0, rawWordCount - copiedWordEstimate);
  const effectiveContentRatio = rawWordCount > 0 ? (effectiveContentWordCount / rawWordCount) : 0;
  const matchedPromptAnchors = [...matchedAnchorFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([token, count]) => ({ token, count }));
  const anchorReuseCount = matchedPromptAnchors.length;

  let severity = "none";
  if (
    reusedPromptSentenceLikeCount >= 2 ||
    (reusedPromptPhraseCount >= 3 && copiedWordEstimate >= 32) ||
    copiedWordEstimate >= 48 ||
    (anchorReuseCount >= 5 && wordOverlapRatio >= 0.34 && copiedWordEstimate >= 30)
  ) {
    severity = "severe";
  } else if (
    reusedPromptSentenceLikeCount >= 1 ||
    reusedPromptPhraseCount >= 2 ||
    copiedWordEstimate >= 22 ||
    (wordOverlapRatio >= 0.24 && anchorReuseCount >= 4)
  ) {
    severity = "moderate";
  } else if (
    reusedPromptPhraseCount >= 1 ||
    copiedWordEstimate >= 12 ||
    (wordOverlapRatio >= 0.22 && anchorReuseCount >= 2)
  ) {
    severity = "mild";
  }

  return {
    wordOverlapRatio: toFixedNumber(wordOverlapRatio, 4),
    reusedPromptPhraseCount,
    reusedPromptSentenceLikeCount,
    copiedWordEstimate,
    effectiveContentWordCount,
    effectiveContentRatio: toFixedNumber(effectiveContentRatio, 4),
    severity,
    anchorReuseCount,
    detectionVersion: "v2_robust_phrase",
    matchedPromptAnchors,
    matchedPromptSegments,
    matchedUnitDiagnostics
  };
}

// --- SERVICE ---
const essayAnalysisService = {
  computeStep2Features: (essayObj, options = {}) => {
    const paragraphs = essayObj?.paragraphs ?? [];
    const sentences = essayObj?.sentences ?? [];
    const step1Flags = essayObj?.flags || {};
    const paragraphCount = paragraphs.length;
    const taskPrompt = String(options?.taskPrompt || options?.task_prompt || "").trim();
    const taskEcho = computeTaskEchoSignals(essayObj, taskPrompt);

    // 1) Stable roles by position
    const paragraphRoles = classifyParagraphRolesByPosition(paragraphs);
    // Body paragraph indices/count (deterministic from paragraphRoles)
    const bodyParagraphIndices = paragraphRoles
      .map((role, idx) => (role === "body" ? idx : -1))
      .filter(idx => idx >= 0);

    //const bodyParagraphCount = bodyParagraphIndices.length;
    // 2) Sentence counts per paragraph (single pass)
    const byPara = groupSentencesByParagraph(sentences, paragraphCount);
    const paragraphSentenceCounts = byPara.map(list => list.length);
    const paragraphVirtualSentenceCounts = byPara.map((list) => countVirtualSplitSentences(list));
    const virtualSplitSentenceCount = paragraphVirtualSentenceCounts.reduce((sum, n) => sum + Number(n || 0), 0);
    const baseSentenceCount = Number(step1Flags?.baseSentenceCount || sentences.length || 0);
    const recoveredSentenceDelta = Math.max(0, sentences.length - baseSentenceCount);
    const virtualRecoveryApplied = Boolean(step1Flags?.virtualRecoveryApplied) || virtualSplitSentenceCount > 0;

    // 3) Conclusion signpost diagnostics across ALL paragraphs
    const conclusionSignpostParagraphIndices = [];
    for (let i = 0; i < paragraphCount; i++) {
      const p = paragraphs[i];
      const has = hasConclusionSignpostFromSentences(p.text, byPara[i]);
      if (has) conclusionSignpostParagraphIndices.push(i);
    }
    const lastIndex = paragraphCount - 1;
    const conclusionSignpostFoundInLast = lastIndex >= 0 && conclusionSignpostParagraphIndices.includes(lastIndex);
    const misplacedConclusionSignpost =
      conclusionSignpostParagraphIndices.some(i => i !== lastIndex); // any signpost not in last para

    // 4) Cohesion (connector usage)
    const connectorStats = countConnectorsNoOverlap(essayObj?.normalizedText ?? "", DEFAULT_CONNECTORS);
    const wordCount = essayObj?.stats?.wordCount || 1;
    const density = (connectorStats.total / wordCount) * 100;

    // Optional: a “cleaner” density excluding ultra-basic items (kept deterministic)
    const BASIC_CONNECTORS = new Set(["and", "as", "like", "so"]);
    const totalExBasic = Object.entries(connectorStats.counts)
      .filter(([k]) => !BASIC_CONNECTORS.has(k))
      .reduce((sum, [, v]) => sum + v, 0);
    const densityExBasic = (totalExBasic / wordCount) * 100;

    const countsExBasic = Object.fromEntries(
      Object.entries(connectorStats.counts).filter(([k]) => !BASIC_CONNECTORS.has(k))
    );

    const distinctExBasic = Object.values(countsExBasic).filter(v => v > 0).length;

    const perParagraphFeatures = paragraphs.map((paragraph, paragraphIndex) => {
      const paragraphRole = paragraphRoles[paragraphIndex] || "body";
      const paragraphText = String(paragraph?.text ?? "");
      const paragraphWords = tokenizeWords(paragraphText);
      const paragraphWordCount = Math.max(paragraphWords.length, 1);
      const paragraphVirtualSentenceCount = paragraphVirtualSentenceCounts[paragraphIndex] || 0;
      const paragraphConnectorStats = countConnectorsNoOverlap(paragraphText, DEFAULT_CONNECTORS);
      const paragraphTotalExBasic = Object.entries(paragraphConnectorStats.counts)
        .filter(([k]) => !BASIC_CONNECTORS.has(k))
        .reduce((sum, [, v]) => sum + v, 0);
      const paragraphReferencingCount = countReferencingTokens(paragraphWords);
      const paragraphHasConclusionSignpost = hasConclusionSignpostFromSentences(paragraphText, byPara[paragraphIndex]);
      const paragraphRepeatedWords = getTopRepeatedWords(paragraphWords, DEFAULT_STOPWORDS, 10)
        .filter((item) => item.count > 1);

      return {
        paragraphIndex,
        paragraphNumber: Number.isInteger(paragraph?.paragraphNumber)
          ? paragraph.paragraphNumber
          : paragraphIndex + 1,
        role: paragraphRole,
        sentenceCount: byPara[paragraphIndex]?.length ?? 0,
        virtualSentenceCount: paragraphVirtualSentenceCount,
        paragraphWordCount,
        runOnRecoveryLikely: paragraphVirtualSentenceCount > 0 && (byPara[paragraphIndex]?.length ?? 0) >= 2,
        connectorDensity: toFixedNumber((paragraphConnectorStats.total / paragraphWordCount) * 100),
        connectorDensityExcludingBasic: toFixedNumber((paragraphTotalExBasic / paragraphWordCount) * 100),
        referencingDensity: toFixedNumber((paragraphReferencingCount / paragraphWordCount) * 100),
        repeatedWords: paragraphRepeatedWords,
        hasConclusionSignpost: paragraphHasConclusionSignpost,
        misplacedConclusionSignpost: paragraphHasConclusionSignpost && paragraphRole !== "conclusion"
      };
    });

    // 5) Lexical repetition & referencing
    const words = tokenizeWords(essayObj?.normalizedText ?? "");
    const topRepeatedWords = getTopRepeatedWords(words, DEFAULT_STOPWORDS);
    const referencingCount = countReferencingTokens(words);
    const referencingDensity = (referencingCount / wordCount) * 100;

    // “Has conclusion paragraph” should reflect positional structure (not marker presence)
    const hasConclusionParagraph = paragraphCount >= 3; // stable definition for your app

    return {
      structure: {
        paragraphRoles,
        paragraphSentenceCounts,
        paragraphVirtualSentenceCounts,
        sentenceCount: sentences.length,
        hasIntro: paragraphRoles.includes("intro"),
        hasConclusion: hasConclusionParagraph,
        paragraphCount,
        virtualSplitSentenceCount,
        virtualRecoveryApplied,
        baseSentenceCount,
        recoveredSentenceDelta,
        virtualSplitCount: Number(step1Flags?.virtualSplitCount || 0),
        runOnDiscourseSplitCount: Number(step1Flags?.runOnDiscourseSplitCount || 0),
        runOnClauseSplitCount: Number(step1Flags?.runOnClauseSplitCount || 0),

        // diagnostics (do not drive roles)
        conclusionSignpostParagraphIndices,
        conclusionSignpostFoundInLast,
        misplacedConclusionSignpost
      },
      perParagraphFeatures,
      cohesion: {
        // original
        totalConnectors: connectorStats.total,
        distinctConnectors: connectorStats.distinctUsed,
        densityPer100: density.toFixed(2),
        usageMap: connectorStats.counts,

        // excluding-basic (recommended to use for gates/scoring)
        totalConnectorsExcludingBasic: totalExBasic,
        distinctConnectorsExcludingBasic: distinctExBasic,
        densityPer100ExcludingBasic: densityExBasic.toFixed(2),
        usageMapExcludingBasic: countsExBasic,

        // optional: makes results easier to interpret/debug
        basicConnectorsExcluded: Array.from(BASIC_CONNECTORS)
      },
      lexical: {
        topRepeatedWords,
        referencingCount,
        referencingDensity: referencingDensity.toFixed(2)
      },
      taskEcho
    };
  },
  computeTaskEchoSignals
};

module.exports = essayAnalysisService;
