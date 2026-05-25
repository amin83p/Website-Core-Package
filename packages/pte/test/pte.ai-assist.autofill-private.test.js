const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');

const aiAutofillService = require('../MVC/services/pte/questionBankAiAutofillService');

const {
  parseAiSuggestionPayload,
  getMissingTargets,
  resolveAbsoluteMediaPath,
  resolveMediaPathCandidates,
  resolveDetachedMediaPathByRef
} = aiAutofillService._private;

const TARGET_FIELDS = Object.freeze([
  { scope: 'payload', key: 'role' },
  { scope: 'payload', key: 'targetFunction' },
  { scope: 'payload', key: 'expectedKeyPoints' },
  { scope: 'payload', key: 'prepTimeSeconds' },
  { scope: 'scoring', key: 'traitWeights' },
  { scope: 'scoring', key: 'contentCoverageMin' },
  { scope: 'scoring', key: 'idealWpmMin' },
  { scope: 'scoring', key: 'idealWpmMax' }
]);

const TARGET_FIELDS_READ_ALOUD = Object.freeze([
  { scope: 'payload', key: 'referenceTranscript' },
  { scope: 'payload', key: 'pronunciationNotes' },
  { scope: 'payload', key: 'prepTimeSeconds' },
  { scope: 'payload', key: 'responseTimeSeconds' },
  { scope: 'scoring', key: 'method' },
  { scope: 'scoring', key: 'scorerVersion' },
  { scope: 'scoring', key: 'maxScoreMode' },
  { scope: 'scoring', key: 'maxScore' },
  { scope: 'scoring', key: 'traits' },
  { scope: 'scoring', key: 'contentScoringMode' },
  { scope: 'scoring', key: 'pronunciationMax' },
  { scope: 'scoring', key: 'fluencyMax' },
  { scope: 'scoring', key: 'idealWpmMin' },
  { scope: 'scoring', key: 'idealWpmMax' },
  { scope: 'scoring', key: 'longPauseSeconds' },
  { scope: 'scoring', key: 'minAnalysisConfidence' }
]);

const TARGET_FIELDS_REPEAT_SENTENCE = Object.freeze([
  { scope: 'payload', key: 'expectedTranscript' },
  { scope: 'payload', key: 'transcriptVariants' },
  { scope: 'payload', key: 'responseTimeSeconds' },
  { scope: 'scoring', key: 'method' },
  { scope: 'scoring', key: 'maxScore' },
  { scope: 'scoring', key: 'traits' }
]);

const TARGET_FIELDS_DESCRIBE_IMAGE = Object.freeze([
  { scope: 'payload', key: 'imageCaption' },
  { scope: 'payload', key: 'expectedKeyPoints' },
  { scope: 'payload', key: 'chartType' },
  { scope: 'payload', key: 'prepTimeSeconds' },
  { scope: 'payload', key: 'responseTimeSeconds' },
  { scope: 'scoring', key: 'method' },
  { scope: 'scoring', key: 'scorerVersion' },
  { scope: 'scoring', key: 'maxScore' },
  { scope: 'scoring', key: 'traits' },
  { scope: 'scoring', key: 'traitWeights' },
  { scope: 'scoring', key: 'contentMax' },
  { scope: 'scoring', key: 'pronunciationMax' },
  { scope: 'scoring', key: 'fluencyMax' },
  { scope: 'scoring', key: 'contentCoverageMin' },
  { scope: 'scoring', key: 'minResponseSeconds' },
  { scope: 'scoring', key: 'idealWpmMin' },
  { scope: 'scoring', key: 'idealWpmMax' },
  { scope: 'scoring', key: 'longPauseSeconds' },
  { scope: 'scoring', key: 'offTopicPenalty' },
  { scope: 'scoring', key: 'minAnalysisConfidence' }
]);

const TARGET_FIELDS_LISTENING_MCQ_SINGLE = Object.freeze([
  { scope: 'payload', key: 'transcript' },
  { scope: 'payload', key: 'stem' },
  { scope: 'payload', key: 'options' },
  { scope: 'payload', key: 'correctOptionKey' },
  { scope: 'payload', key: 'allowReplay' },
  { scope: 'payload', key: 'explanation' },
  { scope: 'scoring', key: 'method' },
  { scope: 'scoring', key: 'maxScore' }
]);

const TARGET_FIELDS_LISTENING_MCQ_MULTIPLE = Object.freeze([
  { scope: 'payload', key: 'transcript' },
  { scope: 'payload', key: 'stem' },
  { scope: 'payload', key: 'options' },
  { scope: 'payload', key: 'correctOptionKeys' },
  { scope: 'payload', key: 'partialCreditEnabled' },
  { scope: 'payload', key: 'allowReplay' },
  { scope: 'payload', key: 'explanation' },
  { scope: 'scoring', key: 'method' },
  { scope: 'scoring', key: 'maxScore' },
  { scope: 'scoring', key: 'partialCreditEnabled' }
]);

const TARGET_FIELDS_READING_MCQ_MULTIPLE = Object.freeze([
  { scope: 'payload', key: 'passageTitle' },
  { scope: 'payload', key: 'options' },
  { scope: 'payload', key: 'correctOptionKeys' },
  { scope: 'payload', key: 'explanation' },
  { scope: 'scoring', key: 'method' },
  { scope: 'scoring', key: 'maxScore' }
]);

const TARGET_FIELDS_LISTENING_FILL_IN_BLANK = Object.freeze([
  { scope: 'payload', key: 'transcriptWithBlanks' },
  { scope: 'payload', key: 'blankAnswerMap' },
  { scope: 'payload', key: 'allowReplay' },
  { scope: 'payload', key: 'caseSensitive' },
  { scope: 'payload', key: 'explanation' },
  { scope: 'scoring', key: 'method' },
  { scope: 'scoring', key: 'maxScore' },
  { scope: 'scoring', key: 'perBlankScore' }
]);

const TARGET_FIELDS_READING_FILL_IN_BLANK = Object.freeze([
  { scope: 'payload', key: 'sourcePassage' },
  { scope: 'payload', key: 'passageWithBlanks' },
  { scope: 'payload', key: 'blankAnswerMap' },
  { scope: 'payload', key: 'bankOptions' },
  { scope: 'payload', key: 'caseSensitive' },
  { scope: 'payload', key: 'allowSynonyms' },
  { scope: 'payload', key: 'explanation' },
  { scope: 'scoring', key: 'method' },
  { scope: 'scoring', key: 'maxScore' },
  { scope: 'scoring', key: 'perBlankScore' }
]);

const TARGET_FIELDS_READING_WRITING_FILL_IN_BLANK = Object.freeze([
  { scope: 'payload', key: 'passageTitle' },
  { scope: 'payload', key: 'blankOptionsMap' },
  { scope: 'payload', key: 'caseSensitive' },
  { scope: 'payload', key: 'explanation' },
  { scope: 'scoring', key: 'method' },
  { scope: 'scoring', key: 'maxScore' },
  { scope: 'scoring', key: 'perBlankScore' }
]);

const TARGET_FIELDS_READING_REORDER = Object.freeze([
  { scope: 'payload', key: 'passageTitle' },
  { scope: 'payload', key: 'paragraphItems' },
  { scope: 'payload', key: 'correctOrder' },
  { scope: 'payload', key: 'explanation' },
  { scope: 'scoring', key: 'method' },
  { scope: 'scoring', key: 'maxScore' },
  { scope: 'scoring', key: 'partialCreditEnabled' }
]);

const TARGET_FIELDS_LISTENING_DICTATION = Object.freeze([
  { scope: 'payload', key: 'expectedTranscript' },
  { scope: 'payload', key: 'transcriptVariants' },
  { scope: 'payload', key: 'allowReplay' },
  { scope: 'payload', key: 'normalizationRules' },
  { scope: 'scoring', key: 'method' },
  { scope: 'scoring', key: 'maxScore' },
  { scope: 'scoring', key: 'perWordScore' }
]);

test('parseAiSuggestionPayload keeps only contract fields and emits warnings for unknown keys', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        role: 'friend',
        targetFunction: 'decline politely',
        expectedKeyPoints: ['Acknowledge', 'Give reason'],
        prepTimeSeconds: 27,
        unexpectedPayloadField: 'drop-me'
      },
      scoring: {
        traitWeights: { appropriacy: 0.7, pronunciation: 0.1, fluency: 0.2 },
        contentCoverageMin: 0.7,
        idealWpmMin: 95,
        idealWpmMax: 145,
        unexpectedScoringField: 123
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS, 'speaking_respond_to_situation');
  assert.equal(result.suggestions.payload.role, 'friend');
  assert.equal(result.suggestions.scoring.contentCoverageMin, 0.7);
  assert.equal(Object.prototype.hasOwnProperty.call(result.suggestions.payload, 'unexpectedPayloadField'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.suggestions.scoring, 'unexpectedScoringField'), false);
  assert.equal(
    Array.isArray(result.warnings) && result.warnings.some((row) => String(row).includes('Dropped unsupported AI fields')),
    true
  );
});

test('parseAiSuggestionPayload recovers partial suggestions from malformed JSON', () => {
  const malformed = '{ "suggestions": { "payload": { "role": "friend", "targetFunction": "decline", "expectedKeyPoints": ["say no", "reason"], "prepTimeSeconds": 29 }, "scoring": { "traitWeights": {"appropriacy": 0.6, "pronunciation": 0.2, "fluency": 0.2}, "contentCoverageMin": 0.65, "idealWpmMin": 100, "idealWpmMax": 150 }';
  const result = parseAiSuggestionPayload(malformed, TARGET_FIELDS, 'speaking_respond_to_situation');

  assert.equal(result.suggestions.payload.role, 'friend');
  assert.equal(Array.isArray(result.suggestions.payload.expectedKeyPoints), true);
  assert.equal(
    result.suggestions.scoring.contentCoverageMin === undefined
      || typeof result.suggestions.scoring.contentCoverageMin === 'number',
    true
  );
  assert.equal(result.suggestions.payload.targetFunction, 'decline');
});

test('getMissingTargets reports unresolved scoped keys', () => {
  const missing = getMissingTargets(TARGET_FIELDS, {
    payload: { role: 'candidate' },
    scoring: { contentCoverageMin: 0.6 }
  });
  assert.equal(missing.some((row) => row.scope === 'payload' && row.key === 'targetFunction'), true);
  assert.equal(missing.some((row) => row.scope === 'scoring' && row.key === 'traitWeights'), true);
});

test('resolveMediaPathCandidates maps web-root upload paths across configured upload roots', () => {
  const candidates = resolveMediaPathCandidates({
    path: '/uploads/pte/questions-bank/chart.webp',
    url: 'http://localhost:3000/uploads/pte/questions-bank/chart.webp?cache=1'
  });
  assert.equal(candidates.includes(path.resolve(process.cwd(), 'uploads/pte/questions-bank/chart.webp')), true);
  assert.equal(candidates.includes(path.resolve(process.cwd(), '../uploads/pte/questions-bank/chart.webp')), true);
  assert.equal(resolveAbsoluteMediaPath({ path: '/uploads/pte/questions-bank/chart.webp' }), candidates[0]);
});

test('resolveDetachedMediaPathByRef resolves filename-only audio references from org pte-question-bank folders', async () => {
  const fileName = `tmp-ai-assist-audio-${Date.now()}.wav`;
  const folderPath = path.resolve(process.cwd(), 'uploads', 'ORG_TEST_AUTOFILL', 'pte-question-bank');
  const filePath = path.resolve(folderPath, fileName);

  await fs.mkdir(folderPath, { recursive: true });
  await fs.writeFile(filePath, Buffer.from('RIFF', 'utf8'));

  try {
    const resolved = await resolveDetachedMediaPathByRef(fileName);
    assert.equal(String(resolved).toLowerCase(), String(filePath).toLowerCase());
  } finally {
    await fs.rm(path.resolve(process.cwd(), 'uploads', 'ORG_TEST_AUTOFILL'), { recursive: true, force: true });
  }
});

test('parseAiSuggestionPayload keeps read-aloud scoring fields (method/maxScore/traits)', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        referenceTranscript: 'Read with steady pacing and accurate sentence flow.',
        pronunciationNotes: 'Stress content words and keep sentence-final intonation natural.',
        prepTimeSeconds: 28,
        responseTimeSeconds: 42
      },
      scoring: {
        method: 'hybrid_ai_audio',
        scorerVersion: 'pte-read-aloud-v1',
        maxScoreMode: 'dynamic_source_word_count_plus_traits',
        maxScore: 5,
        traits: ['content', 'pronunciation', 'fluency'],
        contentScoringMode: 'word_alignment_errors',
        pronunciationMax: 5,
        fluencyMax: 5,
        idealWpmMin: 90,
        idealWpmMax: 160,
        longPauseSeconds: 2,
        minAnalysisConfidence: 0.35
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_READ_ALOUD, 'speaking_read_aloud');
  assert.equal(result.suggestions.scoring.method, 'hybrid_ai_audio');
  assert.equal(result.suggestions.scoring.scorerVersion, 'pte-read-aloud-v1');
  assert.equal(result.suggestions.scoring.maxScoreMode, 'dynamic_source_word_count_plus_traits');
  assert.equal(result.suggestions.scoring.maxScore, 5);
  assert.deepEqual(result.suggestions.scoring.traits, ['content', 'pronunciation', 'fluency']);
  assert.equal(result.suggestions.scoring.contentScoringMode, 'word_alignment_errors');
  assert.equal(result.suggestions.scoring.pronunciationMax, 5);
  assert.equal(result.suggestions.scoring.fluencyMax, 5);
});

test('parseAiSuggestionPayload keeps repeat-sentence transcriptVariants and response timing', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        expectedTranscript: 'The lecture was postponed due to severe weather conditions.',
        transcriptVariants: [
          'The lecture was postponed because of severe weather conditions.',
          'Due to severe weather conditions, the lecture was postponed.'
        ],
        responseTimeSeconds: 20
      },
      scoring: {
        method: 'hybrid_ai_audio',
        maxScore: 5,
        traits: ['content', 'pronunciation', 'fluency']
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_REPEAT_SENTENCE, 'speaking_repeat_sentence');
  assert.equal(result.suggestions.payload.expectedTranscript.includes('lecture was postponed'), true);
  assert.equal(Array.isArray(result.suggestions.payload.transcriptVariants), true);
  assert.equal(result.suggestions.payload.transcriptVariants.length >= 1, true);
  assert.equal(result.suggestions.payload.responseTimeSeconds, 20);
  assert.equal(result.suggestions.scoring.method, 'hybrid_ai_audio');
});

test('parseAiSuggestionPayload keeps Describe Image v1 scoring contract fields', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        imageCaption: 'A line chart showing sales increasing from 2020 to 2024.',
        expectedKeyPoints: ['Sales rise over time', '2024 is the highest point'],
        chartType: 'line_chart',
        prepTimeSeconds: 25,
        responseTimeSeconds: 40
      },
      scoring: {
        method: 'hybrid_ai_audio',
        scorerVersion: 'old',
        maxScore: 5,
        traits: ['content', 'fluency'],
        traitWeights: { content: 0.5, pronunciation: 0.25, fluency: 0.25 },
        contentMax: 6,
        pronunciationMax: 5,
        fluencyMax: 5,
        contentCoverageMin: 0.6,
        minResponseSeconds: 20,
        idealWpmMin: 90,
        idealWpmMax: 160,
        longPauseSeconds: 2,
        offTopicPenalty: 0.2,
        minAnalysisConfidence: 0.35
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_DESCRIBE_IMAGE, 'speaking_describe_image', {
    describeImageVisualEvidence: true
  });
  assert.equal(result.suggestions.scoring.method, 'hybrid_ai_audio_visual');
  assert.equal(result.suggestions.scoring.scorerVersion, 'pte-describe-image-v1');
  assert.equal(result.suggestions.scoring.maxScore, 15);
  assert.deepEqual(result.suggestions.scoring.traits, ['content', 'pronunciation', 'fluency']);
  assert.equal(result.suggestions.scoring.contentMax, 5);
  assert.equal(result.suggestions.scoring.pronunciationMax, 5);
  assert.equal(result.suggestions.scoring.fluencyMax, 5);
});

test('parseAiSuggestionPayload drops Describe Image visual suggestions without reliable evidence', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        imageCaption: 'A pie chart showing website traffic sources by percentage.',
        expectedKeyPoints: ['Direct traffic is 35%.', 'Organic search is 25%.'],
        chartType: 'pie_chart',
        prepTimeSeconds: 25,
        responseTimeSeconds: 40
      },
      scoring: {
        method: 'hybrid_ai_audio_visual',
        scorerVersion: 'pte-describe-image-v1',
        maxScore: 15,
        traits: ['content', 'pronunciation', 'fluency'],
        traitWeights: { content: 0.5, pronunciation: 0.25, fluency: 0.25 },
        contentMax: 5,
        pronunciationMax: 5,
        fluencyMax: 5,
        contentCoverageMin: 0.6,
        minResponseSeconds: 20,
        idealWpmMin: 90,
        idealWpmMax: 160,
        longPauseSeconds: 2,
        offTopicPenalty: 0.2,
        minAnalysisConfidence: 0.35
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_DESCRIBE_IMAGE, 'speaking_describe_image');
  assert.equal(Object.prototype.hasOwnProperty.call(result.suggestions.payload, 'imageCaption'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.suggestions.payload, 'expectedKeyPoints'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.suggestions.payload, 'chartType'), false);
  assert.equal(result.suggestions.payload.prepTimeSeconds, 25);
  assert.equal(result.suggestions.scoring.maxScore, 15);
  assert.equal(
    result.warnings.some((row) => String(row).includes('Dropped Describe Image visual suggestion')),
    true
  );
});

test('parseAiSuggestionPayload keeps listening mcq single structured options and boolean flags', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        transcript: 'The speaker explains that regular sleep improves memory retention.',
        stem: 'What is the central claim in the audio?',
        options: [
          { key: 'A', text: 'Sleep has no effect on memory retention.' },
          { key: 'B', text: 'Regular sleep can improve memory retention.' },
          { key: 'C', text: 'Memory depends only on diet.' }
        ],
        correctOptionKey: 'B',
        allowReplay: true,
        explanation: 'Option B directly reflects the speaker’s main point.'
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_LISTENING_MCQ_SINGLE, 'listening_mcq_single');
  assert.equal(Array.isArray(result.suggestions.payload.options), true);
  assert.equal(result.suggestions.payload.options.length >= 2, true);
  assert.equal(result.suggestions.payload.correctOptionKey, 'B');
  assert.equal(result.suggestions.payload.allowReplay, true);
  assert.equal(result.suggestions.scoring.method, 'auto_objective');
  assert.equal(result.suggestions.scoring.maxScore, 1);
});

test('parseAiSuggestionPayload fixes listening mcq single correctOptionKey when it does not match options', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        stem: 'Which statement best summarizes the lecture?',
        options: [
          { key: 'A', text: 'It focuses on renewable energy policy.' },
          { key: 'B', text: 'It focuses on marine biodiversity.' }
        ],
        correctOptionKey: 'Z'
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_LISTENING_MCQ_SINGLE, 'listening_mcq_single');
  assert.equal(['A', 'B'].includes(String(result.suggestions.payload.correctOptionKey || '')), true);
  assert.equal(
    Array.isArray(result.warnings) && result.warnings.some((row) => String(row).includes('correctOptionKey did not match options')),
    true
  );
});

test('parseAiSuggestionPayload fallback correctOptionKey is not constant first-option across different MCQ prompts', () => {
  const pickedKeys = new Set();
  for (let i = 1; i <= 12; i += 1) {
    const raw = JSON.stringify({
      suggestions: {
        payload: {
          stem: `Prompt variant ${i}`,
          options: [
            { key: 'A', text: 'Option A' },
            { key: 'B', text: 'Option B' },
            { key: 'C', text: 'Option C' },
            { key: 'D', text: 'Option D' }
          ],
          correctOptionKey: 'INVALID'
        },
        scoring: {
          method: 'auto_objective',
          maxScore: 1
        }
      }
    });
    const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_LISTENING_MCQ_SINGLE, 'listening_mcq_single');
    const picked = String(result?.suggestions?.payload?.correctOptionKey || '');
    assert.equal(['A', 'B', 'C', 'D'].includes(picked), true);
    pickedKeys.add(picked);
  }
  assert.equal(pickedKeys.size > 1, true);
});

test('parseAiSuggestionPayload keeps listening mcq multiple structured options and multi-answer keys', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        transcript: 'The speaker recommends two study habits and rejects one myth.',
        stem: 'Which TWO recommendations are supported by the speaker?',
        options: [
          { key: 'A', text: 'Review notes in short sessions.' },
          { key: 'B', text: 'Study only once a month.' },
          { key: 'C', text: 'Test yourself regularly.' },
          { key: 'D', text: 'Avoid all group discussion.' }
        ],
        correctOptionKeys: ['A', 'C'],
        partialCreditEnabled: true,
        allowReplay: false,
        explanation: 'A and C align with the speaker recommendations.'
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1,
        partialCreditEnabled: true
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_LISTENING_MCQ_MULTIPLE, 'listening_mcq_multiple');
  assert.equal(Array.isArray(result.suggestions.payload.options), true);
  assert.equal(result.suggestions.payload.options.length >= 2, true);
  assert.deepEqual(result.suggestions.payload.correctOptionKeys, ['A', 'C']);
  assert.equal(result.suggestions.payload.partialCreditEnabled, true);
  assert.equal(result.suggestions.scoring.partialCreditEnabled, true);
});

test('parseAiSuggestionPayload redistributes listening mcq multiple leading sequential correct keys', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        stem: 'Which TWO recommendations are supported by the speaker?',
        options: [
          { key: 'A', text: 'Supported idea option A' },
          { key: 'B', text: 'Supported idea option B' },
          { key: 'C', text: 'Supported idea option C' },
          { key: 'D', text: 'Supported idea option D' }
        ],
        correctOptionKeys: ['A', 'B']
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_LISTENING_MCQ_MULTIPLE, 'listening_mcq_multiple');
  const picked = Array.isArray(result?.suggestions?.payload?.correctOptionKeys)
    ? result.suggestions.payload.correctOptionKeys
    : [];
  assert.equal(picked.length >= 2, true);
  assert.notDeepEqual(picked.slice(0, 2), ['A', 'B']);
  assert.equal(
    Array.isArray(result.warnings) && result.warnings.some((row) => String(row).includes('sequential')),
    true
  );
});

test('parseAiSuggestionPayload fixes listening mcq multiple correctOptionKeys when invalid/missing', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        stem: 'Which TWO points are correct?',
        options: [
          { key: 'A', text: 'Point A' },
          { key: 'B', text: 'Point B' },
          { key: 'C', text: 'Point C' },
          { key: 'D', text: 'Point D' }
        ],
        correctOptionKeys: ['Z']
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_LISTENING_MCQ_MULTIPLE, 'listening_mcq_multiple');
  const picked = Array.isArray(result.suggestions.payload.correctOptionKeys)
    ? result.suggestions.payload.correctOptionKeys
    : [];
  assert.equal(picked.length >= 2, true);
  assert.equal(picked.every((key) => ['A', 'B', 'C', 'D'].includes(String(key || ''))), true);
  assert.equal(
    Array.isArray(result.warnings) && result.warnings.some((row) => String(row).includes('correctOptionKeys')),
    true
  );
});

test('parseAiSuggestionPayload fallback correctOptionKeys are distributed instead of contiguous A/B-style picks', () => {
  const optionKeys = ['A', 'B', 'C', 'D', 'E'];
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        stem: 'Select two valid statements from the lecture.',
        options: optionKeys.map((key) => ({ key, text: `Option ${key}` })),
        correctOptionKeys: ['INVALID_KEY']
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_LISTENING_MCQ_MULTIPLE, 'listening_mcq_multiple');
  const picked = Array.isArray(result?.suggestions?.payload?.correctOptionKeys)
    ? result.suggestions.payload.correctOptionKeys
    : [];

  assert.equal(picked.length >= 2, true);
  const firstIndex = optionKeys.indexOf(String(picked[0] || ''));
  const secondIndex = optionKeys.indexOf(String(picked[1] || ''));
  assert.equal(firstIndex >= 0 && secondIndex >= 0, true);
  const forwardDistance = (secondIndex - firstIndex + optionKeys.length) % optionKeys.length;
  assert.notEqual(forwardDistance, 1);
});

test('parseAiSuggestionPayload fixes reading mcq multiple correctOptionKeys when invalid/missing', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        passageTitle: 'Urban Farming',
        options: [
          { key: 'A', text: 'It always lowers food costs for all cities.' },
          { key: 'B', text: 'It can shorten supply chains in some areas.' },
          { key: 'C', text: 'It removes the need for transport entirely.' },
          { key: 'D', text: 'It may improve access to fresh produce locally.' }
        ],
        correctOptionKeys: ['Z']
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_READING_MCQ_MULTIPLE, 'reading_mcq_multiple');
  const picked = Array.isArray(result?.suggestions?.payload?.correctOptionKeys)
    ? result.suggestions.payload.correctOptionKeys
    : [];
  assert.equal(picked.length >= 2, true);
  assert.equal(picked.every((key) => ['A', 'B', 'C', 'D'].includes(String(key || ''))), true);
  assert.equal(result?.suggestions?.scoring?.method, 'auto_objective');
  assert.equal(result?.suggestions?.scoring?.maxScore, 1);
  assert.equal(result?.suggestions?.payload?.partialCreditEnabled, undefined);
  assert.equal(result?.suggestions?.scoring?.partialCreditEnabled, undefined);
  assert.equal(
    Array.isArray(result.warnings) && result.warnings.some((row) => String(row).includes('correctOptionKeys')),
    true
  );
});

test('parseAiSuggestionPayload keeps listening fill in blank payload+scoring fields', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        transcriptWithBlanks: 'Students should review {{1}} after each lecture to improve {{2}}.',
        blankAnswerMap: {
          '{{1}}': 'notes',
          '{{2}}': 'retention'
        },
        allowReplay: false,
        caseSensitive: true,
        explanation: 'Answers must match the removed words from the transcript.'
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1,
        perBlankScore: 0.5
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_LISTENING_FILL_IN_BLANK, 'listening_fill_in_blank');
  assert.equal(String(result?.suggestions?.payload?.transcriptWithBlanks || '').includes('{{1}}'), true);
  assert.deepEqual(result?.suggestions?.payload?.blankAnswerMap, { '{{1}}': 'notes', '{{2}}': 'retention' });
  assert.equal(result?.suggestions?.payload?.caseSensitive, true);
  assert.equal(result?.suggestions?.scoring?.perBlankScore, 0.5);
});

test('parseAiSuggestionPayload normalizes wrapped blanks into sequential placeholders', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        transcriptWithBlanks: 'Students should review {{7}}notes{{7}} after each lecture to improve {{11}}retention{{11}}.',
        blankAnswerMap: {}
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1,
        perBlankScore: 1
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_LISTENING_FILL_IN_BLANK, 'listening_fill_in_blank');
  assert.equal(result?.suggestions?.payload?.transcriptWithBlanks, 'Students should review {{1}} after each lecture to improve {{2}}.');
  assert.deepEqual(result?.suggestions?.payload?.blankAnswerMap, { '{{1}}': 'notes', '{{2}}': 'retention' });
  assert.equal(
    Array.isArray(result.warnings) && result.warnings.some((row) => String(row).toLowerCase().includes('wrapped blank markers')),
    true
  );
});

test('parseAiSuggestionPayload keeps transcript-first flow when transcript has no placeholders', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        transcriptWithBlanks: 'Students should review notes after each lecture to improve retention and long-term recall.',
        blankAnswerMap: {}
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1,
        perBlankScore: 1
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_LISTENING_FILL_IN_BLANK, 'listening_fill_in_blank');
  const transcript = String(result?.suggestions?.payload?.transcriptWithBlanks || '');
  const map = result?.suggestions?.payload?.blankAnswerMap || {};
  const placeholders = transcript.match(/\{\{\d+\}\}/g) || [];
  assert.equal(placeholders.length, 0);
  assert.deepEqual(map, {});
});

test('parseAiSuggestionPayload keeps reading fill in blank payload+scoring fields', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        sourcePassage: 'Students should review notes after each lecture to improve retention.',
        passageWithBlanks: 'Students should review {{1}} after each lecture to improve {{2}}.',
        blankAnswerMap: {
          '{{1}}': 'notes',
          '{{2}}': 'retention'
        },
        bankOptions: ['notes', 'retention', 'attendance', 'memorization'],
        caseSensitive: false,
        allowSynonyms: true,
        explanation: 'Use context to choose the best vocabulary item.'
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1,
        perBlankScore: 0.5
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_READING_FILL_IN_BLANK, 'reading_fill_in_blank');
  assert.equal(String(result?.suggestions?.payload?.sourcePassage || '').length > 0, true);
  assert.equal(String(result?.suggestions?.payload?.passageWithBlanks || '').includes('{{1}}'), true);
  assert.deepEqual(result?.suggestions?.payload?.blankAnswerMap, { '{{1}}': 'notes', '{{2}}': 'retention' });
  assert.equal(Array.isArray(result?.suggestions?.payload?.bankOptions), true);
  assert.equal(result?.suggestions?.payload?.bankOptions?.includes('attendance'), true);
  assert.equal(result?.suggestions?.payload?.allowSynonyms, true);
  assert.equal(result?.suggestions?.scoring?.method, 'auto_objective');
  assert.equal(result?.suggestions?.scoring?.maxScore, 1);
  assert.equal(result?.suggestions?.scoring?.perBlankScore, 0.5);
});

test('parseAiSuggestionPayload keeps reading writing fill in blank payload+scoring fields', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        passageTitle: 'Study Habits and Retention',
        blankOptionsMap: {
          '{{1}}': ['notes', 'summaries', 'diagrams', 'schedule'],
          '{{2}}': ['retention', 'attendance', 'punctuation', 'navigation']
        },
        caseSensitive: false,
        explanation: 'Select one option per blank based on context.'
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1,
        perBlankScore: 0.5
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_READING_WRITING_FILL_IN_BLANK, 'reading_writing_fill_in_blank');
  assert.equal(result?.suggestions?.payload?.passageTitle, 'Study Habits and Retention');
  assert.deepEqual(result?.suggestions?.payload?.blankOptionsMap, {
    '{{1}}': ['notes', 'summaries', 'diagrams', 'schedule'],
    '{{2}}': ['retention', 'attendance', 'punctuation', 'navigation']
  });
  assert.equal(result?.suggestions?.scoring?.method, 'auto_objective');
  assert.equal(result?.suggestions?.scoring?.maxScore, 1);
  assert.equal(result?.suggestions?.scoring?.perBlankScore, 0.5);
});

test('parseAiSuggestionPayload keeps reading reorder paragraph arrays and objective scoring fields', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        passageTitle: 'Urban Transport Planning',
        paragraphItems: [
          'City planners first collected congestion data from major intersections.',
          'They then compared short-term fixes against long-term infrastructure options.',
          'Finally, they prioritized projects that balanced cost, impact, and timeline.'
        ],
        correctOrder: [
          'City planners first collected congestion data from major intersections.',
          'They then compared short-term fixes against long-term infrastructure options.',
          'Finally, they prioritized projects that balanced cost, impact, and timeline.'
        ],
        explanation: 'The sequence moves from evidence gathering to evaluation and final prioritization.'
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1,
        partialCreditEnabled: true
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_READING_REORDER, 'reading_reorder_paragraphs');
  assert.equal(result?.suggestions?.payload?.passageTitle, 'Urban Transport Planning');
  assert.equal(Array.isArray(result?.suggestions?.payload?.paragraphItems), true);
  assert.equal(result?.suggestions?.payload?.paragraphItems?.length, 3);
  assert.equal(Array.isArray(result?.suggestions?.payload?.correctOrder), true);
  assert.deepEqual(result?.suggestions?.payload?.correctOrder, result?.suggestions?.payload?.paragraphItems);
  assert.equal(result?.suggestions?.scoring?.method, 'auto_objective');
  assert.equal(result?.suggestions?.scoring?.maxScore, 1);
  assert.equal(result?.suggestions?.scoring?.partialCreditEnabled, true);
});

test('parseAiSuggestionPayload keeps listening dictation payload+scoring fields', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        expectedTranscript: 'Students should review notes after each lecture to improve retention and long-term recall.',
        transcriptVariants: [
          'Students should review notes after each lecture to improve retention and long-term recall.',
          'Students should review their notes after each lecture to improve retention and long-term recall.'
        ],
        allowReplay: false,
        normalizationRules: {
          caseSensitive: false,
          ignorePunctuation: true
        }
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1,
        perWordScore: 1
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_LISTENING_DICTATION, 'listening_dictation');
  assert.equal(String(result?.suggestions?.payload?.expectedTranscript || '').length > 0, true);
  assert.equal(Array.isArray(result?.suggestions?.payload?.transcriptVariants), true);
  assert.equal(result?.suggestions?.payload?.transcriptVariants?.length >= 1, true);
  assert.equal(result?.suggestions?.payload?.allowReplay, false);
  assert.deepEqual(result?.suggestions?.payload?.normalizationRules, { caseSensitive: false, ignorePunctuation: true });
  assert.equal(result?.suggestions?.scoring?.method, 'auto_objective');
  assert.equal(result?.suggestions?.scoring?.maxScore, 1);
  assert.equal(result?.suggestions?.scoring?.perWordScore, 1);
});

test('parseAiSuggestionPayload applies dictation normalization defaults when rules are empty', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        expectedTranscript: 'Students should review notes after each lecture to improve retention and long-term recall.',
        transcriptVariants: [
          'Students should review notes after each lecture to improve retention and long-term recall.'
        ],
        allowReplay: false,
        normalizationRules: {}
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1,
        perWordScore: 1
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_LISTENING_DICTATION, 'listening_dictation');
  assert.deepEqual(result?.suggestions?.payload?.normalizationRules, {
    caseSensitive: false,
    ignorePunctuation: true,
    normalizeWhitespace: true,
    normalizeQuotes: true
  });
  assert.equal(
    Array.isArray(result?.warnings)
      && result.warnings.some((row) => String(row).toLowerCase().includes('normalizationrules were empty')),
    true
  );
});

test('parseAiSuggestionPayload normalizes dictation transcriptVariants from a JSON-string array', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        expectedTranscript: 'Keep your schedule updated weekly to avoid missed deadlines.',
        transcriptVariants: '["Keep your schedule updated weekly to avoid missed deadlines.","Keep your weekly schedule updated to avoid missed deadlines."]',
        allowReplay: false,
        normalizationRules: {}
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1,
        perWordScore: 1
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_LISTENING_DICTATION, 'listening_dictation');
  assert.deepEqual(result?.suggestions?.payload?.transcriptVariants, [
    'Keep your schedule updated weekly to avoid missed deadlines.',
    'Keep your weekly schedule updated to avoid missed deadlines.'
  ]);
});

test('parseAiSuggestionPayload strips dictation transcriptVariants numbering in newline text', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        expectedTranscript: 'Climate policy should balance environmental goals with economic stability.',
        transcriptVariants: '1. Climate policy should balance environmental goals with economic stability.\n2) Climate policies should balance environmental goals and economic stability.',
        allowReplay: false,
        normalizationRules: {}
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1,
        perWordScore: 1
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_LISTENING_DICTATION, 'listening_dictation');
  assert.deepEqual(result?.suggestions?.payload?.transcriptVariants, [
    'Climate policy should balance environmental goals with economic stability.',
    'Climate policies should balance environmental goals and economic stability.'
  ]);
});

test('parseAiSuggestionPayload realigns dictation transcriptVariants when they do not match expectedTranscript', () => {
  const raw = JSON.stringify({
    suggestions: {
      payload: {
        expectedTranscript: 'Active listening is vital for success in this particular course.',
        transcriptVariants: [
          'Payment can be made with either cash or credit.',
          'Payments can be made with cash or credit.'
        ],
        allowReplay: false,
        normalizationRules: {}
      },
      scoring: {
        method: 'auto_objective',
        maxScore: 1,
        perWordScore: 1
      }
    }
  });

  const result = parseAiSuggestionPayload(raw, TARGET_FIELDS_LISTENING_DICTATION, 'listening_dictation');
  const variants = Array.isArray(result?.suggestions?.payload?.transcriptVariants)
    ? result.suggestions.payload.transcriptVariants
    : [];
  assert.equal(variants.length >= 2, true);
  assert.equal(String(variants[0] || ''), 'Active listening is vital for success in this particular course.');
  assert.equal(
    Array.isArray(result?.warnings)
      && result.warnings.some((row) => String(row).toLowerCase().includes('did not align with expected transcript')),
    true
  );
});
