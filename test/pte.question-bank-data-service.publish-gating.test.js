const test = require('node:test');
const assert = require('node:assert/strict');

const pteQuestionBankDataService = require('../packages/pte/MVC/services/pte/pteQuestionBankDataService');
const pteQuestionVersionRepository = require('../packages/pte/MVC/repositories/pteQuestionVersionRepository');
const questionTypeRegistry = require('../packages/pte/MVC/services/pte/questionTypeRegistry');

const originalGetQuestionById = pteQuestionBankDataService.getQuestionById;
const originalRepoUpdate = pteQuestionVersionRepository.update;
const originalRepoListByFamily = pteQuestionVersionRepository.listByFamily;
const originalValidateQuestionContracts = questionTypeRegistry.validateQuestionContracts;

function restoreStubs() {
  pteQuestionBankDataService.getQuestionById = originalGetQuestionById;
  pteQuestionVersionRepository.update = originalRepoUpdate;
  pteQuestionVersionRepository.listByFamily = originalRepoListByFamily;
  questionTypeRegistry.validateQuestionContracts = originalValidateQuestionContracts;
}

function buildDraftQuestion() {
  return {
    id: 'Q-1',
    familyId: 'FAM-1',
    orgId: 'ORG-1',
    status: 'draft',
    testType: 'core',
    questionType: 'speaking_respond_to_situation',
    payload: { role: 'friend' },
    scoringConfig: {},
    creator: { userId: 'USR-1', displayName: 'Author' },
    publishingMeta: {},
    audit: {
      createUser: 'USR-1',
      createDateTime: '2026-04-25T00:00:00.000Z',
      lastUpdateUser: 'USR-1',
      lastUpdateDateTime: '2026-04-25T00:00:00.000Z'
    }
  };
}

test.afterEach(() => {
  restoreStubs();
});

test('publishQuestion blocks publish when registry contract validation returns errors', async () => {
  let updateCallCount = 0;
  pteQuestionBankDataService.getQuestionById = async () => buildDraftQuestion();
  questionTypeRegistry.validateQuestionContracts = () => [
    'scoringConfig.traitWeights is missing keys: fluency.'
  ];
  pteQuestionVersionRepository.update = async () => {
    updateCallCount += 1;
    return null;
  };
  pteQuestionVersionRepository.listByFamily = async () => [];

  await assert.rejects(
    () => pteQuestionBankDataService.publishQuestion(
      'Q-1',
      { id: 'USR-1', activeOrgId: 'ORG-1' },
      { scopeId: 'SCOPE-1' }
    ),
    /Publish validation failed/i
  );
  assert.equal(updateCallCount, 0);
});

test('publishQuestion succeeds and updates latest revision markers when registry validation passes', async () => {
  const updateCalls = [];
  pteQuestionBankDataService.getQuestionById = async () => buildDraftQuestion();
  questionTypeRegistry.validateQuestionContracts = () => [];
  pteQuestionVersionRepository.listByFamily = async () => [{ id: 'Q-1' }];
  pteQuestionVersionRepository.update = async (id, patch) => {
    updateCalls.push({ id, patch });
    if (patch && patch.status === 'published') {
      return {
        ...buildDraftQuestion(),
        id,
        status: 'published'
      };
    }
    return {
      ...buildDraftQuestion(),
      id,
      status: 'published',
      isLatestRevision: Boolean(patch?.isLatestRevision)
    };
  };

  const out = await pteQuestionBankDataService.publishQuestion(
    'Q-1',
    { id: 'USR-1', activeOrgId: 'ORG-1' },
    { scopeId: 'SCOPE-1' }
  );

  assert.equal(updateCalls.length >= 2, true);
  assert.equal(updateCalls[0].id, 'Q-1');
  assert.equal(updateCalls[0].patch.status, 'published');
  assert.equal(updateCalls[1].patch.isLatestRevision, true);
  assert.equal(out?.status, 'published');
});
