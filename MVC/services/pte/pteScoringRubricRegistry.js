const questionTypeRegistry = require('./questionTypeRegistry');

const READ_ALOUD_SCORER_VERSION = 'pte-read-aloud-v1';
const REPEAT_SENTENCE_SCORER_VERSION = 'pte-repeat-sentence-v1';
const ANSWER_SHORT_QUESTION_SCORER_VERSION = 'pte-answer-short-question-v1';
const DESCRIBE_IMAGE_SCORER_VERSION = 'pte-describe-image-v1';
const RESPOND_SITUATION_SCORER_VERSION = 'pte-respond-to-situation-v1';
const WRITING_SUMMARIZE_WRITTEN_TEXT_SCORER_VERSION = 'pte-writing-summarize-written-text-v1';
const WRITING_WRITE_EMAIL_SCORER_VERSION = 'pte-writing-write-email-v1';
const READING_MCQ_SINGLE_SCORER_VERSION = 'pte-reading-mcq-single-v1';
const READING_MCQ_MULTIPLE_SCORER_VERSION = 'pte-reading-mcq-multiple-v1';
const READING_TRUE_FALSE_SCORER_VERSION = 'pte-reading-true-false-v1';
const READING_FILL_IN_BLANK_SCORER_VERSION = 'pte-reading-fill-in-blank-v1';
const READING_WRITING_FILL_IN_BLANK_SCORER_VERSION = 'pte-reading-writing-fill-in-blank-v1';
const READING_REORDER_PARAGRAPHS_SCORER_VERSION = 'pte-reading-reorder-paragraphs-v1';
const READING_MATCHING_SCORER_VERSION = 'pte-reading-matching-v1';
const LISTENING_SUMMARIZE_SPOKEN_TEXT_SCORER_VERSION = 'pte-listening-summarize-spoken-text-v1';
const LISTENING_MCQ_SINGLE_SCORER_VERSION = 'pte-listening-mcq-single-v1';
const LISTENING_MCQ_MULTIPLE_SCORER_VERSION = 'pte-listening-mcq-multiple-v1';
const LISTENING_SELECT_MISSING_WORD_SCORER_VERSION = 'pte-listening-select-missing-word-v1';
const LISTENING_FILL_IN_BLANK_SCORER_VERSION = 'pte-listening-fill-in-blank-v1';
const LISTENING_HIGHLIGHT_INCORRECT_WORDS_SCORER_VERSION = 'pte-listening-highlight-incorrect-words-v1';
const LISTENING_DICTATION_SCORER_VERSION = 'pte-listening-dictation-v1';

const RUBRIC_SOURCES = Object.freeze({
  pearsonAcademicScoreGuide: {
    label: 'Pearson PTE Academic Test Taker Score Guide',
    url: 'https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/resources/PTE-Academic-Test-Taker-Score-Guide.pdf'
  },
  pearsonCore2026ScoreGuide: {
    label: 'Pearson PTE Core Score Guide 2026',
    url: 'https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/pdfs/score-guide-pte-core-2026-01.pdf'
  }
});

const READ_ALOUD_RUBRIC = Object.freeze({
  questionType: 'speaking_read_aloud',
  implemented: true,
  scorerKey: 'speaking_read_aloud',
  scorerVersion: READ_ALOUD_SCORER_VERSION,
  scoringContractVersion: 1,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'hybrid_ai_audio',
  requires: Object.freeze(['source_text', 'uploaded_audio']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide,
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    content: Object.freeze({
      key: 'content',
      maxScore: 'dynamic_source_word_count',
      description: 'Source-word alignment score after replacements, omissions, and insertions are counted as content errors.'
    }),
    pronunciation: Object.freeze({
      key: 'pronunciation',
      minScore: 0,
      maxScore: 5,
      description: 'Audio-grounded intelligibility and pronunciation band.'
    }),
    fluency: Object.freeze({
      key: 'fluency',
      minScore: 0,
      maxScore: 5,
      description: 'Audio-grounded rhythm, phrasing, pausing, hesitation, and rate band.'
    })
  })
});

const ANSWER_SHORT_QUESTION_RUBRIC = Object.freeze({
  questionType: 'speaking_answer_short_question',
  implemented: true,
  scorerKey: 'speaking_answer_short_question',
  scorerVersion: ANSWER_SHORT_QUESTION_SCORER_VERSION,
  scoringContractVersion: 1,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'hybrid_ai_audio_objective',
  requires: Object.freeze(['accepted_answers', 'uploaded_audio']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide
  ]),
  traits: Object.freeze({
    vocabulary: Object.freeze({
      key: 'vocabulary',
      minScore: 0,
      maxScore: 1,
      description: 'Correct/incorrect short-answer vocabulary score: appropriate word choice receives 1 point; inappropriate word choice receives 0.'
    })
  })
});

const REPEAT_SENTENCE_RUBRIC = Object.freeze({
  questionType: 'speaking_repeat_sentence',
  implemented: true,
  scorerKey: 'speaking_repeat_sentence',
  scorerVersion: REPEAT_SENTENCE_SCORER_VERSION,
  scoringContractVersion: 1,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'hybrid_ai_audio_repetition',
  requires: Object.freeze(['expected_transcript', 'uploaded_audio']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide
  ]),
  traits: Object.freeze({
    content: Object.freeze({
      key: 'content',
      minScore: 0,
      maxScore: 3,
      description: 'Ordered prompt-word coverage score: 3 all words in sequence, 2 at least 50%, 1 less than 50%, 0 almost nothing.'
    }),
    pronunciation: Object.freeze({
      key: 'pronunciation',
      minScore: 0,
      maxScore: 5,
      description: 'Audio-grounded intelligibility and pronunciation band.'
    }),
    fluency: Object.freeze({
      key: 'fluency',
      minScore: 0,
      maxScore: 5,
      description: 'Audio-grounded rhythm, phrasing, pausing, hesitation, repetition, and rate band.'
    })
  })
});

const DESCRIBE_IMAGE_RUBRIC = Object.freeze({
  questionType: 'speaking_describe_image',
  implemented: true,
  scorerKey: 'speaking_describe_image',
  scorerVersion: DESCRIBE_IMAGE_SCORER_VERSION,
  scoringContractVersion: 1,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'hybrid_ai_audio_visual',
  requires: Object.freeze(['prompt_image_or_visual_key_points', 'uploaded_audio']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide,
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    content: Object.freeze({
      key: 'content',
      minScore: 0,
      maxScore: 5,
      description: 'Audio-grounded response relevance and coverage of the visual prompt, key features, relationships, and interpretation.'
    }),
    pronunciation: Object.freeze({
      key: 'pronunciation',
      minScore: 0,
      maxScore: 5,
      description: 'Audio-grounded intelligibility and pronunciation band.'
    }),
    fluency: Object.freeze({
      key: 'fluency',
      minScore: 0,
      maxScore: 5,
      description: 'Audio-grounded rhythm, phrasing, pausing, hesitation, repetition, and rate band.'
    })
  })
});

const RESPOND_SITUATION_RUBRIC = Object.freeze({
  questionType: 'speaking_respond_to_situation',
  implemented: true,
  scorerKey: 'speaking_respond_to_situation',
  scorerVersion: RESPOND_SITUATION_SCORER_VERSION,
  scoringContractVersion: 1,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'hybrid_ai_audio_situational',
  requires: Object.freeze(['situation_prompt', 'uploaded_audio']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    appropriacy: Object.freeze({
      key: 'appropriacy',
      minScore: 0,
      maxScore: 3,
      description: 'Situation-appropriate language function, register, politeness, and social-detail coverage.'
    }),
    pronunciation: Object.freeze({
      key: 'pronunciation',
      minScore: 0,
      maxScore: 5,
      description: 'Audio-grounded intelligibility and pronunciation band.'
    }),
    fluency: Object.freeze({
      key: 'fluency',
      minScore: 0,
      maxScore: 5,
      description: 'Audio-grounded rhythm, phrasing, pausing, hesitation, repetition, and rate band.'
    })
  })
});

const WRITING_SUMMARIZE_WRITTEN_TEXT_RUBRIC = Object.freeze({
  questionType: 'writing_summarize_written_text',
  implemented: true,
  scorerKey: 'writing_summarize_written_text',
  scorerVersion: WRITING_SUMMARIZE_WRITTEN_TEXT_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'hybrid_ai_micro_assessment',
  requires: Object.freeze(['source_text', 'typed_response']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide,
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    content: Object.freeze({
      key: 'content',
      minScore: 0,
      maxScore: 2,
      description: 'Micro-assessed source meaning coverage, key-point coverage, and meaning accuracy.'
    }),
    form: Object.freeze({
      key: 'form',
      minScore: 0,
      maxScore: 1,
      description: 'Deterministic single-sentence and word-limit form compliance.'
    }),
    grammar: Object.freeze({
      key: 'grammar',
      minScore: 0,
      maxScore: 2,
      description: 'Micro-assessed grammar, sentence control, and punctuation.'
    }),
    vocabulary: Object.freeze({
      key: 'vocabulary',
      minScore: 0,
      maxScore: 2,
      description: 'Micro-assessed word choice precision, paraphrasing, and vocabulary control.'
    })
  })
});

const WRITING_WRITE_EMAIL_RUBRIC = Object.freeze({
  questionType: 'writing_write_email',
  implemented: true,
  scorerKey: 'writing_write_email',
  scorerVersion: WRITING_WRITE_EMAIL_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'hybrid_ai_micro_assessment',
  requires: Object.freeze(['scenario_prompt', 'required_points', 'typed_response']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    content: Object.freeze({
      key: 'content',
      minScore: 0,
      maxScore: 3,
      description: 'Micro-assessed purpose fulfillment, required-point coverage, and scenario relevance.'
    }),
    emailConventions: Object.freeze({
      key: 'emailConventions',
      minScore: 0,
      maxScore: 2,
      description: 'Micro-assessed greeting, closing, tone, and register fit.'
    }),
    form: Object.freeze({
      key: 'form',
      minScore: 0,
      maxScore: 2,
      description: 'Deterministic word-limit and email-shape form compliance.'
    }),
    organization: Object.freeze({
      key: 'organization',
      minScore: 0,
      maxScore: 2,
      description: 'Micro-assessed sequence, cohesion, and paragraph flow.'
    }),
    vocabulary: Object.freeze({
      key: 'vocabulary',
      minScore: 0,
      maxScore: 2,
      description: 'Micro-assessed word choice accuracy, range, and tone-appropriate vocabulary.'
    }),
    grammar: Object.freeze({
      key: 'grammar',
      minScore: 0,
      maxScore: 2,
      description: 'Micro-assessed grammar accuracy, sentence control, and punctuation.'
    }),
    spelling: Object.freeze({
      key: 'spelling',
      minScore: 0,
      maxScore: 2,
      description: 'Micro-assessed spelling accuracy and typo control.'
    })
  })
});

const LISTENING_SUMMARIZE_SPOKEN_TEXT_RUBRIC = Object.freeze({
  questionType: 'listening_summarize_spoken_text',
  implemented: true,
  scorerKey: 'listening_summarize_spoken_text',
  scorerVersion: LISTENING_SUMMARIZE_SPOKEN_TEXT_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'hybrid_ai_micro_assessment',
  requires: Object.freeze(['prompt_audio_or_transcript_context', 'typed_response']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide,
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    content: Object.freeze({
      key: 'content',
      minScore: 0,
      maxScore: 2,
      description: 'Micro-assessed spoken-source meaning coverage, key-point coverage, and meaning accuracy.'
    }),
    form: Object.freeze({
      key: 'form',
      minScore: 0,
      maxScore: 1,
      description: 'Deterministic single-sentence and word-limit form compliance.'
    }),
    grammar: Object.freeze({
      key: 'grammar',
      minScore: 0,
      maxScore: 2,
      description: 'Micro-assessed grammar, sentence control, and punctuation.'
    }),
    vocabulary: Object.freeze({
      key: 'vocabulary',
      minScore: 0,
      maxScore: 2,
      description: 'Micro-assessed word choice precision, paraphrasing, and vocabulary control.'
    })
  })
});

const READING_MCQ_SINGLE_RUBRIC = Object.freeze({
  questionType: 'reading_mcq_single',
  implemented: true,
  scorerKey: 'reading_mcq_single',
  scorerVersion: READING_MCQ_SINGLE_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'auto_objective',
  requires: Object.freeze(['correct_option_key', 'selected_option_key']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide,
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    accuracy: Object.freeze({
      key: 'accuracy',
      minScore: 'dynamic_negative_marking_or_zero',
      maxScore: 'dynamic_config_max_score',
      description: 'Objective answer-key accuracy score for single-option reading comprehension.'
    })
  })
});

const READING_MCQ_MULTIPLE_RUBRIC = Object.freeze({
  questionType: 'reading_mcq_multiple',
  implemented: true,
  scorerKey: 'reading_mcq_multiple',
  scorerVersion: READING_MCQ_MULTIPLE_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'auto_objective',
  requires: Object.freeze(['correct_option_keys', 'selected_option_keys']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide,
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    accuracy: Object.freeze({
      key: 'accuracy',
      minScore: 'dynamic_negative_marking_or_zero',
      maxScore: 'dynamic_config_max_score',
      description: 'Objective keyed-set accuracy score for multi-select reading comprehension.'
    })
  })
});

const READING_TRUE_FALSE_RUBRIC = Object.freeze({
  questionType: 'reading_true_false',
  implemented: true,
  scorerKey: 'reading_true_false',
  scorerVersion: READING_TRUE_FALSE_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'auto_objective',
  requires: Object.freeze(['correct_value', 'selected_value']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide
  ]),
  traits: Object.freeze({
    accuracy: Object.freeze({
      key: 'accuracy',
      minScore: 'dynamic_negative_marking_or_zero',
      maxScore: 'dynamic_config_max_score',
      description: 'Objective statement-judgement accuracy score against true/false/not-given key.'
    })
  })
});

const READING_FILL_IN_BLANK_RUBRIC = Object.freeze({
  questionType: 'reading_fill_in_blank',
  implemented: true,
  scorerKey: 'reading_fill_in_blank',
  scorerVersion: READING_FILL_IN_BLANK_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'auto_objective',
  requires: Object.freeze(['blank_answer_map', 'blank_response_map']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide,
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    accuracy: Object.freeze({
      key: 'accuracy',
      minScore: 0,
      maxScore: 'dynamic_config_max_score',
      description: 'Objective blank-level completion and accuracy score against keyed answers.'
    })
  })
});

const READING_WRITING_FILL_IN_BLANK_RUBRIC = Object.freeze({
  questionType: 'reading_writing_fill_in_blank',
  implemented: true,
  scorerKey: 'reading_writing_fill_in_blank',
  scorerVersion: READING_WRITING_FILL_IN_BLANK_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'auto_objective',
  requires: Object.freeze(['blank_answer_map', 'blank_response_map']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide,
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    accuracy: Object.freeze({
      key: 'accuracy',
      minScore: 0,
      maxScore: 'dynamic_config_max_score',
      description: 'Objective per-blank option accuracy score for reading and writing fill-in-blanks.'
    })
  })
});

const READING_REORDER_PARAGRAPHS_RUBRIC = Object.freeze({
  questionType: 'reading_reorder_paragraphs',
  implemented: true,
  scorerKey: 'reading_reorder_paragraphs',
  scorerVersion: READING_REORDER_PARAGRAPHS_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'auto_objective',
  requires: Object.freeze(['correct_order', 'submitted_order']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide,
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    accuracy: Object.freeze({
      key: 'accuracy',
      minScore: 0,
      maxScore: 'dynamic_config_max_score',
      description: 'Objective sequence-accuracy score for reordered paragraph positions.'
    })
  })
});

const READING_MATCHING_RUBRIC = Object.freeze({
  questionType: 'reading_matching',
  implemented: true,
  scorerKey: 'reading_matching',
  scorerVersion: READING_MATCHING_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'auto_objective',
  requires: Object.freeze(['correct_pairs', 'submitted_pairs']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide
  ]),
  traits: Object.freeze({
    accuracy: Object.freeze({
      key: 'accuracy',
      minScore: 0,
      maxScore: 'dynamic_config_max_score',
      description: 'Objective pair-level accuracy score for reading matching tasks.'
    })
  })
});

const LISTENING_MCQ_SINGLE_RUBRIC = Object.freeze({
  questionType: 'listening_mcq_single',
  implemented: true,
  scorerKey: 'listening_mcq_single',
  scorerVersion: LISTENING_MCQ_SINGLE_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'auto_objective',
  requires: Object.freeze(['correct_option_key', 'selected_option_key']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide,
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    accuracy: Object.freeze({
      key: 'accuracy',
      minScore: 'dynamic_negative_marking_or_zero',
      maxScore: 'dynamic_config_max_score',
      description: 'Objective answer-key accuracy score for single-option listening comprehension.'
    })
  })
});

const LISTENING_MCQ_MULTIPLE_RUBRIC = Object.freeze({
  questionType: 'listening_mcq_multiple',
  implemented: true,
  scorerKey: 'listening_mcq_multiple',
  scorerVersion: LISTENING_MCQ_MULTIPLE_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'auto_objective',
  requires: Object.freeze(['correct_option_keys', 'selected_option_keys']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide,
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    accuracy: Object.freeze({
      key: 'accuracy',
      minScore: 'dynamic_negative_marking_or_zero',
      maxScore: 'dynamic_config_max_score',
      description: 'Objective keyed-set accuracy score for multi-select listening comprehension.'
    })
  })
});

const LISTENING_SELECT_MISSING_WORD_RUBRIC = Object.freeze({
  questionType: 'listening_select_missing_word',
  implemented: true,
  scorerKey: 'listening_select_missing_word',
  scorerVersion: LISTENING_SELECT_MISSING_WORD_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'auto_objective',
  requires: Object.freeze(['correct_option_key', 'selected_option_key']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide,
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    accuracy: Object.freeze({
      key: 'accuracy',
      minScore: 'dynamic_negative_marking_or_zero',
      maxScore: 'dynamic_config_max_score',
      description: 'Objective answer-key accuracy score for selecting the missing ending word or phrase.'
    })
  })
});

const LISTENING_DICTATION_RUBRIC = Object.freeze({
  questionType: 'listening_dictation',
  implemented: true,
  scorerKey: 'listening_dictation',
  scorerVersion: LISTENING_DICTATION_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'auto_objective',
  requires: Object.freeze(['expected_transcript', 'typed_response']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide,
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    content: Object.freeze({
      key: 'content',
      minScore: 0,
      maxScore: 'dynamic_config_max_score',
      description: 'Objective token-alignment accuracy score against the expected dictation transcript and aligned variants.'
    })
  })
});

const LISTENING_FILL_IN_BLANK_RUBRIC = Object.freeze({
  questionType: 'listening_fill_in_blank',
  implemented: true,
  scorerKey: 'listening_fill_in_blank',
  scorerVersion: LISTENING_FILL_IN_BLANK_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'auto_objective',
  requires: Object.freeze(['blank_answer_map', 'blank_response_map']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide,
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    accuracy: Object.freeze({
      key: 'accuracy',
      minScore: 0,
      maxScore: 'dynamic_config_max_score',
      description: 'Objective blank-level completion and answer-key accuracy score for listening fill-in-blanks.'
    })
  })
});

const LISTENING_HIGHLIGHT_INCORRECT_WORDS_RUBRIC = Object.freeze({
  questionType: 'listening_highlight_incorrect_words',
  implemented: true,
  scorerKey: 'listening_highlight_incorrect_words',
  scorerVersion: LISTENING_HIGHLIGHT_INCORRECT_WORDS_SCORER_VERSION,
  scoringContractVersion: 2,
  scoreScale: 'raw_item_rubric_score',
  officialScoreEstimate: false,
  method: 'auto_objective',
  requires: Object.freeze(['source_transcript', 'display_transcript', 'incorrect_words', 'selected_words']),
  rubricSources: Object.freeze([
    RUBRIC_SOURCES.pearsonAcademicScoreGuide,
    RUBRIC_SOURCES.pearsonCore2026ScoreGuide
  ]),
  traits: Object.freeze({
    accuracy: Object.freeze({
      key: 'accuracy',
      minScore: 0,
      maxScore: 'dynamic_config_max_score',
      description: 'Objective incorrect-word identification accuracy score against keyed transcript differences.'
    })
  })
});

function buildPlaceholderRubric(typeKey = '') {
  const definition = questionTypeRegistry.getDefinition(typeKey) || {};
  const scoringDefaults = definition.scoringDefaults && typeof definition.scoringDefaults === 'object'
    ? definition.scoringDefaults
    : {};
  return Object.freeze({
    questionType: typeKey,
    implemented: false,
    scorerKey: typeKey,
    scorerVersion: '',
    scoringContractVersion: 1,
    scoreScale: 'raw_item_rubric_score',
    officialScoreEstimate: false,
    method: String(scoringDefaults.method || '').trim() || 'manual_or_future_scorer',
    requires: Object.freeze([]),
    rubricSources: Object.freeze([]),
    traits: Object.freeze({})
  });
}

const RUBRICS = Object.freeze(
  (Array.isArray(questionTypeRegistry.QUESTION_TYPE_KEYS) ? questionTypeRegistry.QUESTION_TYPE_KEYS : [])
    .reduce((acc, typeKey) => {
      if (typeKey === 'speaking_read_aloud') acc[typeKey] = READ_ALOUD_RUBRIC;
      else if (typeKey === 'speaking_repeat_sentence') acc[typeKey] = REPEAT_SENTENCE_RUBRIC;
      else if (typeKey === 'speaking_answer_short_question') acc[typeKey] = ANSWER_SHORT_QUESTION_RUBRIC;
      else if (typeKey === 'speaking_describe_image') acc[typeKey] = DESCRIBE_IMAGE_RUBRIC;
      else if (typeKey === 'speaking_respond_to_situation') acc[typeKey] = RESPOND_SITUATION_RUBRIC;
      else if (typeKey === 'writing_summarize_written_text') acc[typeKey] = WRITING_SUMMARIZE_WRITTEN_TEXT_RUBRIC;
      else if (typeKey === 'writing_write_email') acc[typeKey] = WRITING_WRITE_EMAIL_RUBRIC;
      else if (typeKey === 'listening_summarize_spoken_text') acc[typeKey] = LISTENING_SUMMARIZE_SPOKEN_TEXT_RUBRIC;
      else if (typeKey === 'reading_mcq_single') acc[typeKey] = READING_MCQ_SINGLE_RUBRIC;
      else if (typeKey === 'reading_mcq_multiple') acc[typeKey] = READING_MCQ_MULTIPLE_RUBRIC;
      else if (typeKey === 'reading_true_false') acc[typeKey] = READING_TRUE_FALSE_RUBRIC;
      else if (typeKey === 'reading_fill_in_blank') acc[typeKey] = READING_FILL_IN_BLANK_RUBRIC;
      else if (typeKey === 'reading_writing_fill_in_blank') acc[typeKey] = READING_WRITING_FILL_IN_BLANK_RUBRIC;
      else if (typeKey === 'reading_reorder_paragraphs') acc[typeKey] = READING_REORDER_PARAGRAPHS_RUBRIC;
      else if (typeKey === 'reading_matching') acc[typeKey] = READING_MATCHING_RUBRIC;
      else if (typeKey === 'listening_mcq_single') acc[typeKey] = LISTENING_MCQ_SINGLE_RUBRIC;
      else if (typeKey === 'listening_mcq_multiple') acc[typeKey] = LISTENING_MCQ_MULTIPLE_RUBRIC;
      else if (typeKey === 'listening_select_missing_word') acc[typeKey] = LISTENING_SELECT_MISSING_WORD_RUBRIC;
      else if (typeKey === 'listening_fill_in_blank') acc[typeKey] = LISTENING_FILL_IN_BLANK_RUBRIC;
      else if (typeKey === 'listening_highlight_incorrect_words') acc[typeKey] = LISTENING_HIGHLIGHT_INCORRECT_WORDS_RUBRIC;
      else if (typeKey === 'listening_dictation') acc[typeKey] = LISTENING_DICTATION_RUBRIC;
      else acc[typeKey] = buildPlaceholderRubric(typeKey);
      return acc;
    }, {})
);

function clone(value) {
  return JSON.parse(JSON.stringify(value == null ? null : value));
}

function getRubric(questionType = '') {
  const key = String(questionType || '').trim().toLowerCase();
  return RUBRICS[key] ? clone(RUBRICS[key]) : null;
}

function isImplemented(questionType = '') {
  const rubric = getRubric(questionType);
  return rubric?.implemented === true;
}

function listRubrics() {
  return Object.keys(RUBRICS).map((key) => getRubric(key));
}

module.exports = {
  READ_ALOUD_SCORER_VERSION,
  REPEAT_SENTENCE_SCORER_VERSION,
  ANSWER_SHORT_QUESTION_SCORER_VERSION,
  DESCRIBE_IMAGE_SCORER_VERSION,
  RESPOND_SITUATION_SCORER_VERSION,
  WRITING_SUMMARIZE_WRITTEN_TEXT_SCORER_VERSION,
  WRITING_WRITE_EMAIL_SCORER_VERSION,
  READING_MCQ_SINGLE_SCORER_VERSION,
  READING_MCQ_MULTIPLE_SCORER_VERSION,
  READING_TRUE_FALSE_SCORER_VERSION,
  READING_FILL_IN_BLANK_SCORER_VERSION,
  READING_WRITING_FILL_IN_BLANK_SCORER_VERSION,
  READING_REORDER_PARAGRAPHS_SCORER_VERSION,
  READING_MATCHING_SCORER_VERSION,
  LISTENING_SUMMARIZE_SPOKEN_TEXT_SCORER_VERSION,
  LISTENING_MCQ_SINGLE_SCORER_VERSION,
  LISTENING_MCQ_MULTIPLE_SCORER_VERSION,
  LISTENING_SELECT_MISSING_WORD_SCORER_VERSION,
  LISTENING_FILL_IN_BLANK_SCORER_VERSION,
  LISTENING_HIGHLIGHT_INCORRECT_WORDS_SCORER_VERSION,
  LISTENING_DICTATION_SCORER_VERSION,
  RUBRIC_SOURCES,
  getRubric,
  isImplemented,
  listRubrics
};
