const test = require('node:test');
const assert = require('node:assert/strict');

const listeningScoringService = require('../MVC/services/pte/pteListeningScoringService');
const scoringEngineService = require('../MVC/services/pte/pteScoringEngineService');

const { scoreListeningAttemptItem } = listeningScoringService;

test('Listening Dictation scorer awards full score for normalized exact transcript match', async () => {
  const result = await scoreListeningAttemptItem({
    item: { questionType: 'listening_dictation' },
    question: {
      questionType: 'listening_dictation',
      payload: {
        expectedTranscript: 'Active listening is vital for success in this particular course.'
      }
    },
    responsePayload: {
      text: 'ACTIVE listening is vital for success in this particular course'
    },
    scoringConfig: {
      method: 'auto_objective',
      maxScore: 1,
      perWordScore: 1
    }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 1);
  assert.equal(result.scorePayload.percentage, 100);
  assert.equal(result.scorePayload.traitScores.content, 1);
  assert.equal(result.metadata.scorerVersion, 'pte-listening-dictation-v1');
});

test('Listening Dictation scorer can score against transcript variants', async () => {
  const result = await scoreListeningAttemptItem({
    item: { questionType: 'listening_dictation' },
    question: {
      questionType: 'listening_dictation',
      payload: {
        expectedTranscript: 'Active listening is vital for success in this particular course.',
        transcriptVariants: [
          'Active listening is important for success in this particular course.',
          'Active listening is vital for success in this course.'
        ]
      }
    },
    responsePayload: {
      responseText: 'Active listening is important for success in this particular course.'
    },
    scoringConfig: {
      method: 'auto_objective',
      maxScore: 1,
      perWordScore: 1
    }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 1);
  assert.equal(result.metadata.aggregationBreakdown.referenceSource, 'variant');
});

test('Listening Dictation scorer gives partial score for partial token coverage', async () => {
  const result = await scoreListeningAttemptItem({
    item: { questionType: 'listening_dictation' },
    question: {
      questionType: 'listening_dictation',
      payload: {
        expectedTranscript: 'Payments can be made with either cash or credit.'
      }
    },
    responsePayload: {
      text: 'Payments can be made cash.'
    },
    scoringConfig: {
      method: 'auto_objective',
      maxScore: 10,
      perWordScore: 2
    }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal > 0, true);
  assert.equal(result.scorePayload.scoreFinal < 10, true);
  assert.equal(result.scorePayload.scoreFinal, 5.56);
  assert.equal(result.metadata.aggregationBreakdown.matchedTokenCount, 5);
  assert.equal(result.metadata.aggregationBreakdown.expectedTokenCount, 9);
});

test('Listening MCQ Single scorer awards full score for correct selected option', async () => {
  const result = await scoreListeningAttemptItem({
    item: { questionType: 'listening_mcq_single' },
    question: {
      questionType: 'listening_mcq_single',
      payload: {
        correctOptionKey: 'B'
      }
    },
    responsePayload: {
      selectedSingle: 'B'
    },
    scoringConfig: {
      method: 'auto_objective',
      maxScore: 1
    }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 1);
  assert.equal(result.scorePayload.traitScores.accuracy, 1);
  assert.equal(result.metadata.scorerVersion, 'pte-listening-mcq-single-v1');
  assert.equal(result.metadata.aggregationBreakdown.isCorrect, true);
});

test('Listening Select Missing Word scorer awards full score for correct selected option', async () => {
  const result = await scoreListeningAttemptItem({
    item: { questionType: 'listening_select_missing_word' },
    question: {
      questionType: 'listening_select_missing_word',
      payload: {
        transcriptWithGap: 'The speaker concluded that consistent practice is ____.',
        options: [
          { key: 'A', text: 'avoidable' },
          { key: 'B', text: 'essential' },
          { key: 'C', text: 'optional' }
        ],
        correctOptionKey: 'B'
      }
    },
    responsePayload: {
      selectedOptionKey: 'B'
    },
    scoringConfig: {
      method: 'auto_objective',
      maxScore: 1
    }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 1);
  assert.equal(result.scorePayload.traitScores.accuracy, 1);
  assert.equal(result.metadata.scorerVersion, 'pte-listening-select-missing-word-v1');
  assert.equal(result.metadata.aggregationBreakdown.isCorrect, true);
});

test('Listening MCQ Multiple scorer supports partial credit', async () => {
  const result = await scoreListeningAttemptItem({
    item: { questionType: 'listening_mcq_multiple' },
    question: {
      questionType: 'listening_mcq_multiple',
      payload: {
        correctOptionKeys: ['A', 'C'],
        partialCreditEnabled: true
      }
    },
    responsePayload: {
      selectedMultiple: ['A']
    },
    scoringConfig: {
      method: 'auto_objective',
      maxScore: 1,
      partialCreditEnabled: true
    }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 0.5);
  assert.equal(result.scorePayload.percentage, 50);
  assert.equal(result.scorePayload.traitScores.accuracy, 0.5);
  assert.equal(result.metadata.scorerVersion, 'pte-listening-mcq-multiple-v1');
  assert.equal(result.metadata.aggregationBreakdown.correctOptionKeys.length, 2);
});

test('Listening Fill in the Blanks scorer awards partial score and accuracy trait', async () => {
  const result = await scoreListeningAttemptItem({
    item: { questionType: 'listening_fill_in_blank' },
    question: {
      questionType: 'listening_fill_in_blank',
      payload: {
        transcriptWithBlanks: 'Students should {{1}} notes after each {{2}}.',
        blankAnswerMap: {
          1: 'review',
          2: 'lecture'
        },
        caseSensitive: false
      }
    },
    responsePayload: {
      blankResponseMap: {
        1: 'review',
        2: 'lesson'
      }
    },
    scoringConfig: {
      method: 'auto_objective',
      maxScore: 1,
      perBlankScore: 1
    }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 0.5);
  assert.equal(result.scorePayload.percentage, 50);
  assert.equal(result.scorePayload.traitScores.accuracy, 0.5);
  assert.equal(result.metadata.scorerVersion, 'pte-listening-fill-in-blank-v1');
  assert.equal(result.metadata.aggregationBreakdown.blankCount, 2);
  assert.equal(result.metadata.aggregationBreakdown.correctCount, 1);
});

test('Listening Highlight Incorrect Words scorer awards partial score from highlighted mismatches', async () => {
  const result = await scoreListeningAttemptItem({
    item: { questionType: 'listening_highlight_incorrect_words' },
    question: {
      questionType: 'listening_highlight_incorrect_words',
      payload: {
        transcript: 'Active listening is vital for success in this particular course.',
        transcriptText: 'Active reading is vital for success in this special course.',
        incorrectWords: ['reading', 'special']
      }
    },
    responsePayload: {
      mapText: JSON.stringify({
        selectedWordIndices: [1],
        selectedWords: ['reading'],
        selectedPhrases: ['reading']
      })
    },
    scoringConfig: {
      method: 'auto_objective',
      maxScore: 1,
      perWordScore: 1
    }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 0.5);
  assert.equal(result.scorePayload.percentage, 50);
  assert.equal(result.scorePayload.traitScores.accuracy, 0.5);
  assert.equal(result.metadata.scorerVersion, 'pte-listening-highlight-incorrect-words-v1');
  assert.equal(result.metadata.aggregationBreakdown.expectedCount, 2);
  assert.equal(result.metadata.aggregationBreakdown.correctCount, 1);
});

test('Scoring engine supports listening dictation and dispatches scorer', async () => {
  assert.equal(scoringEngineService.isAutoScoringSupported('listening_dictation'), true);

  const scored = await scoringEngineService.scoreAttemptItem({
    item: { questionType: 'listening_dictation' },
    question: {
      questionType: 'listening_dictation',
      payload: {
        expectedTranscript: 'Students should review notes after each lecture.'
      }
    },
    responsePayload: {
      text: 'Students should review notes after each lecture.'
    },
    scoringConfig: {
      method: 'auto_objective',
      maxScore: 1,
      perWordScore: 1
    }
  });

  assert.equal(scored.status, 'scored');
  assert.equal(scored.scorePayload.scoreFinal, 1);
  assert.equal(scored.metadata.scorerVersion, 'pte-listening-dictation-v1');
});

test('Scoring engine supports listening mcq single and dispatches scorer', async () => {
  assert.equal(scoringEngineService.isAutoScoringSupported('listening_mcq_single'), true);

  const scored = await scoringEngineService.scoreAttemptItem({
    item: { questionType: 'listening_mcq_single' },
    question: {
      questionType: 'listening_mcq_single',
      payload: {
        correctOptionKey: 'C'
      }
    },
    responsePayload: {
      selectedOptionKey: 'C'
    },
    scoringConfig: {
      method: 'auto_objective',
      maxScore: 1
    }
  });

  assert.equal(scored.status, 'scored');
  assert.equal(scored.scorePayload.scoreFinal, 1);
  assert.equal(scored.metadata.scorerVersion, 'pte-listening-mcq-single-v1');
});

test('Scoring engine supports listening mcq multiple and dispatches scorer', async () => {
  assert.equal(scoringEngineService.isAutoScoringSupported('listening_mcq_multiple'), true);

  const scored = await scoringEngineService.scoreAttemptItem({
    item: { questionType: 'listening_mcq_multiple' },
    question: {
      questionType: 'listening_mcq_multiple',
      payload: {
        correctOptionKeys: ['A', 'D']
      }
    },
    responsePayload: {
      selectedOptionKeys: ['A', 'D']
    },
    scoringConfig: {
      method: 'auto_objective',
      maxScore: 1
    }
  });

  assert.equal(scored.status, 'scored');
  assert.equal(scored.scorePayload.scoreFinal, 1);
  assert.equal(scored.metadata.scorerVersion, 'pte-listening-mcq-multiple-v1');
});

test('Scoring engine supports listening select missing word and dispatches scorer', async () => {
  assert.equal(scoringEngineService.isAutoScoringSupported('listening_select_missing_word'), true);

  const scored = await scoringEngineService.scoreAttemptItem({
    item: { questionType: 'listening_select_missing_word' },
    question: {
      questionType: 'listening_select_missing_word',
      payload: {
        transcriptWithGap: 'Students should attend revision sessions to stay ____. ',
        options: [
          { key: 'A', text: 'focused' },
          { key: 'B', text: 'absent' }
        ],
        correctOptionKey: 'A'
      }
    },
    responsePayload: {
      selectedOptionKey: 'A'
    },
    scoringConfig: {
      method: 'auto_objective',
      maxScore: 1
    }
  });

  assert.equal(scored.status, 'scored');
  assert.equal(scored.scorePayload.scoreFinal, 1);
  assert.equal(scored.metadata.scorerVersion, 'pte-listening-select-missing-word-v1');
});

test('Scoring engine supports listening fill in the blanks and dispatches scorer', async () => {
  assert.equal(scoringEngineService.isAutoScoringSupported('listening_fill_in_blank'), true);

  const scored = await scoringEngineService.scoreAttemptItem({
    item: { questionType: 'listening_fill_in_blank' },
    question: {
      questionType: 'listening_fill_in_blank',
      payload: {
        transcriptWithBlanks: 'This course helps {{1}} communication skills.',
        blankAnswerMap: {
          1: 'improve'
        }
      }
    },
    responsePayload: {
      mapText: '{"1":"improve"}'
    },
    scoringConfig: {
      method: 'auto_objective',
      maxScore: 1,
      perBlankScore: 1
    }
  });

  assert.equal(scored.status, 'scored');
  assert.equal(scored.scorePayload.scoreFinal, 1);
  assert.equal(scored.metadata.scorerVersion, 'pte-listening-fill-in-blank-v1');
});

test('Scoring engine supports listening highlight incorrect words and dispatches scorer', async () => {
  assert.equal(scoringEngineService.isAutoScoringSupported('listening_highlight_incorrect_words'), true);

  const scored = await scoringEngineService.scoreAttemptItem({
    item: { questionType: 'listening_highlight_incorrect_words' },
    question: {
      questionType: 'listening_highlight_incorrect_words',
      payload: {
        transcript: 'Students should review notes after each lecture.',
        transcriptText: 'Students should revise notes after each lecture.',
        incorrectWords: ['revise']
      }
    },
    responsePayload: {
      mapText: JSON.stringify({
        selectedWordIndices: [2],
        selectedWords: ['revise'],
        selectedPhrases: ['revise']
      })
    },
    scoringConfig: {
      method: 'auto_objective',
      maxScore: 1,
      perWordScore: 1
    }
  });

  assert.equal(scored.status, 'scored');
  assert.equal(scored.scorePayload.scoreFinal, 1);
  assert.equal(scored.metadata.scorerVersion, 'pte-listening-highlight-incorrect-words-v1');
});
