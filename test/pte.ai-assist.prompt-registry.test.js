const test = require('node:test');
const assert = require('node:assert/strict');

const promptRegistry = require('../packages/pte/MVC/services/pte/questionBankAiPromptRegistry');

test('prompt registry returns scoped payload+scoring targets for respond-to-situation', () => {
  const config = promptRegistry.getPromptConfig({
    questionType: 'speaking_respond_to_situation',
    title: 'Respond Prompt',
    payload: {
      situationText: 'You cannot attend a meeting and must explain why.'
    },
    scoringConfig: {}
  });

  assert.equal(config.supported, true);
  assert.equal(Array.isArray(config.targetFields), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'targetFunction'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'traitWeights'), true);
  assert.equal(config.responseSchema?.properties?.suggestions?.properties?.payload?.type, 'object');
  assert.equal(config.responseSchema?.properties?.suggestions?.properties?.scoring?.type, 'object');
});

test('prompt registry requires image asset context for describe-image', () => {
  assert.throws(() => {
    promptRegistry.getPromptConfig({
      questionType: 'speaking_describe_image',
      payload: {}
    });
  }, /Image Asset ID is required/i);
});

test('prompt registry supports describe-image v1 scoring targets', () => {
  const config = promptRegistry.getPromptConfig({
    questionType: 'speaking_describe_image',
    title: 'Describe Image Prompt',
    payload: {
      imageAssetId: 'IMG_001',
      expectedKeyPoints: ['The main trend rises over time', 'The final value is the highest']
    },
    scoringConfig: {}
  });

  assert.equal(config.supported, true);
  assert.deepEqual(config.completionContext.payload.expectedKeyPoints, [
    'The main trend rises over time',
    'The final value is the highest'
  ]);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'scorerVersion'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'contentMax'), true);
  assert.equal(config.responseSchema.properties.suggestions.properties.scoring.required.includes('maxScore'), true);
  assert.equal(config.responseSchema.properties.suggestions.properties.scoring.required.includes('minAnalysisConfidence'), true);
  assert.match(config.systemPrompt, /do not infer chart topics/i);
  assert.match(config.systemPrompt, /imageAssetId/i);
});

test('prompt registry reports unsupported question types with rollout warning', () => {
  const config = promptRegistry.getPromptConfig({
    questionType: 'writing_essay'
  });
  assert.equal(config.supported, false);
  assert.match(
    String(config.warning || ''),
    /Read Aloud, Repeat Sentence, Answer Short Question, Writing Summarize Written Text, Write Email, Reading MCQ Single, Reading MCQ Multiple, Reading Writing Fill in the Blanks, Reading Fill in the Blanks, Reading Reorder Paragraphs, Listening MCQ Single/i
  );
});

test('prompt registry supports read-aloud with scoped payload+scoring targets', () => {
  const config = promptRegistry.getPromptConfig({
    questionType: 'speaking_read_aloud',
    title: 'Read Aloud Prompt',
    payload: {
      sourceText: 'The city council announced a new public transport initiative.'
    },
    scoringConfig: {}
  });

  assert.equal(config.supported, true);
  assert.equal(Array.isArray(config.targetFields), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'referenceTranscript'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'method'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'maxScoreMode'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'maxScore'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'traits'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'contentScoringMode'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'pronunciationMax'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'fluencyMax'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'idealWpmMin'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'idealWpmMax'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'longPauseSeconds'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'minAnalysisConfidence'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'minSemanticConfidence'), false);
});

test('prompt registry supports repeat-sentence with scoped payload+scoring targets', () => {
  const config = promptRegistry.getPromptConfig({
    questionType: 'speaking_repeat_sentence',
    title: 'Repeat Sentence Prompt',
    payload: {
      promptAudioAssetId: 'AUDIO_001',
      expectedTranscript: 'The lecture was postponed due to severe weather conditions.'
    },
    scoringConfig: {}
  });

  assert.equal(config.supported, true);
  assert.equal(Array.isArray(config.targetFields), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'expectedTranscript'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'transcriptVariants'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'responseTimeSeconds'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'method'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'maxScore'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'traits'), true);
});

test('prompt registry supports listening mcq single with scoped payload+scoring targets', () => {
  const config = promptRegistry.getPromptConfig({
    questionType: 'listening_mcq_single',
    title: 'Listening MCQ Single Prompt',
    payload: {
      promptAudioAssetId: 'AUDIO_001',
      transcript: 'The speaker explains why urban parks improve public health.',
      stem: 'What is the main point made by the speaker?'
    },
    scoringConfig: {}
  });

  assert.equal(config.supported, true);
  assert.equal(Array.isArray(config.targetFields), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'options'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'correctOptionKey'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'allowReplay'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'method'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'maxScore'), true);
});

test('prompt registry supports reading mcq single with scoped payload+scoring targets', () => {
  const config = promptRegistry.getPromptConfig({
    questionType: 'reading_mcq_single',
    title: 'Reading MCQ Single Prompt',
    payload: {
      passageHtml: 'Modern cities need adaptive transport planning to reduce congestion.',
      stem: 'According to the passage, what is needed to reduce congestion?'
    },
    scoringConfig: {}
  });

  assert.equal(config.supported, true);
  assert.equal(Array.isArray(config.targetFields), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'passageTitle'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'options'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'correctOptionKey'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'passageHtml'), false);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'stem'), false);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'method'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'maxScore'), true);
});

test('prompt registry requires both reading text and stem for reading mcq single', () => {
  assert.throws(() => {
    promptRegistry.getPromptConfig({
      questionType: 'reading_mcq_single',
      payload: {
        passageHtml: 'Only passage is provided.'
      }
    });
  }, /Reading Text and Question Stem are required/i);
});

test('prompt registry supports reading mcq multiple with scoped payload+scoring targets', () => {
  const config = promptRegistry.getPromptConfig({
    questionType: 'reading_mcq_multiple',
    title: 'Reading MCQ Multiple Prompt',
    payload: {
      passageHtml: 'The author explains two benefits and one limitation of urban farming.',
      stem: 'According to the passage, which TWO claims are supported?'
    },
    scoringConfig: {}
  });

  assert.equal(config.supported, true);
  assert.equal(Array.isArray(config.targetFields), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'passageTitle'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'options'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'correctOptionKeys'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'passageHtml'), false);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'stem'), false);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'method'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'maxScore'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'partialCreditEnabled'), false);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'partialCreditEnabled'), false);
});

test('prompt registry requires both reading text and stem for reading mcq multiple', () => {
  assert.throws(() => {
    promptRegistry.getPromptConfig({
      questionType: 'reading_mcq_multiple',
      payload: {
        passageHtml: 'Only passage is provided.'
      }
    });
  }, /Reading Text and Question Stem are required/i);
});

test('prompt registry supports listening mcq multiple with scoped payload+scoring targets', () => {
  const config = promptRegistry.getPromptConfig({
    questionType: 'listening_mcq_multiple',
    title: 'Listening MCQ Multiple Prompt',
    payload: {
      promptAudioAssetId: 'AUDIO_002',
      transcript: 'The lecturer lists two practical benefits and one limitation.',
      stem: 'Which two points does the lecturer support?'
    },
    scoringConfig: {}
  });

  assert.equal(config.supported, true);
  assert.equal(Array.isArray(config.targetFields), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'options'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'correctOptionKeys'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'partialCreditEnabled'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'allowReplay'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'method'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'maxScore'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'partialCreditEnabled'), true);
});

test('prompt registry supports listening fill in blank with scoped payload+scoring targets', () => {
  const config = promptRegistry.getPromptConfig({
    questionType: 'listening_fill_in_blank',
    title: 'Listening Fill in Blank Prompt',
    payload: {
      promptAudioAssetId: 'AUDIO_003',
      sourceTranscript: 'Students should review notes after each lecture to improve retention.'
    },
    scoringConfig: {}
  });

  assert.equal(config.supported, true);
  assert.equal(Array.isArray(config.targetFields), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'transcriptWithBlanks'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'blankAnswerMap'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'allowReplay'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'caseSensitive'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'method'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'maxScore'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'perBlankScore'), true);
});

test('prompt registry supports reading fill in blank with scoped payload+scoring targets', () => {
  const config = promptRegistry.getPromptConfig({
    questionType: 'reading_fill_in_blank',
    title: 'Reading Fill in Blank Prompt',
    payload: {
      sourcePassage: 'Students should review notes after each lecture to improve retention and long-term recall.',
      passageWithBlanks: 'Students should review {{1}} after each lecture to improve {{2}} and long-term recall.',
      blankAnswerMap: {
        '{{1}}': 'notes',
        '{{2}}': 'retention'
      }
    },
    scoringConfig: {}
  });

  assert.equal(config.supported, true);
  assert.equal(Array.isArray(config.targetFields), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'sourcePassage'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'passageWithBlanks'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'blankAnswerMap'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'bankOptions'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'allowSynonyms'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'method'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'maxScore'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'perBlankScore'), true);
});

test('prompt registry supports reading writing fill in blank with per-blank options map', () => {
  const config = promptRegistry.getPromptConfig({
    questionType: 'reading_writing_fill_in_blank',
    title: 'Reading Writing Fill in Blank Prompt',
    payload: {
      sourcePassage: 'Students should review notes after each lecture to improve retention and long-term recall.',
      passageWithBlanks: 'Students should review {{1}} after each lecture to improve {{2}} and long-term recall.',
      passageTitle: 'Study Habits and Retention',
      blankAnswerMap: {
        '{{1}}': 'notes',
        '{{2}}': 'retention'
      },
      blankOptionsMap: {
        '{{1}}': ['notes', 'summaries', 'diagrams', 'schedule'],
        '{{2}}': ['retention', 'attendance', 'punctuation', 'navigation']
      }
    },
    scoringConfig: {}
  });

  assert.equal(config.supported, true);
  assert.equal(Array.isArray(config.targetFields), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'passageTitle'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'blankOptionsMap'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'caseSensitive'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'sourcePassage'), false);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'passageWithBlanks'), false);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'blankAnswerMap'), false);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'method'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'maxScore'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'perBlankScore'), true);
});

test('prompt registry supports reading reorder paragraphs with scoped payload+scoring targets', () => {
  const config = promptRegistry.getPromptConfig({
    questionType: 'reading_reorder_paragraphs',
    title: 'Reading Reorder Paragraphs Prompt',
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
      ]
    },
    scoringConfig: {}
  });

  assert.equal(config.supported, true);
  assert.equal(Array.isArray(config.targetFields), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'passageTitle'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'paragraphItems'), false);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'correctOrder'), false);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'explanation'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'method'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'maxScore'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'partialCreditEnabled'), true);
  assert.equal(Array.isArray(config.completionContext?.payload?.paragraphItems), true);
  assert.equal(config.completionContext.payload.paragraphItems.length, 3);
});

test('prompt registry derives reorder paragraph items from source passage when paragraphItems are sparse', () => {
  const config = promptRegistry.getPromptConfig({
    questionType: 'reading_reorder_paragraphs',
    payload: {
      sourcePassage: 'City planners first collected congestion data from major intersections.\n\nThey then compared short-term fixes against long-term infrastructure options.\n\nFinally, they prioritized projects that balanced cost, impact, and timeline.',
      paragraphItems: [],
      correctOrder: []
    },
    scoringConfig: {}
  });

  assert.equal(config.supported, true);
  assert.equal(Array.isArray(config.completionContext?.payload?.paragraphItems), true);
  assert.equal(config.completionContext.payload.paragraphItems.length >= 2, true);
  assert.deepEqual(
    config.completionContext.payload.correctOrder,
    config.completionContext.payload.paragraphItems
  );
});

test('prompt registry requires at least two paragraph items for reading reorder paragraphs', () => {
  assert.throws(() => {
    promptRegistry.getPromptConfig({
      questionType: 'reading_reorder_paragraphs',
      payload: {
        paragraphItems: ['Only one paragraph item is provided.']
      }
    });
  }, /At least two paragraph items are required/i);
});

test('prompt registry supports listening dictation with scoped payload+scoring targets', () => {
  const config = promptRegistry.getPromptConfig({
    questionType: 'listening_dictation',
    title: 'Listening Dictation Prompt',
    payload: {
      promptAudioAssetId: 'AUDIO_004',
      expectedTranscript: 'Students should review notes after each lecture to improve retention.'
    },
    scoringConfig: {}
  });

  assert.equal(config.supported, true);
  assert.equal(Array.isArray(config.targetFields), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'expectedTranscript'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'transcriptVariants'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'allowReplay'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'payload' && row.key === 'normalizationRules'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'method'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'maxScore'), true);
  assert.equal(config.targetFields.some((row) => row.scope === 'scoring' && row.key === 'perWordScore'), true);
});
