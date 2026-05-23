(function buildPtePracticeCoachRulesModule(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.ptePracticeCoachRules = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createPtePracticeCoachRules() {
  'use strict';

  var CORE_TYPES = Object.freeze([
    'speaking_read_aloud',
    'speaking_repeat_sentence',
    'speaking_describe_image',
    'speaking_respond_to_situation',
    'writing_summarize_written_text',
    'writing_write_email',
    'reading_mcq_single',
    'reading_mcq_multiple',
    'reading_writing_fill_in_blank',
    'reading_fill_in_blank',
    'reading_reorder_paragraphs',
    'listening_summarize_spoken_text',
    'listening_mcq_single',
    'listening_mcq_multiple',
    'listening_fill_in_blank',
    'listening_select_missing_word',
    'listening_highlight_incorrect_words',
    'listening_dictation'
  ]);

  function clean(value) {
    return String(value == null ? '' : value).replace(/\0/g, '').trim();
  }

  function toInt(value, fallback) {
    var numeric = Number.parseInt(String(value == null ? '' : value), 10);
    if (!Number.isFinite(numeric) || Number.isNaN(numeric)) return Number(fallback || 0);
    return numeric;
  }

  function countWords(value) {
    var token = clean(value);
    if (!token) return 0;
    return token.split(/\s+/).filter(Boolean).length;
  }

  function normalizeQuestionTypeToken(questionType) {
    return clean(questionType).toLowerCase().replace(/[\s-]+/g, '_');
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function parseJsonObject(rawText) {
    var token = clean(rawText);
    if (!token) return {};
    try {
      var parsed = JSON.parse(token);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function parseJsonArray(rawText) {
    var token = clean(rawText);
    if (!token) return [];
    try {
      var parsed = JSON.parse(token);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function normalizeText(value) {
    return clean(value).replace(/\s+/g, ' ').toLowerCase();
  }

  function normalizeList(values) {
    return asArray(values).map(function eachValue(value) {
      return clean(value);
    }).filter(Boolean);
  }

  function normalizeSet(values) {
    return new Set(normalizeList(values).map(function toKey(value) {
      return value.toLowerCase();
    }));
  }

  function getResponseText(response) {
    if (!response || typeof response !== 'object') return '';
    return clean(response.text || response.transcript || '');
  }

  function getResponseBlankMap(response) {
    if (!response || typeof response !== 'object') return {};
    var fromMapText = parseJsonObject(response.mapText || '');
    if (Object.keys(fromMapText).length) return fromMapText;
    return response.blankMap && typeof response.blankMap === 'object' ? response.blankMap : {};
  }

  function getResponseOrderRows(response) {
    if (!response || typeof response !== 'object') return [];
    var mapToken = clean(response.mapText || '');
    if (!mapToken) return [];

    var parsedObj = parseJsonObject(mapToken);
    if (Array.isArray(parsedObj.submittedOrder)) {
      return normalizeList(parsedObj.submittedOrder);
    }
    if (Array.isArray(parsedObj.order)) {
      return normalizeList(parsedObj.order);
    }

    var parsedArray = parseJsonArray(mapToken);
    if (parsedArray.length) return normalizeList(parsedArray);

    return mapToken.split(/\r?\n/).map(function byLine(row) { return clean(row); }).filter(Boolean);
  }

  function getHintFamily(type) {
    if (type === 'reading_mcq_single' || type === 'listening_mcq_single' || type === 'listening_select_missing_word') return 'mcq_single';
    if (type === 'reading_mcq_multiple' || type === 'listening_mcq_multiple') return 'mcq_multiple';
    if (type === 'reading_fill_in_blank' || type === 'listening_fill_in_blank') return 'fill_blank_text';
    if (type === 'reading_writing_fill_in_blank') return 'fill_blank_dropdown';
    if (type === 'reading_reorder_paragraphs') return 'reorder';
    if (type === 'writing_summarize_written_text' || type === 'listening_summarize_spoken_text') return 'summary';
    if (type === 'writing_write_email') return 'email';
    if (type === 'listening_dictation') return 'dictation';
    if (type === 'listening_highlight_incorrect_words') return 'highlight_incorrect_words';
    if (type.indexOf('speaking_') === 0) return 'speaking';
    return 'generic';
  }

  function getHintProfile(type) {
    var token = normalizeQuestionTypeToken(type);
    var family = getHintFamily(token);
    return {
      questionType: token,
      family: family,
      supportsHints: CORE_TYPES.indexOf(token) >= 0
    };
  }

  function getHintRowsForFamily(family, context) {
    var payload = (context && context.payload && typeof context.payload === 'object') ? context.payload : {};
    var response = (context && context.response && typeof context.response === 'object') ? context.response : {};
    var answerMap = payload.blankAnswerMap && typeof payload.blankAnswerMap === 'object' ? payload.blankAnswerMap : {};
    var blanks = Object.keys(answerMap);
    var selectedCount = asArray(response.selectedMultiple).length;
    var expectedSelectCount = asArray(payload.correctOptionKeys).length;
    var wordCount = countWords(getResponseText(response));
    var minWords = Math.max(0, toInt(payload.minWords, 0));
    var maxWords = Math.max(0, toInt(payload.maxWords, 0));

    if (family === 'mcq_single') {
      return [
        'Locate the stem keyword, then verify one line of direct support before choosing.',
        'Eliminate at least two weak options by checking contradiction, scope, or unsupported detail.',
        'Re-read the key sentence and confirm the chosen option is the best fit in meaning and tone.'
      ];
    }
    if (family === 'mcq_multiple') {
      return [
        'Treat each option independently and keep only options with direct evidence.',
        expectedSelectCount > 0
          ? ('Aim for exactly ' + expectedSelectCount + ' selections; avoid over-selecting based on similar wording.')
          : 'Select only options with explicit support; avoid selecting based on topic similarity.',
        (selectedCount > 0)
          ? 'Check each selected option against the stem again and remove any that rely on assumptions.'
          : 'Start by picking the strongest evidence-backed option, then test whether any second option is equally supported.'
      ];
    }
    if (family === 'fill_blank_text' || family === 'fill_blank_dropdown') {
      return [
        'Use grammar first: decide the required part of speech before choosing a word.',
        blanks.length
          ? ('Review each blank in a 3-5 word window around it to preserve meaning and cohesion across ' + blanks.length + ' gaps.')
          : 'Review each blank in a short local window and keep sentence logic consistent.',
        'After filling all gaps, read the full sentence aloud and replace any word that sounds awkward in context.'
      ];
    }
    if (family === 'reorder') {
      return [
        'Find the opener first: avoid paragraphs starting with pronouns/references unless antecedents appear earlier.',
        'Use logical anchors such as chronology, contrast linkers, and cause-effect connectors to chain paragraphs.',
        'Verify the final order by checking that each paragraph follows naturally from the previous one.'
      ];
    }
    if (family === 'summary') {
      return [
        'Focus on main idea + key support; avoid minor details.',
        (minWords > 0 || maxWords > 0)
          ? ('Keep length in the target range'
            + (minWords > 0 ? (' (min ' + minWords + ')') : '')
            + (maxWords > 0 ? (' (max ' + maxWords + ')') : '')
            + '.')
          : 'Keep your response concise and logically ordered.',
        wordCount > 0
          ? ('Current draft is ' + wordCount + ' words; revise for clarity, cohesion, and precise wording.')
          : 'Draft one clear response first, then tighten wording for precision and cohesion.'
      ];
    }
    if (family === 'email') {
      var requiredPointCount = asArray(payload.requiredPoints).length;
      return [
        'Cover purpose early, then address each required point clearly.',
        requiredPointCount > 0
          ? ('Check that all ' + requiredPointCount + ' required point(s) are explicitly covered in separate sentences.')
          : 'Check tone, purpose, and completeness before submitting.',
        'Finish with a clear closing line that matches the required register and audience.'
      ];
    }
    if (family === 'dictation') {
      return [
        'Reconstruct the sentence in chunks and keep original function words and endings.',
        'Prioritize exact wording, punctuation, and capitalization after drafting.',
        'Do one slow pass: compare each phrase against what you heard and correct small grammar slips.'
      ];
    }
    if (family === 'highlight_incorrect_words') {
      return [
        'Highlight only words that differ from the expected wording; do not select punctuation.',
        'Compare phrase-by-phrase and watch for tense, number, and article mismatches.',
        'Recheck highlighted words to remove any that are actually unchanged in meaning and form.'
      ];
    }
    if (family === 'speaking') {
      return [
        'Plan quickly: opening idea, 1-2 key points, and a short closing line.',
        'Keep delivery steady with clear pronunciation and minimal long pauses.',
        'Before finishing, ensure your response directly addresses the prompt purpose and audience.'
      ];
    }
    return [
      'Answer the task directly and keep your response aligned with the instruction.',
      'Check completeness and clarity before submitting.',
      'Make one final pass to remove avoidable mistakes.'
    ];
  }

  function getHint(context) {
    var type = normalizeQuestionTypeToken(context && context.questionType);
    var profile = getHintProfile(type);
    var level = Math.min(3, Math.max(1, toInt(context && context.level, 1)));
    var rows = getHintRowsForFamily(profile.family, context || {});
    var text = rows[level - 1] || rows[rows.length - 1] || '';
    return {
      questionType: type,
      family: profile.family,
      level: level,
      text: text
    };
  }

  function pushCheck(checks, id, label, passed, detail) {
    checks.push({
      id: clean(id),
      label: clean(label),
      status: passed ? 'pass' : 'warn',
      detail: clean(detail)
    });
  }

  function runSelfCheck(context) {
    var type = normalizeQuestionTypeToken(context && context.questionType);
    var payload = (context && context.payload && typeof context.payload === 'object') ? context.payload : {};
    var response = (context && context.response && typeof context.response === 'object') ? context.response : {};
    var checks = [];
    var text = getResponseText(response);
    var words = countWords(text);

    if (type === 'reading_mcq_single' || type === 'listening_mcq_single' || type === 'listening_select_missing_word') {
      var selectedSingle = clean(response.selectedSingle);
      pushCheck(
        checks,
        'single_selected',
        'One option selected',
        !!selectedSingle,
        selectedSingle ? ('Selected option ' + selectedSingle + '.') : 'No option selected yet.'
      );
    } else if (type === 'reading_mcq_multiple' || type === 'listening_mcq_multiple') {
      var selectedMultiple = normalizeList(response.selectedMultiple);
      var expectedCount = asArray(payload.correctOptionKeys).length;
      pushCheck(
        checks,
        'multiple_non_empty',
        'At least one option selected',
        selectedMultiple.length > 0,
        selectedMultiple.length > 0
          ? ('Selected ' + selectedMultiple.length + ' option(s).')
          : 'No options selected yet.'
      );
      if (expectedCount > 0) {
        pushCheck(
          checks,
          'multiple_target_count',
          'Selection count aligns with task',
          selectedMultiple.length === expectedCount,
          selectedMultiple.length === expectedCount
            ? 'Selection count matches expected response format.'
            : ('You selected ' + selectedMultiple.length + ' but this task usually needs ' + expectedCount + '.')
        );
      }
    } else if (type === 'reading_fill_in_blank' || type === 'listening_fill_in_blank' || type === 'reading_writing_fill_in_blank') {
      var answerMap = payload.blankAnswerMap && typeof payload.blankAnswerMap === 'object' ? payload.blankAnswerMap : {};
      var expectedKeys = Object.keys(answerMap);
      var responseMap = getResponseBlankMap(response);
      var filledCount = expectedKeys.filter(function eachBlank(key) {
        return clean(responseMap[key]);
      }).length;
      pushCheck(
        checks,
        'blanks_complete',
        'All blanks completed',
        expectedKeys.length > 0 && filledCount === expectedKeys.length,
        expectedKeys.length > 0
          ? (filledCount + ' / ' + expectedKeys.length + ' blank(s) completed.')
          : 'No blank map was found for this task.'
      );
    } else if (type === 'reading_reorder_paragraphs') {
      var paragraphRows = normalizeList(payload.paragraphItems);
      var submittedOrder = getResponseOrderRows(response);
      var uniqueCount = new Set(submittedOrder.map(function toKey(value) { return value.toLowerCase(); })).size;
      pushCheck(
        checks,
        'reorder_length',
        'All paragraph slots arranged',
        paragraphRows.length > 0 && submittedOrder.length === paragraphRows.length,
        paragraphRows.length > 0
          ? ('Arranged ' + submittedOrder.length + ' / ' + paragraphRows.length + ' paragraph(s).')
          : 'No authored paragraph set was found.'
      );
      pushCheck(
        checks,
        'reorder_unique',
        'No duplicate paragraph in order',
        submittedOrder.length === uniqueCount,
        submittedOrder.length === uniqueCount
          ? 'Each paragraph appears once.'
          : 'Duplicate paragraph detected in your current order.'
      );
    } else if (type === 'writing_summarize_written_text' || type === 'writing_write_email' || type === 'listening_summarize_spoken_text') {
      var minWords = Math.max(0, toInt(payload.minWords, 0));
      var maxWords = Math.max(0, toInt(payload.maxWords, 0));
      pushCheck(
        checks,
        'text_non_empty',
        'Response drafted',
        words > 0,
        words > 0 ? ('Draft contains ' + words + ' words.') : 'No draft text yet.'
      );
      if (minWords > 0 || maxWords > 0) {
        var withinMin = minWords <= 0 || words >= minWords;
        var withinMax = maxWords <= 0 || words <= maxWords;
        pushCheck(
          checks,
          'text_range',
          'Word range check',
          words > 0 && withinMin && withinMax,
          words > 0
            ? ('Current length: ' + words + ' words; target '
              + (minWords > 0 ? ('min ' + minWords) : 'open min')
              + ', '
              + (maxWords > 0 ? ('max ' + maxWords) : 'open max')
              + '.')
            : 'Word range check will run after you draft the response.'
        );
      }
    } else if (type === 'listening_dictation') {
      pushCheck(
        checks,
        'dictation_non_empty',
        'Dictation response drafted',
        words > 0,
        words > 0 ? ('Draft contains ' + words + ' words.') : 'No dictation text entered yet.'
      );
    } else if (type === 'listening_highlight_incorrect_words') {
      var selectedRows = normalizeList(text.split(/\r?\n/));
      pushCheck(
        checks,
        'highlight_non_empty',
        'At least one word highlighted',
        selectedRows.length > 0,
        selectedRows.length > 0 ? ('Selected ' + selectedRows.length + ' candidate word(s).') : 'No highlighted words selected yet.'
      );
    } else if (type.indexOf('speaking_') === 0) {
      var audioSeconds = Math.max(0, Number(response.audioDurationSeconds || 0) || 0);
      var transcriptText = clean(response.transcript || response.text || '');
      pushCheck(
        checks,
        'speaking_recorded',
        'Recording captured',
        audioSeconds > 0 || transcriptText.length > 0,
        audioSeconds > 0
          ? ('Recorded audio length: ' + Math.round(audioSeconds) + ' second(s).')
          : (transcriptText.length > 0 ? 'Transcript text exists for this response.' : 'No recorded answer detected yet.')
      );
    } else {
      pushCheck(
        checks,
        'generic_non_empty',
        'Response drafted',
        words > 0 || clean(response.mapText),
        words > 0 || clean(response.mapText)
          ? 'You have a response draft to submit.'
          : 'No response detected yet.'
      );
    }

    var passCount = checks.filter(function eachCheck(row) { return row.status === 'pass'; }).length;
    var warnCount = checks.length - passCount;
    return {
      questionType: type,
      passCount: passCount,
      warnCount: warnCount,
      passed: warnCount === 0,
      checks: checks
    };
  }

  function computeSetFeedback(selectedRows, correctRows) {
    var selectedSet = normalizeSet(selectedRows);
    var correctSet = normalizeSet(correctRows);
    var correctSelections = [];
    var missingSelections = [];
    var extraSelections = [];

    correctSet.forEach(function eachCorrect(key) {
      if (selectedSet.has(key)) correctSelections.push(key);
      else missingSelections.push(key);
    });
    selectedSet.forEach(function eachSelected(key) {
      if (!correctSet.has(key)) extraSelections.push(key);
    });

    return {
      correctCount: correctSelections.length,
      expectedCount: correctSet.size,
      missingCount: missingSelections.length,
      extraCount: extraSelections.length
    };
  }

  function buildAfterSubmitFeedback(context) {
    var type = normalizeQuestionTypeToken(context && context.questionType);
    var payload = (context && context.payload && typeof context.payload === 'object') ? context.payload : {};
    var response = (context && context.response && typeof context.response === 'object') ? context.response : {};

    var good = [];
    var improve = [];
    var next = [];

    if (type === 'reading_mcq_single' || type === 'listening_mcq_single' || type === 'listening_select_missing_word') {
      var selectedSingle = clean(response.selectedSingle);
      var correctSingle = clean(payload.correctOptionKey);
      if (selectedSingle && correctSingle && selectedSingle.toLowerCase() === correctSingle.toLowerCase()) {
        good.push('You selected the correct option.');
        next.push('Keep validating your choice with one direct evidence line.');
      } else {
        improve.push(selectedSingle ? ('Selected option ' + selectedSingle + ' is not the keyed answer.') : 'No option was selected.');
        next.push('Re-read the stem and eliminate options that are off-scope or unsupported.');
      }
    } else if (type === 'reading_mcq_multiple' || type === 'listening_mcq_multiple') {
      var setFeedback = computeSetFeedback(response.selectedMultiple, payload.correctOptionKeys);
      if (setFeedback.correctCount > 0) good.push('You selected ' + setFeedback.correctCount + ' correct option(s).');
      if (setFeedback.missingCount > 0) improve.push('You missed ' + setFeedback.missingCount + ' keyed option(s).');
      if (setFeedback.extraCount > 0) improve.push('You selected ' + setFeedback.extraCount + ' unsupported option(s).');
      if (!setFeedback.correctCount && !setFeedback.missingCount && !setFeedback.extraCount) {
        improve.push('No selection evidence found for this item.');
      }
      next.push('Select only options with explicit support in the passage/audio context.');
    } else if (type === 'reading_fill_in_blank' || type === 'listening_fill_in_blank' || type === 'reading_writing_fill_in_blank') {
      var answerMap = payload.blankAnswerMap && typeof payload.blankAnswerMap === 'object' ? payload.blankAnswerMap : {};
      var responseMap = getResponseBlankMap(response);
      var keys = Object.keys(answerMap);
      var exactCount = 0;
      var missingCount = 0;
      keys.forEach(function eachKey(key) {
        var expected = normalizeText(answerMap[key]);
        var actual = normalizeText(responseMap[key]);
        if (!actual) {
          missingCount += 1;
          return;
        }
        if (expected && actual === expected) exactCount += 1;
      });
      if (exactCount > 0) good.push(exactCount + ' blank(s) match the keyed answer.');
      if (missingCount > 0) improve.push(missingCount + ' blank(s) are still empty.');
      if (keys.length > exactCount + missingCount) {
        improve.push((keys.length - exactCount - missingCount) + ' blank(s) are filled but do not match keyed answers.');
      }
      next.push('Check grammar role and local context around each gap before finalizing.');
    } else if (type === 'reading_reorder_paragraphs') {
      var correctOrder = normalizeList(payload.correctOrder);
      var submittedOrder = getResponseOrderRows(response);
      var aligned = 0;
      var compareCount = Math.min(correctOrder.length, submittedOrder.length);
      for (var i = 0; i < compareCount; i += 1) {
        if (normalizeText(correctOrder[i]) === normalizeText(submittedOrder[i])) aligned += 1;
      }
      if (aligned > 0) good.push(aligned + ' paragraph position(s) are correct.');
      if (compareCount < correctOrder.length) {
        improve.push('Order is incomplete; not all paragraphs were arranged.');
      } else if (aligned < correctOrder.length) {
        improve.push((correctOrder.length - aligned) + ' paragraph position(s) need reordering.');
      }
      next.push('Anchor the opener first, then follow connector logic between adjacent paragraphs.');
    } else if (type === 'listening_highlight_incorrect_words') {
      var selectedRows = normalizeList(getResponseText(response).split(/\r?\n/));
      var expectedRows = normalizeList(payload.incorrectWords);
      var hiwFeedback = computeSetFeedback(selectedRows, expectedRows);
      if (hiwFeedback.correctCount > 0) good.push('You captured ' + hiwFeedback.correctCount + ' keyed incorrect word(s).');
      if (hiwFeedback.missingCount > 0) improve.push(hiwFeedback.missingCount + ' keyed incorrect word(s) were missed.');
      if (hiwFeedback.extraCount > 0) improve.push(hiwFeedback.extraCount + ' selected word(s) are not keyed as incorrect.');
      next.push('Compare transcript words phrase-by-phrase and focus on exact form changes.');
    } else if (type === 'listening_dictation') {
      var dictationText = normalizeText(response.text || '');
      var expectedText = normalizeText(payload.expectedTranscript || '');
      if (dictationText && expectedText && dictationText === expectedText) {
        good.push('Your dictation matches the keyed transcript exactly.');
      } else {
        var draftWords = countWords(response.text || '');
        if (draftWords > 0) good.push('You produced a complete dictation draft.');
        improve.push('Exact wording still differs from the keyed transcript.');
      }
      next.push('Do a final pass for function words, endings, punctuation, and capitalization.');
    } else if (type === 'writing_summarize_written_text' || type === 'writing_write_email' || type === 'listening_summarize_spoken_text') {
      var draftText = getResponseText(response);
      var totalWords = countWords(draftText);
      var minWords = Math.max(0, toInt(payload.minWords, 0));
      var maxWords = Math.max(0, toInt(payload.maxWords, 0));
      if (totalWords > 0) good.push('You submitted a complete draft (' + totalWords + ' words).');
      if ((minWords > 0 && totalWords < minWords) || (maxWords > 0 && totalWords > maxWords)) {
        improve.push('Draft length is outside the target range.');
      } else if (minWords > 0 || maxWords > 0) {
        good.push('Draft length is within the target range.');
      }
      if (type === 'writing_write_email') {
        var requiredPoints = normalizeList(payload.requiredPoints);
        if (requiredPoints.length) {
          var lowerDraft = normalizeText(draftText);
          var coveredPoints = requiredPoints.filter(function eachPoint(point) {
            var cue = normalizeText(point);
            if (!cue) return false;
            return lowerDraft.indexOf(cue) >= 0;
          }).length;
          if (coveredPoints > 0) good.push('Draft appears to address ' + coveredPoints + ' required point(s).');
          if (coveredPoints < requiredPoints.length) {
            improve.push((requiredPoints.length - coveredPoints) + ' required point(s) may still be missing explicitly.');
          }
        }
      }
      next.push('Revise once for clarity, cohesion, and direct task fulfillment.');
    } else if (type.indexOf('speaking_') === 0) {
      var duration = Math.max(0, Number(response.audioDurationSeconds || 0) || 0);
      var transcriptLength = countWords(response.transcript || response.text || '');
      if (duration > 0) good.push('Recording captured (' + Math.round(duration) + ' seconds).');
      if (transcriptLength > 0) good.push('Response content is available for review.');
      if (duration <= 0 && transcriptLength <= 0) {
        improve.push('No speaking evidence was detected for scoring review.');
      }
      next.push('On the next attempt, keep delivery steady and align closely to prompt purpose.');
    } else {
      var genericWords = countWords(getResponseText(response));
      if (genericWords > 0) good.push('You submitted a response draft.');
      else improve.push('No response content was detected.');
      next.push('Review task requirements and tighten your final response.');
    }

    if (!good.length) good.push('You completed this attempt and can iterate using targeted revisions.');
    if (!improve.length) improve.push('No critical deterministic issue found in the current structure.');

    return {
      questionType: type,
      whatWentWell: good,
      whatToImprove: improve,
      tryThisNext: next
    };
  }

  function hasHintProfile(type) {
    var token = normalizeQuestionTypeToken(type);
    return CORE_TYPES.indexOf(token) >= 0;
  }

  return {
    CORE_TYPES: CORE_TYPES.slice(),
    normalizeQuestionTypeToken: normalizeQuestionTypeToken,
    hasHintProfile: hasHintProfile,
    getHintProfile: getHintProfile,
    getHint: getHint,
    runSelfCheck: runSelfCheck,
    buildAfterSubmitFeedback: buildAfterSubmitFeedback
  };
}));
