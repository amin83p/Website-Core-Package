const test = require('node:test');
const assert = require('node:assert/strict');

const pteAttemptLedgerService = require('../MVC/services/pte/pteAttemptLedgerService');
const pteAttemptSessionRepository = require('../MVC/repositories/pteAttemptSessionRepository');
const pteAttemptItemRepository = require('../MVC/repositories/pteAttemptItemRepository');
const pteAttemptLedgerEventRepository = require('../MVC/repositories/pteAttemptLedgerEventRepository');
const pteAttemptArtifactRepository = require('../MVC/repositories/pteAttemptArtifactRepository');
const pteQuestionVersionRepository = require('../MVC/repositories/pteQuestionVersionRepository');
const pteQuestionScoringProfileService = require('../MVC/services/pte/pteQuestionScoringProfileService');
const activityQuotaLedgerService = require('../MVC/services/activityQuotaLedgerService');

const ORIGINALS = {
  sessionGetById: pteAttemptSessionRepository.getById,
  sessionUpdate: pteAttemptSessionRepository.update,
  itemGetById: pteAttemptItemRepository.getById,
  itemUpdate: pteAttemptItemRepository.update,
  itemList: pteAttemptItemRepository.list,
  eventFindByIdempotencyKey: pteAttemptLedgerEventRepository.findByIdempotencyKey,
  eventCreate: pteAttemptLedgerEventRepository.create,
  eventUpdate: pteAttemptLedgerEventRepository.update,
  artifactList: pteAttemptArtifactRepository.list,
  questionGetById: pteQuestionVersionRepository.getById,
  resolveQuestionScoring: pteQuestionScoringProfileService.resolveQuestionScoring,
  evaluateQuota: activityQuotaLedgerService.evaluateQuota,
  consumeIfAvailable: activityQuotaLedgerService.consumeIfAvailable,
  recordConsumptionWithoutCheck: activityQuotaLedgerService.recordConsumptionWithoutCheck,
  rebuildProjectionForKey: activityQuotaLedgerService.rebuildProjectionForKey
};

function restore() {
  pteAttemptSessionRepository.getById = ORIGINALS.sessionGetById;
  pteAttemptSessionRepository.update = ORIGINALS.sessionUpdate;
  pteAttemptItemRepository.getById = ORIGINALS.itemGetById;
  pteAttemptItemRepository.update = ORIGINALS.itemUpdate;
  pteAttemptItemRepository.list = ORIGINALS.itemList;
  pteAttemptLedgerEventRepository.findByIdempotencyKey = ORIGINALS.eventFindByIdempotencyKey;
  pteAttemptLedgerEventRepository.create = ORIGINALS.eventCreate;
  pteAttemptLedgerEventRepository.update = ORIGINALS.eventUpdate;
  pteAttemptArtifactRepository.list = ORIGINALS.artifactList;
  pteQuestionVersionRepository.getById = ORIGINALS.questionGetById;
  pteQuestionScoringProfileService.resolveQuestionScoring = ORIGINALS.resolveQuestionScoring;
  activityQuotaLedgerService.evaluateQuota = ORIGINALS.evaluateQuota;
  activityQuotaLedgerService.consumeIfAvailable = ORIGINALS.consumeIfAvailable;
  activityQuotaLedgerService.recordConsumptionWithoutCheck = ORIGINALS.recordConsumptionWithoutCheck;
  activityQuotaLedgerService.rebuildProjectionForKey = ORIGINALS.rebuildProjectionForKey;
}

function speakingQualityMicroResponses({ pronunciation = 'good', fluency = 'good' } = {}) {
  return [
    {
      id: 'pronunciation_quality',
      choice: pronunciation,
      evidence: pronunciation === 'excellent' ? 'Clear pronunciation.' : 'Mostly intelligible.',
      confidence: 0.9
    },
    {
      id: 'fluency_quality',
      choice: fluency,
      evidence: fluency === 'developing' ? 'One hesitation.' : 'Steady rhythm.',
      confidence: 0.9
    }
  ];
}

function respondSituationMicroResponses() {
  return [
    { id: 'appropriacy_situation', choice: 'yes', evidence: 'Addresses the dinner invitation situation.', confidence: 0.9 },
    { id: 'appropriacy_function', choice: 'yes', evidence: 'Declines the invitation and gives a reason.', confidence: 0.9 },
    { id: 'appropriacy_register', choice: 'yes', evidence: 'The informal tone fits a friend.', confidence: 0.9 },
    { id: 'appropriacy_politeness', choice: 'yes', evidence: 'Thanks the friend and stays polite.', confidence: 0.9 },
    { id: 'appropriacy_key_points', choice: 'yes', evidence: 'Decline, reason, and thanks are covered.', confidence: 0.9 },
    ...speakingQualityMicroResponses({ pronunciation: 'good', fluency: 'good' })
  ];
}

function describeImageMicroResponses() {
  return [
    { id: 'content_main_idea', choice: 'yes', evidence: 'Mentions increasing sales.', confidence: 0.9 },
    { id: 'content_key_details', choice: 'partial', evidence: 'Covers the trend but only part of the highest-point detail.', confidence: 0.9 },
    { id: 'content_visual_accuracy', choice: 'yes', evidence: 'The statement matches the supplied chart context.', confidence: 0.9 },
    { id: 'pronunciation_quality', choice: 'good', evidence: 'Mostly clear.', confidence: 0.9 },
    { id: 'fluency_quality', choice: 'developing', evidence: 'Some hesitation.', confidence: 0.9 }
  ];
}

function installRuntimeStubs({ questionType = 'speaking_read_aloud' } = {}) {
  let eventNo = 0;
  const events = [];
  let session = {
    id: 'S-RA-1',
    orgId: 'ORG-1',
    userId: 'USR-1',
    personId: '',
    applicantId: '',
    attemptType: 'skill_practice_run',
    status: 'in_progress',
    testVersionId: 'TV-1',
    startedAt: '2026-05-02T10:00:00.000Z',
    firstEventAt: '',
    eventCounters: {}
  };
  let item = {
    id: 'I-RA-1',
    orgId: 'ORG-1',
    userId: 'USR-1',
    personId: '',
    applicantId: '',
    attemptSessionId: 'S-RA-1',
    attemptType: 'skill_practice_run',
    status: 'in_progress',
    testVersionId: 'TV-1',
    questionVersionId: 'Q-RA-1',
    questionFamilyId: 'QF-RA-1',
    questionType,
    skill: 'speaking',
    questionOrder: 1,
    startedAt: '2026-05-02T10:00:05.000Z',
    submittedAt: '',
    finishedAt: '',
    scoreRaw: 0,
    scoreFinal: 0,
    maxScore: 5,
    percentage: 0,
    traitScores: {},
    responseSummary: {},
    artifactIds: ['AUDIO-1'],
    metadata: { scoringProfileVersion: 1 },
    revisionNo: 0,
    submitCount: 0,
    scoreRevisionCount: 0,
    totalSeenSeconds: 0,
    timeSpentSeconds: 0
  };
  const isAnswerShortQuestion = questionType === 'speaking_answer_short_question';
  const isRepeatSentence = questionType === 'speaking_repeat_sentence';
  const isDescribeImage = questionType === 'speaking_describe_image';
  const isRespondSituation = questionType === 'speaking_respond_to_situation';
  const question = {
    id: 'Q-RA-1',
    orgId: 'ORG-1',
    testType: 'academic',
    questionType,
    skill: 'speaking',
    title: isAnswerShortQuestion
      ? 'Answer Short Question fixture'
      : (isRepeatSentence ? 'Repeat Sentence fixture' : (isRespondSituation ? 'Respond to a Situation fixture' : (isDescribeImage ? 'Describe Image fixture' : 'Read Aloud fixture'))),
    payload: isAnswerShortQuestion
      ? {
        promptTextOrAudio: 'What is the capital of Australia?',
        acceptedAnswers: ['Canberra'],
        answerAliases: ['the capital of Australia is Canberra'],
        allowSemanticMatch: false
      }
      : (isRepeatSentence ? {
        promptAudioAssetId: 'RS-AUDIO-1',
        expectedTranscript: 'Many people believe public parks improve city life.',
        transcriptVariants: ['Many people believe that public parks improve city life.']
      }
      : (isRespondSituation ? {
        situationText: 'Your friend invited you to dinner, but you already have a family event.',
        role: 'friend',
        audience: 'friend',
        targetFunction: 'decline invitation politely',
        targetRegister: 'informal',
        expectedKeyPoints: ['Decline the invitation', 'Give a reason', 'Thank the friend']
      }
      : (isDescribeImage ? {
        imageAssetId: 'IMG-1',
        imageCaption: 'A line chart showing sales increasing from 2020 to 2024.',
        expectedKeyPoints: ['Sales rise over time', '2024 is the highest point'],
        chartType: 'line_chart'
      } : {
        sourceText: 'The quick brown fox jumps.'
      }))),
    scoringConfig: {}
  };

  pteAttemptSessionRepository.getById = async (id) => (id === session.id ? session : null);
  pteAttemptSessionRepository.update = async (id, patch) => {
    assert.equal(id, session.id);
    session = { ...session, ...patch };
    return session;
  };
  pteAttemptItemRepository.getById = async (id) => (id === item.id ? item : null);
  pteAttemptItemRepository.update = async (id, patch) => {
    assert.equal(id, item.id);
    item = {
      ...item,
      ...patch,
      metadata: patch.metadata ? patch.metadata : item.metadata
    };
    return item;
  };
  pteAttemptItemRepository.list = async () => [item];
  pteAttemptLedgerEventRepository.findByIdempotencyKey = async () => null;
  pteAttemptLedgerEventRepository.create = async (payload) => {
    const event = { id: `EVT-${++eventNo}`, ...payload };
    events.push(event);
    return event;
  };
  pteAttemptLedgerEventRepository.update = async (id, patch) => {
    const event = { id, ...patch };
    events.push(event);
    return event;
  };
  pteAttemptArtifactRepository.list = async () => [
    {
      id: 'AUDIO-1',
      orgId: 'ORG-1',
      userId: 'USR-1',
      attemptSessionId: 'S-RA-1',
      attemptItemId: 'I-RA-1',
      artifactType: 'audio',
      mimeType: 'audio/webm',
      path: '/tmp/read-aloud-fixture.webm',
      durationSeconds: 3.8
    }
  ];
  pteQuestionVersionRepository.getById = async (id) => (id === question.id ? question : null);
  pteQuestionScoringProfileService.resolveQuestionScoring = async () => ({
    profileVersion: 2,
    effectiveScoringConfig: isAnswerShortQuestion
      ? {
        method: 'hybrid_ai_audio_objective',
        scorerVersion: 'pte-answer-short-question-v1',
        maxScore: 1,
        traits: ['vocabulary'],
        minAnalysisConfidence: 0.35,
        minSemanticConfidence: 0.7
      }
      : (isRepeatSentence ? {
        method: 'hybrid_ai_audio_repetition',
        scorerVersion: 'pte-repeat-sentence-v1',
        maxScore: 13,
        maxScoreMode: 'fixed_content_3_plus_traits',
        contentMax: 3,
        pronunciationMax: 5,
        fluencyMax: 5,
        traits: ['content', 'pronunciation', 'fluency'],
        contentScoringMode: 'ordered_prompt_word_coverage',
        idealWpmMin: 90,
        idealWpmMax: 170,
        longPauseSeconds: 2,
        minAnalysisConfidence: 0.35
      }
      : (isRespondSituation ? {
        method: 'hybrid_ai_audio_situational',
        scorerVersion: 'pte-respond-to-situation-v1',
        maxScore: 13,
        maxScoreMode: 'fixed_appropriacy_3_plus_traits',
        appropriacyMax: 3,
        pronunciationMax: 5,
        fluencyMax: 5,
        traits: ['appropriacy', 'pronunciation', 'fluency'],
        traitWeights: { appropriacy: 0.5, pronunciation: 0.25, fluency: 0.25 },
        contentCoverageMin: 0.6,
        minResponseSeconds: 20,
        idealWpmMin: 85,
        idealWpmMax: 155,
        longPauseSeconds: 2,
        offTopicPenalty: 0.25,
        minAnalysisConfidence: 0.35
      }
      : (isDescribeImage ? {
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
      } : {
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
      })))
  });

  return {
    get session() { return session; },
    get item() { return item; },
    events
  };
}

test.afterEach(() => {
  restore();
});

test('submitting Read Aloud invokes scorer and persists score fields', async () => {
  const state = installRuntimeStubs({ questionType: 'speaking_read_aloud' });
  const requestingUser = { id: 'USR-1', activeOrgId: 'ORG-1', isVirtualSuperAdmin: true };

  const result = await pteAttemptLedgerService.submitAttemptItem(
    'S-RA-1',
    'I-RA-1',
    {
      responsePayload: {
        artifactId: 'AUDIO-1',
        audioDurationSeconds: 3.8
      },
      responseSummary: { kind: 'speaking', audioDurationSeconds: 3.8 }
    },
    requestingUser,
    {},
    {
      scoringOptions: {
        aiAnalysis: {
          transcript: 'The quick brown fox jumps.',
          pronunciation: { score: 4, evidence: ['Mostly intelligible.'] },
          fluency: { score: 3, evidence: ['One hesitation.'] },
          microResponses: speakingQualityMicroResponses({ pronunciation: 'good', fluency: 'developing' }),
          speechMetrics: {
            speechDurationSeconds: 3.8,
            estimatedWpm: 78
          },
          confidence: 0.8
        },
        provider: { providerId: 'test-provider', modelUsed: 'test-model' }
      }
    }
  );

  assert.equal(result.autoScoring.status, 'scored');
  assert.equal(result.item.status, 'scored');
  assert.equal(result.item.scoreFinal, 12);
  assert.equal(result.item.maxScore, 15);
  assert.deepEqual(result.item.traitScores, {
    content: 5,
    pronunciation: 4,
    fluency: 3
  });
  assert.equal(result.item.metadata.scoring.status, 'scored');
  assert.equal(result.item.metadata.scoring.scorerVersion, 'pte-read-aloud-v1');
  assert.equal(state.events.some((event) => event.eventType === 'question_submitted'), true);
  assert.equal(state.events.some((event) => event.eventType === 'score_recorded'), true);
});

test('saved Read Aloud response is scored only after explicit submit/score action', async () => {
  const state = installRuntimeStubs({ questionType: 'speaking_read_aloud' });
  const requestingUser = { id: 'USR-1', activeOrgId: 'ORG-1', isVirtualSuperAdmin: true };

  const saved = await pteAttemptLedgerService.saveAttemptItem(
    'S-RA-1',
    'I-RA-1',
    {
      responsePayload: {
        artifactId: 'AUDIO-1',
        audioDurationSeconds: 3.8
      },
      responseSummary: { kind: 'speaking', audioDurationSeconds: 3.8 },
      source: {
        module: 'pte_practice_runner_ui',
        eventType: 'response_saved',
        eventId: 'PTE-PRACTICE-SAVE-I-RA-1'
      }
    },
    requestingUser,
    {},
    {}
  );

  assert.equal(saved.autoScoring, undefined);
  assert.equal(saved.item.status, 'saved');
  assert.equal(saved.item.scoreFinal, 0);
  assert.equal(state.events.some((event) => event.eventType === 'response_saved'), true);
  assert.equal(state.events.some((event) => event.eventType === 'question_submitted'), false);
  assert.equal(state.events.some((event) => event.eventType === 'score_recorded'), false);

  const scored = await pteAttemptLedgerService.scoreAttemptItem(
    'S-RA-1',
    'I-RA-1',
    {
      source: {
        module: 'pte_practice_runner_ui',
        eventType: 'read_aloud_score_requested',
        eventId: 'PTE-PRACTICE-SCORE-I-RA-1'
      }
    },
    requestingUser,
    {},
    {
      scoringOptions: {
        aiAnalysis: {
          transcript: 'The quick brown fox jumps.',
          pronunciation: { score: 5, evidence: ['Clear pronunciation.'] },
          fluency: { score: 4, evidence: ['Smooth pace.'] },
          microResponses: speakingQualityMicroResponses({ pronunciation: 'excellent', fluency: 'good' }),
          speechMetrics: {
            speechDurationSeconds: 3.8,
            estimatedWpm: 78
          },
          confidence: 0.9
        },
        provider: { providerId: 'test-provider', modelUsed: 'test-model' }
      }
    }
  );

  assert.equal(scored.autoScoring.status, 'scored');
  assert.equal(scored.item.status, 'scored');
  assert.equal(scored.item.scoreFinal, 14);
  assert.equal(scored.item.maxScore, 15);
  assert.deepEqual(scored.item.traitScores, {
    content: 5,
    pronunciation: 5,
    fluency: 4
  });
  assert.equal(scored.item.metadata.scoring.status, 'scored');
  assert.equal(state.events.some((event) => event.eventType === 'question_submitted'), false);
  assert.equal(state.events.some((event) => event.eventType === 'score_recorded'), true);
});

test('saved Repeat Sentence response is scored through the scoring framework', async () => {
  const state = installRuntimeStubs({ questionType: 'speaking_repeat_sentence' });
  const requestingUser = { id: 'USR-1', activeOrgId: 'ORG-1', isVirtualSuperAdmin: true };

  await pteAttemptLedgerService.saveAttemptItem(
    'S-RA-1',
    'I-RA-1',
    {
      responsePayload: {
        artifactId: 'AUDIO-1',
        audioDurationSeconds: 4.2
      },
      responseSummary: { kind: 'speaking', audioDurationSeconds: 4.2 },
      source: {
        module: 'pte_practice_runner_ui',
        eventType: 'response_saved',
        eventId: 'PTE-PRACTICE-SAVE-I-RS-1'
      }
    },
    requestingUser,
    {},
    {}
  );

  const scored = await pteAttemptLedgerService.scoreAttemptItem(
    'S-RA-1',
    'I-RA-1',
    {
      source: {
        module: 'pte_practice_runner_ui',
        eventType: 'speaking_repeat_sentence_score_requested',
        eventId: 'PTE-PRACTICE-SCORE-I-RS-1'
      }
    },
    requestingUser,
    {},
    {
      scoringOptions: {
        aiAnalysis: {
          transcript: 'Many people believe public parks improve city life.',
          pronunciation: { score: 4, evidence: ['Mostly intelligible.'] },
          fluency: { score: 4, evidence: ['Steady rhythm.'] },
          microResponses: speakingQualityMicroResponses({ pronunciation: 'good', fluency: 'good' }),
          speechMetrics: {
            speechDurationSeconds: 4.2,
            estimatedWpm: 100
          },
          confidence: 0.86
        },
        provider: { providerId: 'test-provider', modelUsed: 'test-model' }
      }
    }
  );

  assert.equal(scored.autoScoring.status, 'scored');
  assert.equal(scored.item.status, 'scored');
  assert.equal(scored.item.scoreFinal, 11);
  assert.equal(scored.item.maxScore, 13);
  assert.deepEqual(scored.item.traitScores, {
    content: 3,
    pronunciation: 4,
    fluency: 4
  });
  assert.equal(scored.item.metadata.scoring.scorerVersion, 'pte-repeat-sentence-v1');
  assert.equal(scored.item.metadata.scoring.alignment.matchCount, 8);
  assert.equal(state.events.some((event) => event.eventType === 'score_recorded'), true);
});

test('saved Respond to a Situation response is scored through the scoring framework', async () => {
  const state = installRuntimeStubs({ questionType: 'speaking_respond_to_situation' });
  const requestingUser = { id: 'USR-1', activeOrgId: 'ORG-1', isVirtualSuperAdmin: true };

  await pteAttemptLedgerService.saveAttemptItem(
    'S-RA-1',
    'I-RA-1',
    {
      responsePayload: {
        artifactId: 'AUDIO-1',
        audioDurationSeconds: 9.4
      },
      responseSummary: { kind: 'speaking', audioDurationSeconds: 9.4 },
      source: {
        module: 'pte_practice_runner_ui',
        eventType: 'response_saved',
        eventId: 'PTE-PRACTICE-SAVE-I-RTS-1'
      }
    },
    requestingUser,
    {},
    {}
  );

  const scored = await pteAttemptLedgerService.scoreAttemptItem(
    'S-RA-1',
    'I-RA-1',
    {
      source: {
        module: 'pte_practice_runner_ui',
        eventType: 'speaking_respond_to_situation_score_requested',
        eventId: 'PTE-PRACTICE-SCORE-I-RTS-1'
      }
    },
    requestingUser,
    {},
    {
      scoringOptions: {
        aiAnalysis: {
          transcript: 'I am sorry but I cannot come to dinner because I already have a family event. Thank you for inviting me.',
          appropriacy: { score: 3, evidence: ['Politely declines and gives a reason.'] },
          pronunciation: { score: 4, evidence: ['Mostly intelligible.'] },
          fluency: { score: 4, evidence: ['Steady rhythm.'] },
          microResponses: respondSituationMicroResponses(),
          speechMetrics: {
            speechDurationSeconds: 9.4,
            estimatedWpm: 128
          },
          confidence: 0.88
        },
        provider: { providerId: 'test-provider', modelUsed: 'test-model' }
      }
    }
  );

  assert.equal(scored.autoScoring.status, 'scored');
  assert.equal(scored.item.status, 'scored');
  assert.equal(scored.item.scoreFinal, 11);
  assert.equal(scored.item.maxScore, 13);
  assert.deepEqual(scored.item.traitScores, {
    appropriacy: 3,
    pronunciation: 4,
    fluency: 4
  });
  assert.equal(scored.item.metadata.scoring.scorerVersion, 'pte-respond-to-situation-v1');
  assert.equal(scored.item.metadata.scoring.situation.targetFunction, 'decline invitation politely');
  assert.equal(state.events.some((event) => event.eventType === 'score_recorded'), true);
});

test('saved Answer Short Question response is scored through the scoring framework', async () => {
  const state = installRuntimeStubs({ questionType: 'speaking_answer_short_question' });
  const requestingUser = { id: 'USR-1', activeOrgId: 'ORG-1', isVirtualSuperAdmin: true };

  await pteAttemptLedgerService.saveAttemptItem(
    'S-RA-1',
    'I-RA-1',
    {
      responsePayload: {
        artifactId: 'AUDIO-1',
        audioDurationSeconds: 1.4
      },
      responseSummary: { kind: 'speaking', audioDurationSeconds: 1.4 },
      source: {
        module: 'pte_practice_runner_ui',
        eventType: 'response_saved',
        eventId: 'PTE-PRACTICE-SAVE-I-ASQ-1'
      }
    },
    requestingUser,
    {},
    {}
  );

  const scored = await pteAttemptLedgerService.scoreAttemptItem(
    'S-RA-1',
    'I-RA-1',
    {
      source: {
        module: 'pte_practice_runner_ui',
        eventType: 'speaking_answer_short_question_score_requested',
        eventId: 'PTE-PRACTICE-SCORE-I-ASQ-1'
      }
    },
    requestingUser,
    {},
    {
      scoringOptions: {
        aiAnalysis: {
          transcript: 'The answer is Canberra.',
          normalizedAnswer: 'Canberra',
          confidence: 0.9
        },
        provider: { providerId: 'test-provider', modelUsed: 'test-model' }
      }
    }
  );

  assert.equal(scored.autoScoring.status, 'scored');
  assert.equal(scored.item.status, 'scored');
  assert.equal(scored.item.scoreFinal, 1);
  assert.equal(scored.item.maxScore, 1);
  assert.equal(scored.item.traitScores.vocabulary, 1);
  assert.equal(scored.item.metadata.scoring.scorerVersion, 'pte-answer-short-question-v1');
  assert.equal(scored.item.metadata.scoring.match.isCorrect, true);
  assert.equal(state.events.some((event) => event.eventType === 'score_recorded'), true);
});

test('saved Describe Image response is scored through the scoring framework', async () => {
  const state = installRuntimeStubs({ questionType: 'speaking_describe_image' });
  const requestingUser = { id: 'USR-1', activeOrgId: 'ORG-1', isVirtualSuperAdmin: true };

  await pteAttemptLedgerService.saveAttemptItem(
    'S-RA-1',
    'I-RA-1',
    {
      responsePayload: {
        artifactId: 'AUDIO-1',
        audioDurationSeconds: 28
      },
      responseSummary: { kind: 'speaking', audioDurationSeconds: 28 },
      source: {
        module: 'pte_practice_runner_ui',
        eventType: 'response_saved',
        eventId: 'PTE-PRACTICE-SAVE-I-DI-1'
      }
    },
    requestingUser,
    {},
    {}
  );

  const scored = await pteAttemptLedgerService.scoreAttemptItem(
    'S-RA-1',
    'I-RA-1',
    {
      source: {
        module: 'pte_practice_runner_ui',
        eventType: 'speaking_describe_image_score_requested',
        eventId: 'PTE-PRACTICE-SCORE-I-DI-1'
      }
    },
    requestingUser,
    {},
    {
      scoringOptions: {
        aiAnalysis: {
          transcript: 'The line chart shows sales increasing steadily and reaching the highest point in 2024.',
          content: { score: 4, coveredKeyPoints: ['Sales rise over time'], missingKeyPoints: ['2024 highest point'] },
          pronunciation: { score: 4, evidence: ['Mostly clear'] },
          fluency: { score: 3, evidence: ['Some hesitation'] },
          microResponses: describeImageMicroResponses(),
          speechMetrics: { speechDurationSeconds: 28, estimatedWpm: 118 },
          confidence: 0.9
        },
        provider: { providerId: 'test-provider', modelUsed: 'test-model' }
      }
    }
  );

  assert.equal(scored.autoScoring.status, 'scored');
  assert.equal(scored.item.status, 'scored');
  assert.equal(scored.item.scoreFinal, 11);
  assert.equal(scored.item.maxScore, 15);
  assert.deepEqual(scored.item.traitScores, {
    content: 4,
    pronunciation: 4,
    fluency: 3
  });
  assert.equal(scored.item.metadata.scoring.scorerVersion, 'pte-describe-image-v1');
  assert.equal(scored.item.metadata.scoring.image.expectedKeyPoints.length, 2);
  assert.equal(state.events.some((event) => event.eventType === 'score_recorded'), true);
});

test('explicit Read Aloud scoring consumes rule call/token quota, records actual tokens, and allows rescoring', async () => {
  installRuntimeStubs({ questionType: 'speaking_read_aloud' });
  const requestingUser = {
    id: 'USR-1',
    activeOrgId: 'ORG-1',
    isSystemAdmin: false,
    activeProfile: { fullAdmin: false, adminCategories: [], sections: [] }
  };
  const quotaCalls = [];

  activityQuotaLedgerService.evaluateQuota = async (input) => {
    quotaCalls.push({ type: 'evaluate', input });
    assert.deepEqual(input.needs, {
      call: 1,
      amount: 0,
      token: 50,
      volume: 0
    });
    return {
      allowed: true,
      message: 'Quota available.',
      needs: input.needs,
      deficits: { call: 0, amount: 0, token: 0, volume: 0 },
      snapshot: { totals: { available: { call: 5, amount: 0, token: 5000, volume: 0 } } }
    };
  };
  activityQuotaLedgerService.consumeIfAvailable = async (input) => {
    quotaCalls.push({ type: 'consumeCall', input });
    assert.deepEqual(input.needs, {
      call: 1,
      amount: 0,
      token: 50,
      volume: 0
    });
    return {
      allowed: true,
      entry: {
        id: `AQL-CALL-${quotaCalls.length}`,
        orgId: input.orgId,
        userId: input.userId,
        section: input.section,
        operation: input.operation,
        call: input.needs.call,
        token: input.needs.token
      }
    };
  };
  activityQuotaLedgerService.recordConsumptionWithoutCheck = async (input) => {
    quotaCalls.push({ type: 'recordTokens', input });
    assert.equal(input.needs.token, 321);
    return {
      id: `AQL-TOKEN-${quotaCalls.length}`,
      orgId: input.orgId,
      userId: input.userId,
      section: input.section,
      operation: input.operation,
      call: 0,
      token: input.needs.token
    };
  };
  activityQuotaLedgerService.rebuildProjectionForKey = async (input) => {
    quotaCalls.push({ type: 'rebuild', input });
    return { ok: true };
  };

  const activityQuotaPolicy = {
    definition: {
      id: 'RULE-SCORE-1',
      orgId: 'ORG-1',
      sectionId: 'PTE_PRACTICE_BY_SKILLS',
      operationId: 'AI_SCORING',
      consumeTiming: 'on_attempt',
      formula: {
        call: { base: 1, multiplier: 0, contextKey: '' },
        amount: { base: 0, multiplier: 0, contextKey: '' },
        token: { base: 50, multiplier: 0, contextKey: '' },
        volume: { base: 0, multiplier: 0, contextKey: '' }
      }
    },
    context: {
      orgId: 'ORG-1',
      userId: 'USR-1',
      sectionId: 'PTE_PRACTICE_BY_SKILLS',
      operationId: 'AI_SCORING',
      sourceEventType: 'practice_item_scored'
    },
    section: 'PTE_PRACTICE_BY_SKILLS',
    operation: 'AI_SCORING',
    sourceEventType: 'practice_item_scored'
  };
  const scoringOptions = {
    scoringOptions: {
      aiAnalysis: {
        transcript: 'The quick brown fox jumps.',
        pronunciation: { score: 5, evidence: ['Clear pronunciation.'] },
        fluency: { score: 4, evidence: ['Smooth pace.'] },
        microResponses: speakingQualityMicroResponses({ pronunciation: 'excellent', fluency: 'good' }),
        speechMetrics: {
          speechDurationSeconds: 3.8,
          estimatedWpm: 78
        },
        confidence: 0.9
      },
      provider: {
        providerId: 'test-provider',
        modelUsed: 'test-model',
        tokenUsage: {
          promptTokenCount: 200,
          candidatesTokenCount: 121,
          totalTokenCount: 321
        }
      }
    }
  };

  await pteAttemptLedgerService.saveAttemptItem(
    'S-RA-1',
    'I-RA-1',
    {
      responsePayload: {
        artifactId: 'AUDIO-1',
        audioDurationSeconds: 3.8
      },
      responseSummary: { kind: 'speaking', audioDurationSeconds: 3.8 },
      source: {
        module: 'pte_practice_runner_ui',
        eventType: 'response_saved',
        eventId: 'PTE-PRACTICE-SAVE-I-RA-1-QUOTA'
      }
    },
    requestingUser,
    {},
    {}
  );

  const first = await pteAttemptLedgerService.scoreAttemptItem(
    'S-RA-1',
    'I-RA-1',
    {
      activityQuotaPolicy
    },
    requestingUser,
    {},
    scoringOptions
  );

  assert.equal(first.autoScoring.status, 'scored');
  assert.equal(first.item.status, 'scored');
  assert.equal(first.autoScoring.activityQuota.scoringCall.callNeeds.call, 1);
  assert.equal(first.autoScoring.activityQuota.scoringCall.upfrontNeeds.token, 50);
  assert.equal(first.autoScoring.activityQuota.scoringTokens.needs.token, 321);

  const second = await pteAttemptLedgerService.scoreAttemptItem(
    'S-RA-1',
    'I-RA-1',
    {
      activityQuotaPolicy
    },
    requestingUser,
    {},
    scoringOptions
  );

  assert.equal(second.autoScoring.status, 'scored');
  assert.equal(second.item.status, 'scored');
  assert.equal(second.item.scoreRevisionCount, 2);
  assert.equal(quotaCalls.filter((entry) => entry.type === 'evaluate').length, 2);
  assert.equal(quotaCalls.filter((entry) => entry.type === 'consumeCall').length, 2);
  assert.equal(quotaCalls.filter((entry) => entry.type === 'recordTokens').length, 2);
  assert.equal(quotaCalls.filter((entry) => entry.type === 'rebuild').length, 2);
  const scoringCallKeys = quotaCalls
    .filter((entry) => entry.type === 'consumeCall')
    .map((entry) => entry.input?.source?.idempotencyKey)
    .filter(Boolean);
  assert.equal(new Set(scoringCallKeys).size, 2);
});

test('submitting unsupported speaking item remains submitted and unscored', async () => {
  installRuntimeStubs({ questionType: 'speaking_future_type' });
  const requestingUser = { id: 'USR-1', activeOrgId: 'ORG-1', isVirtualSuperAdmin: true };

  const result = await pteAttemptLedgerService.submitAttemptItem(
    'S-RA-1',
    'I-RA-1',
    {
      responsePayload: {
        artifactId: 'AUDIO-1',
        audioDurationSeconds: 3.8
      },
      responseSummary: { kind: 'speaking', audioDurationSeconds: 3.8 }
    },
    requestingUser,
    {},
    {
      scoringOptions: {
        aiAnalysis: {
          transcript: 'A chart shows a steady increase.',
          pronunciation: { score: 4 },
          fluency: { score: 4 }
        }
      }
    }
  );

  assert.equal(result.autoScoring.status, 'skipped');
  assert.equal(result.autoScoring.reason, 'unsupported_question_type');
  assert.equal(result.item.status, 'submitted');
  assert.equal(result.item.scoreFinal, 0);
  assert.equal(result.item.scoreRevisionCount, 0);
  assert.equal(result.item.metadata.scoring, undefined);
});
