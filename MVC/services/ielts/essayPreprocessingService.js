// Step 01
// MVC/services/ielts/essayPreprocessingService.js

/**
 * Deterministic preprocessing for IELTS writing scoring.
 * - Do NOT "correct" grammar/punctuation (those matter for later scoring).
 * - DO normalize whitespace/newlines for stable segmentation.
 * - DO allow virtual boundaries for common learner punctuation issues, but log them.
 */

function normalizeText(rawText, opts = {}) {
  const options = {
    unwrapSingleNewlines: opts.unwrapSingleNewlines ?? true, // fixes hard-wrap copy/paste
    fixHyphenLineBreaks: opts.fixHyphenLineBreaks ?? true
  };

  if (typeof rawText !== "string") rawText = String(rawText ?? "");

  let t = rawText.normalize("NFKC");
  t = t.replace(/\r\n?/g, "\n");
  t = t.replace(/\u00A0/g, " ");
  t = t.replace(/[^\S\n]+/g, " ");
  t = t.replace(/ *\n */g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  t = t.trim();

  if (options.unwrapSingleNewlines) {
    const paras = t.split(/\n{2,}/);
    const cleaned = paras.map(p => {
      let x = p;

      // "exam-\nple" -> "example" (inside paragraph only)
      if (options.fixHyphenLineBreaks) {
        x = x.replace(/-\n(?=\p{L})/gu, "");
      }

      // unwrap remaining single newlines inside a paragraph
      x = x.replace(/\n+/g, " ");
      x = x.replace(/\s{2,}/g, " ").trim();
      return x;
    });
    t = cleaned.join("\n\n");
  }

  return t;
}

function splitParagraphsWithSpans(text) {
  const paragraphs = [];
  if (!text) return paragraphs;

  const re = /\n{2,}/g;
  let start = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    const end = m.index;
    const chunk = text.slice(start, end);
    if (chunk.length > 0) {
      const index = paragraphs.length;
      const paragraphNumber = index + 1;
      paragraphs.push({
        index,
        paragraphNumber,
        displayParagraphId: `P${paragraphNumber}`,
        startChar: start,
        endChar: end,
        text: chunk
      });
    }
    start = re.lastIndex;
  }

  const tail = text.slice(start);
  if (tail.length > 0) {
    const index = paragraphs.length;
    const paragraphNumber = index + 1;
    paragraphs.push({
      index,
      paragraphNumber,
      displayParagraphId: `P${paragraphNumber}`,
      startChar: start,
      endChar: text.length,
      text: tail
    });
  }

  return paragraphs;
}

function sentenceSplitIntl(text, locale = "en") {
  if (!text) return [];

  // Preferred: Intl.Segmenter
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter !== "undefined") {
    const seg = new Intl.Segmenter(locale, { granularity: "sentence" });
    const items = Array.from(seg.segment(text));
    const sentences = [];

    for (const it of items) {
      const raw = it.segment;
      if (!raw) continue;

      const trimmed = raw.trim();
      if (!trimmed) continue;

      // Adjust offsets AFTER trimming (important)
      const lead = raw.length - raw.trimStart().length;
      const trail = raw.length - raw.trimEnd().length;

      sentences.push({
        startChar: it.index + lead,
        endChar: it.index + raw.length - trail,
        text: trimmed
      });
    }
    return sentences;
  }

  // Fallback (keeps offsets)
  const out = [];
  const re = /[^.!?]+[.!?]+|[^.!?]+$/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;

    out.push({
      startChar: m.index + lead,
      endChar: m.index + raw.length - trail,
      text: trimmed
    });
  }
  return out;
}

function countWordsSimple(text) {
  const tokens = String(text ?? "").match(/[A-Za-z0-9]+/g);
  return Array.isArray(tokens) ? tokens.length : 0;
}

function normalizeMeta(meta) {
  if (meta && typeof meta === "object") return { ...meta };
  return { virtualSplit: false };
}

function mergeVirtualSplitReason(meta, reason) {
  const out = normalizeMeta(meta);
  if (!reason) {
    if (out.virtualSplit === undefined) out.virtualSplit = false;
    return out;
  }
  const current = out.virtualSplit;
  if (!current || current === false) {
    out.virtualSplit = reason;
    return out;
  }
  if (Array.isArray(current)) {
    if (!current.includes(reason)) current.push(reason);
    out.virtualSplit = current;
    return out;
  }
  if (typeof current === "string") {
    if (current !== reason) out.virtualSplit = [current, reason];
    return out;
  }
  out.virtualSplit = reason;
  return out;
}

function buildTrimmedSpan(fullText, start, end, meta = {}) {
  const raw = fullText.slice(start, end);
  const text = raw.trim();
  if (!text) return null;
  const lead = raw.length - raw.trimStart().length;
  const trail = raw.length - raw.trimEnd().length;
  return {
    startChar: start + lead,
    endChar: end - trail,
    text,
    meta: normalizeMeta(meta)
  };
}

function collectDiscourseMarkerSplitCandidates(raw) {
  const candidates = [];
  const markerRegex = /([,:;])\s+(firstly|secondly|thirdly|finally|for example|for instance|in conclusion|to conclude|to sum up|moreover|furthermore|in addition|another reason|in general|overall|therefore|as a result|on the other hand|however)\b/gi;
  const capitalizedMarkerRegex = /(?:^|\s+)(Firstly|Secondly|Thirdly|Finally|For example|For instance|In conclusion|To conclude|To sum up|Moreover|Furthermore|In addition|Another reason|In general|Overall|Therefore|As a result|On the other hand|However)\b/g;
  const conjunctionMarkerRegex = /\b(?:and|but|so)\s+(firstly|secondly|thirdly|finally|for example|for instance|in conclusion|to conclude|to sum up|moreover|furthermore|in addition|another reason|in general|overall|therefore|as a result|on the other hand|however)\b/gi;
  let match;
  while ((match = markerRegex.exec(raw)) !== null) {
    const markerToken = String(match[2] || "");
    const markerOffset = String(match[0] || "").toLowerCase().lastIndexOf(markerToken.toLowerCase());
    if (markerOffset < 0) continue;
    candidates.push({
      index: match.index + markerOffset,
      reason: "run_on_discourse_marker"
    });
  }

  while ((match = capitalizedMarkerRegex.exec(raw)) !== null) {
    const markerToken = String(match[1] || "");
    const markerOffset = String(match[0] || "").lastIndexOf(markerToken);
    if (markerOffset < 0) continue;
    candidates.push({
      index: match.index + markerOffset,
      reason: "run_on_discourse_marker"
    });
  }

  while ((match = conjunctionMarkerRegex.exec(raw)) !== null) {
    const markerToken = String(match[1] || "");
    const markerOffset = String(match[0] || "").toLowerCase().lastIndexOf(markerToken.toLowerCase());
    if (markerOffset < 0) continue;
    candidates.push({
      index: match.index + markerOffset,
      reason: "run_on_discourse_marker"
    });
  }
  return candidates;
}

function collectClauseSplitCandidates(raw) {
  const candidates = [];
  const clauseRegex = /,\s+(?:and|but|so)\s+(i|we|they|this|these|it|there|many|some|another|people)\b/gi;
  let match;
  while ((match = clauseRegex.exec(raw)) !== null) {
    const pronoun = String(match[1] || "").toLowerCase();
    const pronounOffset = String(match[0] || "").toLowerCase().lastIndexOf(pronoun);
    if (pronounOffset < 0) continue;
    candidates.push({
      index: match.index + pronounOffset,
      reason: "run_on_clause_boundary"
    });
  }
  return candidates;
}

function collectLooseClauseSplitCandidates(raw) {
  const candidates = [];
  const clauseRegex = /\b(?:and|but|so)\s+(i|we|they|this|these|it|there|many|some|another|people)\b/gi;
  let match;
  while ((match = clauseRegex.exec(raw)) !== null) {
    const pronoun = String(match[1] || "").toLowerCase();
    const pronounOffset = String(match[0] || "").toLowerCase().lastIndexOf(pronoun);
    if (pronounOffset < 0) continue;
    candidates.push({
      index: match.index + pronounOffset,
      reason: "run_on_clause_boundary"
    });
  }
  return candidates;
}

function dedupeSplitCandidates(candidates) {
  const unique = [];
  const seen = new Set();
  const ordered = (Array.isArray(candidates) ? candidates : [])
    .filter((row) => Number.isInteger(row?.index) && row.index > 0)
    .sort((a, b) => a.index - b.index);

  for (const row of ordered) {
    const key = `${row.index}:${row.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

/**
 * Virtual split recovery for long run-on spans.
 * We do NOT alter text; we only create additional sentence spans with explicit virtual metadata.
 */
function refineRunOnVirtualBoundarySplits(fullText, spans, opts = {}) {
  const minWordCount = Number(opts.minWordCount || 34);
  const minCharCount = Number(opts.minCharCount || 190);
  const minSegmentWords = Number(opts.minSegmentWords || 8);
  const minSegmentChars = Number(opts.minSegmentChars || 45);
  const maxSplitsPerSpan = Number(opts.maxSplitsPerSpan || 3);

  const refined = [];
  let runOnDiscourseSplitCount = 0;
  let runOnClauseSplitCount = 0;

  for (const sp of (Array.isArray(spans) ? spans : [])) {
    const raw = fullText.slice(sp.startChar, sp.endChar);
    const wordCount = countWordsSimple(raw);
    if (wordCount < minWordCount || raw.length < minCharCount) {
      refined.push({
        ...sp,
        meta: normalizeMeta(sp.meta)
      });
      continue;
    }

    let candidates = collectDiscourseMarkerSplitCandidates(raw);
    if (candidates.length === 0 && wordCount >= Math.max(50, minWordCount + 10)) {
      candidates = collectClauseSplitCandidates(raw);
    }
    if (candidates.length === 0 && wordCount >= Math.max(70, minWordCount + 22) && raw.length >= 320) {
      candidates = collectLooseClauseSplitCandidates(raw);
    }
    candidates = dedupeSplitCandidates(candidates);

    if (!candidates.length) {
      refined.push({
        ...sp,
        meta: normalizeMeta(sp.meta)
      });
      continue;
    }

    let lastCut = 0;
    let splitCount = 0;
    let pendingReason = null;
    let didSplit = false;

    for (const candidate of candidates) {
      if (splitCount >= maxSplitsPerSpan) break;
      const relIndex = candidate.index;
      if (!Number.isInteger(relIndex)) continue;
      if (relIndex <= lastCut) continue;

      const leftRaw = raw.slice(lastCut, relIndex);
      const rightRaw = raw.slice(relIndex);
      if (leftRaw.length < minSegmentChars) continue;
      if (rightRaw.length < minSegmentChars) continue;
      if (countWordsSimple(leftRaw) < minSegmentWords) continue;
      if (countWordsSimple(rightRaw) < minSegmentWords) continue;

      const leftMeta = splitCount === 0
        ? normalizeMeta(sp.meta)
        : mergeVirtualSplitReason(sp.meta, pendingReason);
      const leftSpan = buildTrimmedSpan(
        fullText,
        sp.startChar + lastCut,
        sp.startChar + relIndex,
        leftMeta
      );
      if (!leftSpan) continue;

      refined.push(leftSpan);
      pendingReason = candidate.reason || "run_on_clause_boundary";
      if (pendingReason === "run_on_discourse_marker") runOnDiscourseSplitCount += 1;
      else runOnClauseSplitCount += 1;
      lastCut = relIndex;
      splitCount += 1;
      didSplit = true;
    }

    if (!didSplit) {
      refined.push({
        ...sp,
        meta: normalizeMeta(sp.meta)
      });
      continue;
    }

    const tailMeta = mergeVirtualSplitReason(sp.meta, pendingReason || "run_on_clause_boundary");
    const tailSpan = buildTrimmedSpan(fullText, sp.startChar + lastCut, sp.endChar, tailMeta);
    if (tailSpan) refined.push(tailSpan);
  }

  return {
    spans: refined,
    runOnDiscourseSplitCount,
    runOnClauseSplitCount
  };
}

/**
 * Virtual split for learner error: period + lowercase starter (". can", ". it", ". this", etc.).
 * We do NOT edit the text; we only split spans and record a flag.
 */
function refineLowercaseAfterPeriodSplits(fullText, spans) {
  const starters = new Set(["can", "it", "this", "there", "they", "we", "i", "he", "she", "you"]);
  const refined = [];
  let lowercaseAfterPeriodCount = 0;

  for (const sp of spans) {
    const raw = fullText.slice(sp.startChar, sp.endChar);

    // Look for ".  can" (any whitespace) where next token begins lowercase
    const re = /([.!?])\s+(?=[a-z])/g;
    let lastCutRel = 0;
    let match;

    // We may split multiple times inside one long span
    while ((match = re.exec(raw)) !== null) {
      const rel = match.index;              // punctuation position in raw slice
      const after = raw.slice(rel + match[0].length); // text after punctuation+spaces
      const nextWord = (after.match(/^([a-z]+)/) || [null, null])[1];

      if (!nextWord || !starters.has(nextWord)) continue;

      // Create sentence A: from lastCutRel .. (rel+1) including punctuation
      const aStart = sp.startChar + lastCutRel;
      const aEnd = sp.startChar + rel + 1;

      // Create sentence B: starts after punctuation+spaces
      const bStart = sp.startChar + rel + match[0].length;
      // We'll continue scanning from bStart (relative)
      const bRelStart = rel + match[0].length;

      const aSpan = buildTrimmedSpan(fullText, aStart, aEnd, { virtualSplit: false });
      if (aSpan) refined.push(aSpan);

      // Prepare to cut again; we do NOT push B yet (might split again later)
      lastCutRel = bRelStart;
      lowercaseAfterPeriodCount += 1;
    }

    // Tail from lastCutRel to end
    const tStart = sp.startChar + lastCutRel;
    const tEnd = sp.endChar;
    const tSpan = buildTrimmedSpan(
      fullText,
      tStart,
      tEnd,
      { virtualSplit: lastCutRel !== 0 ? "lowercase_after_period" : false }
    );
    if (tSpan) refined.push(tSpan);
  }

  return { spans: refined, lowercaseAfterPeriodCount };
}

function countWordsIntl(text, locale = "en") {
  if (!text) return 0;
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter !== "undefined") {
    const seg = new Intl.Segmenter(locale, { granularity: "word" });
    let count = 0;
    for (const it of seg.segment(text)) if (it.isWordLike) count += 1;
    return count;
  }
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function findParagraphIndex(paragraphs, charIndex) {
  for (let i = 0; i < paragraphs.length; i++) {
    if (charIndex >= paragraphs[i].startChar && charIndex < paragraphs[i].endChar) return i;
  }
  return Math.max(0, paragraphs.length - 1);
}

const essayPreprocessingService = {
  buildEssayObject: (rawText, opts = {}) => {
    const locale = opts.locale ?? "en";
    const enableRunOnVirtualSplits = opts.enableRunOnVirtualSplits !== false;
    const raw = typeof rawText === "string" ? rawText : String(rawText ?? "");

    const normalizedText = normalizeText(raw, opts);
    const paragraphs = splitParagraphsWithSpans(normalizedText);

    // Initial sentence spans
    const baseSpans = sentenceSplitIntl(normalizedText, locale);

    // Refinement 1: split ". can/it/this..." without editing text
    const { spans: refinedLowercaseSpans, lowercaseAfterPeriodCount } =
      refineLowercaseAfterPeriodSplits(normalizedText, baseSpans);

    // Refinement 2: conservative virtual boundaries for long run-ons
    const runOnRefine = enableRunOnVirtualSplits
      ? refineRunOnVirtualBoundarySplits(normalizedText, refinedLowercaseSpans, opts.virtualSplitOptions || {})
      : {
        spans: refinedLowercaseSpans.map((sp) => ({ ...sp, meta: normalizeMeta(sp.meta) })),
        runOnDiscourseSplitCount: 0,
        runOnClauseSplitCount: 0
      };
    const refinedSpans = runOnRefine.spans;

    const paragraphSentenceCounts = new Map();
    const sentences = refinedSpans.map((s, idx) => {
      const paragraphIndex = paragraphs.length ? findParagraphIndex(paragraphs, s.startChar) : 0;
      const paragraphNumber = paragraphIndex + 1;
      const paragraphDisplayId = `P${paragraphNumber}`;
      const sentenceNumber = idx + 1;
      const sentenceDisplayId = `S${sentenceNumber}`;
      const paragraphSentenceNumber = (paragraphSentenceCounts.get(paragraphIndex) || 0) + 1;
      paragraphSentenceCounts.set(paragraphIndex, paragraphSentenceNumber);

      const meta = normalizeMeta(s.meta);
      if (meta.virtualSplit === undefined) meta.virtualSplit = false;

      return {
        index: idx,
        sentenceNumber,
        paragraphIndex,
        paragraphNumber,
        paragraphSentenceNumber,
        displayParagraphId: paragraphDisplayId,
        displaySentenceId: sentenceDisplayId,
        displaySentenceRef: `${paragraphDisplayId}-${sentenceDisplayId}`,
        startChar: s.startChar,
        endChar: s.endChar,
        text: s.text,
        meta
      };
    });

    const stats = {
      wordCount: normalizedText ? countWordsIntl(normalizedText, locale) : 0,
      sentenceCount: sentences.length,
      paragraphCount: paragraphs.length,
      charCount: normalizedText.length
    };

    const virtualSplitSentenceCount = sentences.reduce((sum, sentence) => (
      sum + (sentence?.meta?.virtualSplit ? 1 : 0)
    ), 0);
    const virtualSplitCount = Number(
      lowercaseAfterPeriodCount +
      runOnRefine.runOnDiscourseSplitCount +
      runOnRefine.runOnClauseSplitCount
    );

    // Flags you can later use in scoring/feedback (do NOT change writing here)
    const flags = {
      baseSentenceCount: baseSpans.length,
      postLowercaseSentenceCount: refinedLowercaseSpans.length,
      lowercaseAfterPeriodCount,
      runOnDiscourseSplitCount: runOnRefine.runOnDiscourseSplitCount,
      runOnClauseSplitCount: runOnRefine.runOnClauseSplitCount,
      virtualSplitCount,
      virtualSplitSentenceCount,
      virtualRecoveryApplied: virtualSplitCount > 0
    };

    return { rawText: raw, normalizedText, paragraphs, sentences, stats, flags };
  }
};

module.exports = essayPreprocessingService;
