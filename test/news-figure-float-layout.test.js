'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isEmptyQuillParagraph,
  planFloatParagraphClasses
} = require('../public/scripts/news/quillNewsFigureFloatLayout');

test('planFloatParagraphClasses marks leading empty lines as float gap', () => {
  const blocks = [
    { kind: 'figure', floatLayout: 'float-left' },
    { kind: 'p', isEmpty: true },
    { kind: 'p', isEmpty: false }
  ];
  const plans = planFloatParagraphClasses(blocks);
  assert.equal(plans.length, 2);
  assert.deepEqual(plans[0], { clear: false, floatGap: true, postFloat: false });
  assert.deepEqual(plans[1], { clear: false, floatGap: false, postFloat: false });
});

test('planFloatParagraphClasses requires two empty lines after wrap text to clear float', () => {
  const blocks = [
    { kind: 'figure', floatLayout: 'float-right' },
    { kind: 'p', isEmpty: false },
    { kind: 'p', isEmpty: true },
    { kind: 'p', isEmpty: false }
  ];
  const plans = planFloatParagraphClasses(blocks);
  assert.deepEqual(plans[0], { clear: false, floatGap: false, postFloat: false });
  assert.deepEqual(plans[1], { clear: false, floatGap: true, postFloat: false });
  assert.deepEqual(plans[2], { clear: false, floatGap: false, postFloat: false });
});

test('planFloatParagraphClasses clears on second consecutive empty after wrap and post-floats following paragraphs', () => {
  const blocks = [
    { kind: 'figure', floatLayout: 'float-right' },
    { kind: 'p', isEmpty: false },
    { kind: 'p', isEmpty: true },
    { kind: 'p', isEmpty: true },
    { kind: 'p', isEmpty: false }
  ];
  const plans = planFloatParagraphClasses(blocks);
  assert.deepEqual(plans[1], { clear: false, floatGap: true, postFloat: false });
  assert.deepEqual(plans[2], { clear: true, floatGap: false, postFloat: false });
  assert.deepEqual(plans[3], { clear: false, floatGap: false, postFloat: true });
});

test('isEmptyQuillParagraph detects Quill empty paragraph nodes', () => {
  const p = {
    nodeName: 'P',
    textContent: '',
    innerHTML: '<br>'
  };
  assert.equal(isEmptyQuillParagraph(p), true);
  assert.equal(isEmptyQuillParagraph({ nodeName: 'P', textContent: 'Hi', innerHTML: 'Hi' }), false);
});
