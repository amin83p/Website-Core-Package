const test = require('node:test');
const assert = require('node:assert/strict');

const reportViewService = require('../MVC/services/school/reportViewService');

const template = {
  id: 'TPL_PARSE',
  schema: {
    fields: [
      { id: 'flag', label: 'Flag', type: 'checkbox', valueMode: 'manual' },
      { id: 'score', label: 'Score', type: 'number', valueMode: 'manual' },
      { id: 'note', label: 'Note', type: 'text', valueMode: 'manual' }
    ]
  }
};

test('buildInstanceAnswers treats missing checkbox as false', () => {
  const existing = { flag: true, score: 5, note: 'old' };
  const { answers } = reportViewService.buildInstanceAnswers(template, {}, existing);
  assert.equal(answers.flag, false);
});

test('buildInstanceAnswers parses checkbox on/true/1', () => {
  const { answers: on } = reportViewService.buildInstanceAnswers(template, { field__flag: 'on' }, {});
  const { answers: str } = reportViewService.buildInstanceAnswers(template, { field__flag: 'true' }, {});
  const { answers: num } = reportViewService.buildInstanceAnswers(template, { field__flag: '1' }, {});
  assert.equal(on.flag, true);
  assert.equal(str.flag, true);
  assert.equal(num.flag, true);
});

test('buildInstanceAnswers parses explicit checkbox false', () => {
  const { answers } = reportViewService.buildInstanceAnswers(template, { field__flag: 'false' }, { flag: true });
  assert.equal(answers.flag, false);
});

test('buildInstanceAnswers falls back to existing for missing number field', () => {
  const { answers } = reportViewService.buildInstanceAnswers(template, { field__note: 'new' }, { score: 42 });
  assert.equal(answers.score, 42);
  assert.equal(answers.note, 'new');
});