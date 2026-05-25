const test = require('node:test');
const assert = require('node:assert/strict');

const questionBankController = require('../MVC/controllers/pte/questionBankController');
const pteQuestionBankDataService = require('../MVC/services/pte/pteQuestionBankDataService');
const questionBankAiAutofillService = require('../MVC/services/pte/questionBankAiAutofillService');

const originalPublishQuestion = pteQuestionBankDataService.publishQuestion;
const originalSuggestTypeFields = questionBankAiAutofillService.suggestTypeFields;

function restoreStubs() {
  pteQuestionBankDataService.publishQuestion = originalPublishQuestion;
  questionBankAiAutofillService.suggestTypeFields = originalSuggestTypeFields;
}

function createReq(overrides = {}) {
  return {
    params: {},
    body: {},
    user: {
      id: 'USR-1',
      activeOrgId: 'ORG-1'
    },
    accessScope: 'SCOPE-1',
    ...overrides
  };
}

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test.afterEach(() => {
  restoreStubs();
});

test('aiAssistTypeFields returns supported success message and result payload', async () => {
  let capturedPlan = null;
  let capturedScopeId = null;
  questionBankAiAutofillService.suggestTypeFields = async (plan, user, options = {}) => {
    capturedPlan = plan;
    capturedScopeId = options?.accessContext?.scopeId || '';
    return {
      supported: true,
      suggestions: [
        {
          scope: 'payload',
          fieldKey: 'role',
          suggestedValue: 'friend'
        }
      ],
      warnings: []
    };
  };

  const req = createReq({
    body: {
      questionPlan: JSON.stringify({
        questionType: 'speaking_respond_to_situation',
        payload: { role: '' },
        scoringConfig: {}
      })
    }
  });
  const res = createRes();

  await questionBankController.aiAssistTypeFields(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.equal(res.payload?.message, 'AI suggestions generated successfully.');
  assert.equal(res.payload?.results?.supported, true);
  assert.equal(capturedScopeId, 'SCOPE-1');
  assert.equal(capturedPlan?.questionType, 'speaking_respond_to_situation');
});

test('aiAssistTypeFields returns phased rollout message when type is unsupported', async () => {
  questionBankAiAutofillService.suggestTypeFields = async () => ({
    supported: false,
    suggestions: [],
    warnings: ['unsupported-type']
  });

  const req = createReq({
    body: {
      questionPlan: JSON.stringify({
        questionType: 'reading_fill_in_the_blanks'
      })
    }
  });
  const res = createRes();

  await questionBankController.aiAssistTypeFields(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.match(
    String(res.payload?.message || ''),
    /available for Read Aloud, Repeat Sentence, Answer Short Question, Writing Summarize Written Text, Write Email, Reading MCQ Single, Reading MCQ Multiple, Reading Fill in the Blanks, Reading Reorder Paragraphs, Listening MCQ Single/i
  );
  assert.equal(res.payload?.results?.supported, false);
});

test('publishQuestion returns 400 when publish validation fails in service layer', async () => {
  pteQuestionBankDataService.publishQuestion = async () => {
    throw new Error('Publish validation failed: scoringConfig.traitWeights is missing keys: fluency.');
  };

  const req = createReq({
    params: { id: 'Q-1' }
  });
  const res = createRes();

  await questionBankController.publishQuestion(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload?.status, 'error');
  assert.match(String(res.payload?.message || ''), /Publish validation failed/i);
  assert.match(String(res.payload?.message || ''), /traitWeights/i);
});
