const rubricRegistry = require('./pteScoringRubricRegistry');
const readAloudScoringService = require('./pteReadAloudScoringService');
const repeatSentenceScoringService = require('./pteRepeatSentenceScoringService');
const answerShortQuestionScoringService = require('./pteAnswerShortQuestionScoringService');
const describeImageScoringService = require('./pteDescribeImageScoringService');
const respondSituationScoringService = require('./pteRespondSituationScoringService');
const writingScoringService = require('./pteWritingScoringService');
const readingScoringService = require('./pteReadingScoringService');
const listeningScoringService = require('./pteListeningScoringService');

function s(value) {
  return String(value ?? '').trim();
}

async function scoreAttemptItem({
  session = {},
  item = {},
  question = {},
  artifacts = [],
  responsePayload = {},
  scoringConfig = {},
  requestingUser = null
} = {}, options = {}) {
  const questionType = s(item.questionType || question.questionType).toLowerCase();
  const rubric = rubricRegistry.getRubric(questionType);
  if (!rubric || rubric.implemented !== true) {
    return {
      status: 'unsupported',
      scorePayload: null,
      metadata: {
        status: 'unsupported',
        questionType,
        scorerKey: questionType,
        scorerVersion: '',
        warnings: ['No automated scorer is implemented for this question type yet.']
      },
      warnings: ['No automated scorer is implemented for this question type yet.']
    };
  }

  if (questionType === 'speaking_read_aloud') {
    return readAloudScoringService.scoreReadAloudAttemptItem({
      session,
      item,
      question,
      artifacts,
      responsePayload,
      scoringConfig,
      requestingUser
    }, options);
  }

  if (questionType === 'speaking_repeat_sentence') {
    return repeatSentenceScoringService.scoreRepeatSentenceAttemptItem({
      session,
      item,
      question,
      artifacts,
      responsePayload,
      scoringConfig,
      requestingUser
    }, options);
  }

  if (questionType === 'speaking_answer_short_question') {
    return answerShortQuestionScoringService.scoreAnswerShortQuestionAttemptItem({
      session,
      item,
      question,
      artifacts,
      responsePayload,
      scoringConfig,
      requestingUser
    }, options);
  }

  if (questionType === 'speaking_describe_image') {
    return describeImageScoringService.scoreDescribeImageAttemptItem({
      session,
      item,
      question,
      artifacts,
      responsePayload,
      scoringConfig,
      requestingUser
    }, options);
  }

  if (questionType === 'speaking_respond_to_situation') {
    return respondSituationScoringService.scoreRespondSituationAttemptItem({
      session,
      item,
      question,
      artifacts,
      responsePayload,
      scoringConfig,
      requestingUser
    }, options);
  }

  if (
    questionType === 'writing_summarize_written_text'
    || questionType === 'writing_write_email'
    || questionType === 'listening_summarize_spoken_text'
  ) {
    return writingScoringService.scoreWritingAttemptItem({
      session,
      item,
      question,
      artifacts,
      responsePayload,
      scoringConfig,
      requestingUser
    }, options);
  }

  if (
    questionType === 'reading_mcq_single'
    || questionType === 'reading_mcq_multiple'
    || questionType === 'reading_true_false'
    || questionType === 'reading_fill_in_blank'
    || questionType === 'reading_writing_fill_in_blank'
    || questionType === 'reading_reorder_paragraphs'
    || questionType === 'reading_matching'
  ) {
    return readingScoringService.scoreReadingAttemptItem({
      session,
      item,
      question,
      artifacts,
      responsePayload,
      scoringConfig,
      requestingUser
    }, options);
  }

  if (
    questionType === 'listening_mcq_single'
    || questionType === 'listening_mcq_multiple'
    || questionType === 'listening_select_missing_word'
    || questionType === 'listening_dictation'
    || questionType === 'listening_fill_in_blank'
    || questionType === 'listening_highlight_incorrect_words'
  ) {
    return listeningScoringService.scoreListeningAttemptItem({
      session,
      item,
      question,
      artifacts,
      responsePayload,
      scoringConfig,
      requestingUser
    }, options);
  }

  return {
    status: 'unsupported',
    scorePayload: null,
    metadata: {
      status: 'unsupported',
      questionType,
      scorerKey: questionType,
      scorerVersion: rubric.scorerVersion || '',
      warnings: ['No automated scorer dispatcher exists for this question type.']
    },
    warnings: ['No automated scorer dispatcher exists for this question type.']
  };
}

function isAutoScoringSupported(questionType = '') {
  return rubricRegistry.isImplemented(questionType);
}

module.exports = {
  scoreAttemptItem,
  isAutoScoringSupported,
  getRubric: rubricRegistry.getRubric,
  listRubrics: rubricRegistry.listRubrics
};
