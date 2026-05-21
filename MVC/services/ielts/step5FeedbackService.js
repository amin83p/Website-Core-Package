// MVC/services/ielts/step5FeedbackService.js
const aiService = require('./aiService');
const {
  evaluateRowPassResult
} = require('./answerContractUtils');

const CRITERION_ORDER = ['TR', 'CC', 'LR', 'GRA', 'General'];

function normalizeCriterion(raw) {
  const value = String(raw || '').trim().toUpperCase();
  if (value === 'TR' || value === 'CC' || value === 'LR' || value === 'GRA') return value;
  return 'General';
}

function isAbortLikeError(error) {
  const code = String(error?.code || '').toUpperCase();
  const name = String(error?.name || '').toLowerCase();
  const msg = String(error?.message || '').toLowerCase();
  return (
    code === 'RUN_CANCELLED' ||
    code === 'ABORT_ERR' ||
    name === 'aborterror' ||
    msg.includes('aborted') ||
    msg.includes('cancelled')
  );
}

function evaluateRowStrength(row) {
  const passResult = evaluateRowPassResult(row);
  if (!passResult.evaluated) return true;
  return !passResult.pass;
}

function isWeakResult(row) {
  return evaluateRowStrength(row);
}

function buildSentenceIndexMap(essayObj) {
  const map = new Map();
  const list = Array.isArray(essayObj?.sentences) ? essayObj.sentences : [];
  for (const s of list) {
    if (s && Number.isInteger(s.index)) {
      map.set(s.index, s);
    }
  }
  return map;
}

function getSentenceDisplayId(sentence) {
  if (!sentence) return null;
  if (typeof sentence.displaySentenceId === 'string' && sentence.displaySentenceId.trim()) {
    return sentence.displaySentenceId.trim().toUpperCase();
  }
  if (Number.isInteger(sentence.index)) return `S${sentence.index + 1}`;
  return null;
}

function getSentenceDisplayRef(sentence) {
  if (!sentence) return null;
  if (typeof sentence.displaySentenceRef === 'string' && sentence.displaySentenceRef.trim()) {
    return sentence.displaySentenceRef.trim().toUpperCase();
  }
  const p = Number.isInteger(sentence.paragraphNumber) ? `P${sentence.paragraphNumber}` : null;
  const s = getSentenceDisplayId(sentence);
  if (p && s) return `${p}-${s}`;
  return null;
}

function extractEvidenceRefs(essayObj, evidenceSentenceIndices = [], max = 4) {
  const map = buildSentenceIndexMap(essayObj);
  const idxs = (Array.isArray(evidenceSentenceIndices) ? evidenceSentenceIndices : [])
    .filter((n) => Number.isInteger(n));

  const refs = [];
  const seen = new Set();
  for (const idx of idxs) {
    const sentence = map.get(idx);
    const id = getSentenceDisplayId(sentence) || `S${idx + 1}`;
    if (!seen.has(id)) {
      seen.add(id);
      refs.push(id);
    }
    if (refs.length >= max) break;
  }
  return refs;
}

function buildEvidenceSnippets(essayObj, evidenceSentenceIndices = [], max = 3) {
  const map = buildSentenceIndexMap(essayObj);
  const idxs = (Array.isArray(evidenceSentenceIndices) ? evidenceSentenceIndices : [])
    .filter((n) => Number.isInteger(n))
    .slice(0, max);

  const lines = [];
  for (const idx of idxs) {
    const sentence = map.get(idx);
    if (!sentence) continue;
    const ref = getSentenceDisplayRef(sentence) || getSentenceDisplayId(sentence) || `S${idx + 1}`;
    const text = String(sentence.text || '').trim();
    if (!text) continue;
    lines.push(`${ref}: ${text}`);
  }
  return lines;
}

function collectAllowedEvidenceRefs(essayObj, rows) {
  const map = buildSentenceIndexMap(essayObj);
  const out = new Set();

  for (const row of (Array.isArray(rows) ? rows : [])) {
    const indices = Array.isArray(row?.evidenceSentenceIndices) ? row.evidenceSentenceIndices : [];
    for (const idx of indices) {
      if (!Number.isInteger(idx)) continue;
      const sentence = map.get(idx);
      const sentenceId = getSentenceDisplayId(sentence) || `S${idx + 1}`;
      const sentenceRef = getSentenceDisplayRef(sentence);
      out.add(sentenceId.toUpperCase());
      if (sentenceRef) out.add(sentenceRef.toUpperCase());
    }
  }

  return out;
}

function normalizeRefToken(token) {
  const t = String(token || '').trim().toUpperCase();
  if (!t) return null;
  if (/^S\d+$/.test(t)) return t;
  if (/^P\d+-S\d+$/.test(t)) return t;
  return null;
}

function normalizeEvidenceRefs(rawValue, allowedRefsSet) {
  if (allowedRefsSet instanceof Set && allowedRefsSet.size === 0) return [];

  let tokens = [];

  if (Array.isArray(rawValue)) {
    tokens = rawValue.map((x) => String(x || ''));
  } else if (typeof rawValue === 'string') {
    tokens = rawValue.split(/[,\s;]+/g);
  } else if (rawValue != null) {
    tokens = [String(rawValue)];
  }

  const joined = Array.isArray(rawValue) ? rawValue.join(' ') : String(rawValue || '');
  const matchedRefs = joined.toUpperCase().match(/P\d+-S\d+|S\d+/g);
  if (matchedRefs) tokens.push(...matchedRefs);

  const out = [];
  const seen = new Set();
  for (const token of tokens) {
    let normalized = normalizeRefToken(token);
    if (!normalized) continue;

    if (allowedRefsSet instanceof Set && !allowedRefsSet.has(normalized)) {
      if (/^P\d+-S\d+$/.test(normalized)) {
        const sid = normalized.split('-')[1];
        if (allowedRefsSet.has(sid)) normalized = sid;
      } else {
        const anyMatch = Array.from(allowedRefsSet).find((r) => r.endsWith(`-${normalized}`));
        if (anyMatch) normalized = normalized;
      }
    }

    if (allowedRefsSet instanceof Set && !allowedRefsSet.has(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out.slice(0, 8);
}

function toCleanText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function toSafeBand(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getRowQuestionText(row, fallback = '') {
  return toCleanText(
    row?.questionText ||
    row?.atomic_question ||
    row?.atomicQuestion ||
    row?.question ||
    row?.title,
    fallback
  );
}

function getFeedbackSourceRows(gradingResult) {
  if (Array.isArray(gradingResult?.aggregatedResults) && gradingResult.aggregatedResults.length > 0) {
    return gradingResult.aggregatedResults;
  }
  if (Array.isArray(gradingResult?.results)) return gradingResult.results;
  return [];
}

function scoreWeaknessPriority(row) {
  const weight = toSafeBand(row?.weight, 1);
  const band = toSafeBand(row?.band, 0);
  const hasEvidence = Array.isArray(row?.evidenceSentenceIndices) && row.evidenceSentenceIndices.some(Number.isInteger);
  const sourceBoost = String(row?.source || '').toLowerCase() === 'aggregate' ? 0.5 : 0;
  return (weight * 2) + band + (hasEvidence ? 0.5 : 0) + sourceBoost;
}

function criterionFixHint(criterion) {
  switch (criterion) {
    case 'TR':
      return 'Address every requirement of the prompt with direct, specific development in each body paragraph.';
    case 'CC':
      return 'Use clear paragraph progression and explicit linking so each idea flows logically to the next.';
    case 'LR':
      return 'Use more precise and varied vocabulary, and avoid repeating the same wording across paragraphs.';
    case 'GRA':
      return 'Increase grammatical control in sentence structures and maintain consistent accuracy in complex forms.';
    default:
      return 'Apply a focused revision pass using evidence-based edits and clear control of meaning.';
  }
}

function buildDeterministicFallback(currentBand, targetBand, weaknesses, strengths) {
  const topWeakness = weaknesses[0];
  const summary = topWeakness
    ? `Current overall band is ${currentBand}. The highest-priority gap is ${topWeakness.criterion}, so focus revisions there to move toward Band ${targetBand}.`
    : `Current overall band is ${currentBand}. Continue targeted revisions to move toward Band ${targetBand}.`;

  const groupedWeaknesses = new Map();
  for (const item of weaknesses) {
    const key = normalizeCriterion(item.criterion);
    if (!groupedWeaknesses.has(key)) groupedWeaknesses.set(key, []);
    groupedWeaknesses.get(key).push(item);
  }

  const byCriterion = [];
  for (const criterion of CRITERION_ORDER) {
    const rows = groupedWeaknesses.get(criterion) || [];
    if (!rows.length) continue;

    const refs = [];
    const seen = new Set();
    for (const row of rows) {
      for (const ref of (row.evidenceRefs || [])) {
        if (seen.has(ref)) continue;
        seen.add(ref);
        refs.push(ref);
      }
    }

    const lead = rows[0];
    byCriterion.push({
      criterion,
      summary: getRowQuestionText(lead, `${criterion} needs focused improvement.`),
      evidenceRefs: refs.slice(0, 6),
      fix: criterionFixHint(criterion)
    });
  }

  const improvements = weaknesses.slice(0, 6).map((item) => ({
    criterion: normalizeCriterion(item.criterion),
    issue: getRowQuestionText(item, 'Key issue detected for this criterion.'),
    evidenceRefs: Array.isArray(item.evidenceRefs) ? item.evidenceRefs.slice(0, 6) : [],
    fix: criterionFixHint(normalizeCriterion(item.criterion))
  }));

  const strengthsList = strengths.slice(0, 5).map((row) => {
    const criterion = normalizeCriterion(row.criterion);
    const title = getRowQuestionText(row, 'Strong performance indicator');
    return `[${criterion}] ${title}`;
  });

  return { summary, byCriterion, improvements, strengths: strengthsList };
}

function buildLanguageEvidenceSnapshot(gradingResult) {
  const source = gradingResult?.meta?.step3LanguageEvidence;
  if (!source || typeof source !== 'object') return '';
  const lexicalControl = source?.lexicalControl && typeof source.lexicalControl === 'object'
    ? source.lexicalControl
    : null;
  const grammarControl = source?.grammarControl && typeof source.grammarControl === 'object'
    ? source.grammarControl
    : null;
  const lexicalQuality = source?.lexicalQuality && typeof source.lexicalQuality === 'object'
    ? source.lexicalQuality
    : null;
  const errorProfiles = source?.errorProfiles && typeof source.errorProfiles === 'object'
    ? source.errorProfiles
    : null;
  if (!lexicalControl && !grammarControl && !lexicalQuality && !errorProfiles) return '';
  return [
    `lexicalControl: ${JSON.stringify(lexicalControl)}`,
    `grammarControl: ${JSON.stringify(grammarControl)}`,
    `lexicalQuality (legacy): ${JSON.stringify(lexicalQuality)}`,
    `errorProfiles (legacy): ${JSON.stringify(errorProfiles)}`
  ].join('\n');
}

function parseAiJson(rawText) {
  const raw = String(rawText || '').trim();
  if (!raw) throw new Error('Empty AI response.');

  const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  try {
    return JSON.parse(candidate);
  } catch (_) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error('Failed to parse AI JSON.');
  }
}

function sanitizeFeedbackShape(rawFeedback, fallback, allowedRefsSet) {
  const source = rawFeedback && typeof rawFeedback === 'object' ? rawFeedback : {};

  const summary = toCleanText(source.summary, fallback.summary);

  const rawImprovements = Array.isArray(source.improvements) ? source.improvements : [];
  const improvements = rawImprovements.map((item) => {
    const criterion = normalizeCriterion(item?.criterion);
    const issue = toCleanText(item?.issue || item?.summary, '');
    const fix = toCleanText(item?.fix || item?.action, '');
    const evidenceRefs = normalizeEvidenceRefs(item?.evidenceRefs || item?.evidence, allowedRefsSet);
    return { criterion, issue, evidenceRefs, fix };
  }).filter((item) => item.issue && item.fix).slice(0, 8);

  const rawByCriterion = Array.isArray(source.byCriterion) ? source.byCriterion : [];
  const byCriterion = rawByCriterion.map((item) => {
    const criterion = normalizeCriterion(item?.criterion);
    const criterionSummary = toCleanText(item?.summary || item?.issue, '');
    const fix = toCleanText(item?.fix || item?.action, '');
    const evidenceRefs = normalizeEvidenceRefs(item?.evidenceRefs || item?.evidence, allowedRefsSet);
    return { criterion, summary: criterionSummary, evidenceRefs, fix };
  }).filter((item) => item.summary && item.fix);

  const criterionMap = new Map();
  for (const item of byCriterion) {
    if (!criterionMap.has(item.criterion)) {
      criterionMap.set(item.criterion, item);
    }
  }

  if (criterionMap.size === 0 && improvements.length > 0) {
    const grouped = new Map();
    for (const item of improvements) {
      if (!grouped.has(item.criterion)) grouped.set(item.criterion, []);
      grouped.get(item.criterion).push(item);
    }
    for (const [criterion, rows] of grouped.entries()) {
      const refs = normalizeEvidenceRefs(rows.flatMap((r) => r.evidenceRefs || []), allowedRefsSet);
      criterionMap.set(criterion, {
        criterion,
        summary: rows[0]?.issue || `${criterion} requires improvement.`,
        evidenceRefs: refs.slice(0, 6),
        fix: rows[0]?.fix || criterionFixHint(criterion)
      });
    }
  }

  const normalizedByCriterion = CRITERION_ORDER
    .filter((criterion) => criterionMap.has(criterion))
    .map((criterion) => criterionMap.get(criterion));

  return {
    summary: summary || fallback.summary,
    byCriterion: normalizedByCriterion.length > 0 ? normalizedByCriterion : fallback.byCriterion,
    improvements: improvements.length > 0 ? improvements : fallback.improvements
  };
}

function buildAiPrompt({ currentBand, targetBand, essayObj, weaknesses, strengths, allowedRefsSet, languageEvidenceSnapshot = '' }) {
  const weaknessLines = weaknesses.map((w, idx) => {
    const refs = (w.evidenceRefs || []).join(', ') || '(none)';
    const evidenceLines = (w.evidenceSnippets || []).length
      ? w.evidenceSnippets.map((line) => `    - ${line}`).join('\n')
      : '    - (no direct evidence lines provided)';
    return [
      `${idx + 1}) [${w.criterion}] (${w.baseKey}) ${getRowQuestionText(w, 'Detected weakness in this criterion.')}`,
      `   Detected: ${w.value}`,
      `   EvidenceRefs: ${refs}`,
      `   EvidenceLines:`,
      evidenceLines
    ].join('\n');
  }).join('\n');

  const strengthLines = strengths.map((s) => `- [${s.criterion}] ${getRowQuestionText(s, 'Positive performance signal')}`).join('\n') || '(none)';
  const allowedRefs = Array.from(allowedRefsSet).filter((x) => /^S\d+$/.test(x)).sort((a, b) => {
    const ai = Number(a.slice(1));
    const bi = Number(b.slice(1));
    return ai - bi;
  }).join(', ') || '(none)';

  return `
You are a senior IELTS examiner.

Generate criterion-structured, evidence-grounded feedback.

Current overall band: ${currentBand}
Target band: ${targetBand}

Rules:
- Only use evidence references from this allowed list: ${allowedRefs}
- Output evidenceRefs as an array of S# labels only (example: ["S3","S8"]).
- If no direct evidence exists for an item, use an empty array [] and keep the fix actionable.
- Do not output markdown.

Essay context (do not quote unless the line appears in EvidenceLines):
${essayObj?.normalizedText || ''}

Language evidence snapshot from Step 3 (use as supporting diagnostic context, not as direct quote):
${languageEvidenceSnapshot || '(not available)'}

Prioritized weaknesses:
${weaknessLines || '(none)'}

Detected strengths:
${strengthLines}

Return strict JSON:
{
  "summary": "Two concise sentences.",
  "byCriterion": [
    {
      "criterion": "TR|CC|LR|GRA|General",
      "summary": "Main diagnosis for this criterion.",
      "evidenceRefs": ["S1", "S3"],
      "fix": "Highest-priority correction strategy."
    }
  ],
  "improvements": [
    {
      "criterion": "TR|CC|LR|GRA|General",
      "issue": "Specific issue to fix.",
      "evidenceRefs": ["S2"],
      "fix": "Concrete correction action."
    }
  ]
}
`.trim();
}

function renderTemplateContent(templateContent, context = {}) {
  return String(templateContent || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = context[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

const step5FeedbackService = {
  generateFeedback: async (essayObj, gradingResult, options = {}) => {
    const currentBand = toSafeBand(gradingResult?.overallBand, 0);
    const targetBand = Math.min(9, Math.ceil(currentBand + 0.5));

    const fromBand = Math.max(1, Math.floor(currentBand));
    const toBand = Math.max(fromBand, targetBand);

    const rows = getFeedbackSourceRows(gradingResult);
    const scopedRows = rows.filter((r) => {
      const band = toSafeBand(r?.band, 0);
      return band >= fromBand && band <= toBand;
    });
    const workingRows = scopedRows.length > 0 ? scopedRows : rows;

    const weaknesses = workingRows
      .filter((r) => isWeakResult(r))
      .map((r) => {
        const criterion = normalizeCriterion(r.criterion);
        const baseKey = toCleanText(r.baseKey || r.question_key || r.instanceKey, `${criterion}-item`);
        const questionText = getRowQuestionText(r, 'Detected weakness in this criterion.');
        const value = toCleanText(r.value, 'NA');
        const evidenceSentenceIndices = Array.isArray(r.evidenceSentenceIndices) ? r.evidenceSentenceIndices : [];
        const evidenceRefs = extractEvidenceRefs(essayObj, evidenceSentenceIndices, 6);
        const evidenceSnippets = buildEvidenceSnippets(essayObj, evidenceSentenceIndices, 3);
        return {
          criterion,
          baseKey,
          questionText,
          atomicQuestion: questionText,
          atomic_question: questionText,
          value,
          evidenceSentenceIndices,
          evidenceRefs,
          evidenceSnippets,
          priority: scoreWeaknessPriority(r)
        };
      })
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 10);

    const strengths = workingRows
      .filter((r) => !isWeakResult(r))
      .map((r) => ({
        criterion: normalizeCriterion(r.criterion),
        questionText: getRowQuestionText(r, 'Positive performance signal'),
        atomicQuestion: getRowQuestionText(r, 'Positive performance signal'),
        atomic_question: getRowQuestionText(r, 'Positive performance signal')
      }))
      .slice(0, 5);

    const deterministicFallback = buildDeterministicFallback(currentBand, targetBand, weaknesses, strengths);
    const allowedRefsSet = collectAllowedEvidenceRefs(essayObj, workingRows);
    const languageEvidenceSnapshot = buildLanguageEvidenceSnapshot(gradingResult);

    const prompt = buildAiPrompt({
      currentBand,
      targetBand,
      essayObj,
      weaknesses,
      strengths,
      allowedRefsSet,
      languageEvidenceSnapshot
    });
    const promptSource = String(options?.promptSource || '').trim().toLowerCase();
    const promptTemplateContent = String(options?.promptTemplateContent || '').trim();
    const customPrompt = String(options?.customPrompt || '').trim();
    const selectedModelId = String(options?.modelId || '').trim() || null;
    const requestingUser = options?.requestingUser || null;
    const providerId = options?.providerId || null;
    const apiProviderId = options?.apiProviderId || null;
    const abortSignal = options?.abortSignal || null;
    const templateBase = customPrompt || promptTemplateContent;
    const allowedRefs = Array.from(allowedRefsSet || []).sort();
    const templatePrompt = renderTemplateContent(templateBase, {
      current_band: String(currentBand),
      target_band: String(targetBand),
      allowed_refs: allowedRefs.join(', '),
      essay_text: String(essayObj?.normalizedText || ''),
      weakness_lines: weaknesses.map((w, idx) => {
        const refs = (w.evidenceRefs || []).join(', ') || '(none)';
        return `${idx + 1}) [${w.criterion}] (${w.baseKey}) ${getRowQuestionText(w, 'Detected weakness in this criterion.')}\n   Detected: ${w.value}\n   EvidenceRefs: ${refs}`;
      }).join('\n'),
      strength_lines: strengths.map((s) => `- [${s.criterion}] ${getRowQuestionText(s, 'Positive performance signal')}`).join('\n') || '(none)',
      language_evidence_snapshot: languageEvidenceSnapshot || '(not available)'
    }).trim();
    const finalPrompt = (promptSource === 'template' && templatePrompt) ? templatePrompt : prompt;

    let aiParsed = null;
    let modelUsed = null;
    let fromFallback = true;
    let aiUsage = null;
    let aiRequestMeta = null;
    const aiTimeoutMs = Number(options?.aiTimeoutMs) > 0 ? Number(options.aiTimeoutMs) : 45000;

    try {
      const aiResult = await aiService.sendMessage(
        [{ role: 'user', content: finalPrompt }],
        selectedModelId,
        {
          temperature: 0,
          topP: 1,
          topK: 1,
          candidateCount: 1,
          responseMimeType: 'application/json',
          timeoutMs: aiTimeoutMs,
          requestLabel: 'ielts.step5.feedback',
          requestingUser,
          providerId,
          apiProviderId,
          abortSignal
        }
      );
      modelUsed = aiResult?.modelUsed || null;
      aiUsage = aiResult?.usage || null;
      aiRequestMeta = aiResult?.requestMeta || null;
      aiParsed = parseAiJson(aiResult?.text || '');
      fromFallback = false;
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error;
      }
      console.warn('[Step 5] AI feedback generation fell back to deterministic output:', error.message);
    }

    const sanitized = sanitizeFeedbackShape(aiParsed, deterministicFallback, allowedRefsSet);

    return {
      summary: sanitized.summary,
      byCriterion: sanitized.byCriterion,
      improvements: sanitized.improvements,
      strengths: deterministicFallback.strengths,
      meta: {
        schemaVersion: 'step5-feedback.v0225',
        modelUsed,
        fromFallback,
        promptSource: promptSource === 'template' ? 'template' : 'builtin',
        aiUsage,
        aiRequestMeta,
        generatedAt: new Date().toISOString(),
        currentBand,
        targetBand
      }
    };
  },

  previewFeedbackPrompt: async (essayObj, gradingResult, options = {}) => {
    const currentBand = toSafeBand(gradingResult?.overallBand, 0);
    const targetBand = Math.min(9, Math.max(currentBand + 0.5, currentBand));
    const sourceRows = getFeedbackSourceRows(gradingResult);
    const allowedRefsSet = collectAllowedEvidenceRefs(essayObj, sourceRows);
    const workingRows = sourceRows.map((row) => {
      const criterion = normalizeCriterion(row?.criterion);
      const value = toCleanText(row?.value, 'N/A');
      const evidenceSentenceIndices = Array.isArray(row?.evidenceSentenceIndices)
        ? row.evidenceSentenceIndices.filter((n) => Number.isInteger(n))
        : [];
      const evidenceRefs = extractEvidenceRefs(essayObj, evidenceSentenceIndices, 6);
      const evidenceSnippets = buildEvidenceSnippets(essayObj, evidenceSentenceIndices, 3);
      return {
        ...row,
        criterion,
        questionText: getRowQuestionText(row, 'Detected weakness in this criterion.'),
        value,
        evidenceSentenceIndices,
        evidenceRefs,
        evidenceSnippets,
        priority: scoreWeaknessPriority(row)
      };
    });
    const weaknesses = workingRows
      .filter((r) => isWeakResult(r))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 10);
    const strengths = workingRows
      .filter((r) => !isWeakResult(r))
      .map((r) => ({
        criterion: normalizeCriterion(r.criterion),
        questionText: getRowQuestionText(r, 'Positive performance signal'),
        atomicQuestion: getRowQuestionText(r, 'Positive performance signal'),
        atomic_question: getRowQuestionText(r, 'Positive performance signal')
      }))
      .slice(0, 5);
    const prompt = buildAiPrompt({
      currentBand,
      targetBand,
      essayObj,
      weaknesses,
      strengths,
      allowedRefsSet,
      languageEvidenceSnapshot: buildLanguageEvidenceSnapshot(gradingResult)
    });
    const promptSource = String(options?.promptSource || '').trim().toLowerCase();
    const promptTemplateContent = String(options?.promptTemplateContent || '').trim();
    const customPrompt = String(options?.customPrompt || '').trim();
    const templateBase = customPrompt || promptTemplateContent;
    const allowedRefs = Array.from(allowedRefsSet || []).sort();
    const templatePrompt = renderTemplateContent(templateBase, {
      current_band: String(currentBand),
      target_band: String(targetBand),
      allowed_refs: allowedRefs.join(', '),
      essay_text: String(essayObj?.normalizedText || ''),
      weakness_lines: weaknesses.map((w, idx) => {
        const refs = (w.evidenceRefs || []).join(', ') || '(none)';
        return `${idx + 1}) [${w.criterion}] (${w.baseKey}) ${getRowQuestionText(w, 'Detected weakness in this criterion.')}\n   Detected: ${w.value}\n   EvidenceRefs: ${refs}`;
      }).join('\n'),
      strength_lines: strengths.map((s) => `- [${s.criterion}] ${getRowQuestionText(s, 'Positive performance signal')}`).join('\n') || '(none)',
      language_evidence_snapshot: buildLanguageEvidenceSnapshot(gradingResult) || '(not available)'
    }).trim();
    const finalPrompt = (promptSource === 'template' && templatePrompt) ? templatePrompt : prompt;
    return {
      prompt: finalPrompt,
      promptSource: promptSource === 'template' ? 'template' : 'builtin',
      currentBand,
      targetBand,
      weaknessCount: weaknesses.length
    };
  }
};

module.exports = step5FeedbackService;
