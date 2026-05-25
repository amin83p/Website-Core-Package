const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const questionBankRoutesPath = path.join(ROOT_DIR, 'packages/pte/MVC/routes/questionBankRoutes.js');

test('Question bank routes should mount upload storage context middleware correctly', () => {
  const source = fs.readFileSync(questionBankRoutesPath, 'utf8');

  const totalReferences = (source.match(/pteUploadContext\.setQuestionBankContext/g) || []).length;
  const calledAsFunctionCount = (source.match(/pteUploadContext\.setQuestionBankContext\(\)/g) || []).length;
  const bareRefCount = (source.match(/pteUploadContext\.setQuestionBankContext(?!\()/g) || []).length;

  assert.equal(totalReferences, 3, 'questionBankRoutes should reference upload context middleware three times.');
  assert.equal(calledAsFunctionCount, 0, 'questionBank routes should use setQuestionBankContext as middleware function reference.');
  assert.equal(bareRefCount, 3, 'questionBank routes should pass setQuestionBankContext as bare middleware references.');
});
