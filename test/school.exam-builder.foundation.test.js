const test = require('node:test');
const assert = require('node:assert/strict');

const examBuilderService = require('../MVC/services/school/examBuilderService');

function createInMemoryCrudStore(seed = []) {
  const rows = Array.isArray(seed) ? [...seed] : [];
  return {
    rows,
    async list(input = {}) {
      const query = input?.query || {};
      let next = [...rows];
      for (const [key, value] of Object.entries(query)) {
        if (!key.endsWith('__eq')) continue;
        const field = key.replace(/__eq$/, '');
        next = next.filter((row) => String(row?.[field] || '') === String(value || ''));
      }
      if (Number(query.limit) > 0) return next.slice(0, Number(query.limit));
      return next;
    },
    async getById(id) {
      return rows.find((row) => String(row?.id || '') === String(id || '')) || null;
    },
    async create(payload) {
      const id = String(payload?.id || `${Date.now()}_${Math.floor(Math.random() * 10000)}`);
      const row = { ...payload, id };
      rows.push(row);
      return row;
    },
    async update(id, patch) {
      const index = rows.findIndex((row) => String(row?.id || '') === String(id || ''));
      if (index === -1) throw new Error('Record not found.');
      rows[index] = { ...rows[index], ...(patch || {}) };
      return rows[index];
    },
    async remove(id) {
      const index = rows.findIndex((row) => String(row?.id || '') === String(id || ''));
      if (index === -1) return false;
      rows.splice(index, 1);
      return true;
    }
  };
}

function buildDependencies() {
  const examTemplates = createInMemoryCrudStore();
  const examRevisions = createInMemoryCrudStore();
  const examQuestions = createInMemoryCrudStore();
  const examAllocations = createInMemoryCrudStore();
  const examAssignments = createInMemoryCrudStore();
  const examAttempts = createInMemoryCrudStore();
  const examAnswers = createInMemoryCrudStore();
  const classes = createInMemoryCrudStore([{ id: 'CLS-1', orgId: 'ORG-1', title: 'Class 1' }]);
  const students = createInMemoryCrudStore([
    { id: 'STU-1', orgId: 'ORG-1', personId: 'PER-1' },
    { id: 'STU-2', orgId: 'ORG-1', personId: 'PER-2' }
  ]);

  return {
    repositories: {
      examTemplates,
      examRevisions: {
        ...examRevisions,
        async findByTemplateId(templateId) {
          return examRevisions.rows.filter((row) => String(row.templateId) === String(templateId));
        }
      },
      examQuestions: {
        ...examQuestions,
        async findByRevisionId(revisionId) {
          return examQuestions.rows.filter((row) => String(row.revisionId) === String(revisionId));
        }
      },
      examAllocations,
      examAssignments: {
        ...examAssignments,
        async findByAllocationId(allocationId) {
          return examAssignments.rows.filter((row) => String(row.allocationId) === String(allocationId));
        },
        async findByStudentId(studentId) {
          return examAssignments.rows.filter((row) => String(row.studentId) === String(studentId));
        }
      },
      examAttempts: {
        ...examAttempts,
        async findByAssignmentId(assignmentId) {
          return examAttempts.rows.filter((row) => String(row.assignmentId) === String(assignmentId));
        }
      },
      examAnswers: {
        ...examAnswers,
        async findByAttemptId(attemptId) {
          return examAnswers.rows.filter((row) => String(row.attemptId) === String(attemptId));
        }
      },
      classes,
      students
    }
  };
}

test('examBuilderService creates template with initial draft revision', async () => {
  const deps = buildDependencies();
  examBuilderService.__setDependencies(deps);

  try {
    const result = await examBuilderService.createTemplate(
      { orgId: 'ORG-1', title: 'Midterm A', code: 'MID-A' },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );
    assert.equal(result.template.title, 'Midterm A');
    assert.equal(result.template.latestRevisionNo, 1);
    assert.ok(result.revision?.id);
    assert.equal(result.revision?.status, 'draft');
  } finally {
    examBuilderService.__resetDependencies();
  }
});

test('examBuilderService publish requires at least one question and locks revision', async () => {
  const deps = buildDependencies();
  examBuilderService.__setDependencies(deps);

  try {
    const setup = await examBuilderService.createTemplate(
      { orgId: 'ORG-1', title: 'Quiz B' },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );

    await assert.rejects(
      async () => examBuilderService.publishRevision(setup.revision.id, {}, { id: 'teacher-1', activeOrgId: 'ORG-1' }),
      /without questions/i
    );

    await examBuilderService.saveDraftQuestion(
      setup.revision.id,
      {
        questionType: 'objective',
        promptText: '2 + 2 = ?',
        objectiveMode: 'single_choice',
        objectiveOptions: [
          { id: 'A', text: '3', isCorrect: false },
          { id: 'B', text: '4', isCorrect: true }
        ],
        scoring: { maxScore: 2 }
      },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );

    const published = await examBuilderService.publishRevision(
      setup.revision.id,
      {},
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );
    assert.equal(published.status, 'published');
    assert.equal(published.isImmutable, true);
    assert.equal(published.totalQuestions, 1);
    assert.equal(published.totalScore, 2);

    await assert.rejects(
      async () => examBuilderService.updateDraftRevision(
        setup.revision.id,
        { instructions: 'changed after publish' },
        { id: 'teacher-1', activeOrgId: 'ORG-1' }
      ),
      /only draft revisions can be edited/i
    );
  } finally {
    examBuilderService.__resetDependencies();
  }
});

test('examBuilderService allocation and assignment enforce published revision and skip duplicates', async () => {
  const deps = buildDependencies();
  examBuilderService.__setDependencies(deps);

  try {
    const setup = await examBuilderService.createTemplate(
      { orgId: 'ORG-1', title: 'Final C' },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );

    await examBuilderService.saveDraftQuestion(
      setup.revision.id,
      {
        questionType: 'objective',
        promptText: 'Sun rises from?',
        objectiveMode: 'single_choice',
        objectiveOptions: [
          { id: 'A', text: 'West', isCorrect: false },
          { id: 'B', text: 'East', isCorrect: true }
        ],
        scoring: { maxScore: 1 }
      },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );

    const published = await examBuilderService.publishRevision(setup.revision.id, {}, { id: 'teacher-1', activeOrgId: 'ORG-1' });

    const allocation = await examBuilderService.createAllocationForPublishedRevision(
      {
        orgId: 'ORG-1',
        classId: 'CLS-1',
        revisionId: published.id,
        windowStartUtc: '2026-04-01T14:00:00.000Z',
        windowEndUtc: '2026-04-01T16:00:00.000Z',
        durationMinutes: 45,
        timezone: 'America/Edmonton'
      },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );
    assert.equal(allocation.classId, 'CLS-1');

    const first = await examBuilderService.createAssignmentsForAllocation(
      { orgId: 'ORG-1', allocationId: allocation.id, studentIds: ['STU-1', 'STU-2'] },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );
    assert.equal(first.created.length, 2);
    assert.equal(first.skippedStudentIds.length, 0);

    const second = await examBuilderService.createAssignmentsForAllocation(
      { orgId: 'ORG-1', allocationId: allocation.id, studentIds: ['STU-1'] },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );
    assert.equal(second.created.length, 0);
    assert.equal(second.skippedStudentIds.length, 1);
  } finally {
    examBuilderService.__resetDependencies();
  }
});

test('examBuilderService rejects allocation for non-published revision', async () => {
  const deps = buildDependencies();
  examBuilderService.__setDependencies(deps);

  try {
    const setup = await examBuilderService.createTemplate(
      { orgId: 'ORG-1', title: 'Draft-only Exam' },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );

    await assert.rejects(
      async () => examBuilderService.createAllocationForPublishedRevision(
        {
          orgId: 'ORG-1',
          classId: 'CLS-1',
          revisionId: setup.revision.id,
          windowStartUtc: '2026-04-01T14:00:00.000Z',
          windowEndUtc: '2026-04-01T16:00:00.000Z',
          durationMinutes: 45,
          timezone: 'UTC'
        },
        { id: 'teacher-1', activeOrgId: 'ORG-1' }
      ),
      /only published revisions can be allocated/i
    );
  } finally {
    examBuilderService.__resetDependencies();
  }
});

test('examBuilderService allocation uses template defaults for delivery policies', async () => {
  const deps = buildDependencies();
  examBuilderService.__setDependencies(deps);

  try {
    const setup = await examBuilderService.createTemplate(
      {
        orgId: 'ORG-1',
        title: 'Policy Defaults Exam',
        settings: {
          defaultWindowPolicy: 'suggested_window',
          defaultQuestionPresentationMode: 'sequential_one_by_one',
          defaultCountsInFinalScore: false
        }
      },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );

    await examBuilderService.saveDraftQuestion(
      setup.revision.id,
      {
        questionType: 'objective',
        promptText: 'Default policy question?',
        objectiveMode: 'single_choice',
        objectiveOptions: [
          { id: 'A', text: 'No', isCorrect: false },
          { id: 'B', text: 'Yes', isCorrect: true }
        ],
        scoring: { maxScore: 1 }
      },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );
    const published = await examBuilderService.publishRevision(setup.revision.id, {}, { id: 'teacher-1', activeOrgId: 'ORG-1' });

    const allocation = await examBuilderService.createAllocationForPublishedRevision(
      {
        orgId: 'ORG-1',
        classId: 'CLS-1',
        revisionId: published.id,
        windowStartUtc: '2026-04-02T14:00:00.000Z',
        windowEndUtc: '2026-04-02T15:00:00.000Z',
        durationMinutes: 30,
        timezone: 'UTC'
      },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );

    assert.equal(allocation.windowPolicy, 'suggested_window');
    assert.equal(allocation.questionPresentationMode, 'sequential_one_by_one');
    assert.equal(allocation.countsInFinalScore, false);
  } finally {
    examBuilderService.__resetDependencies();
  }
});

test('examBuilderService allocation accepts policy overrides', async () => {
  const deps = buildDependencies();
  examBuilderService.__setDependencies(deps);

  try {
    const setup = await examBuilderService.createTemplate(
      {
        orgId: 'ORG-1',
        title: 'Policy Override Exam',
        settings: {
          defaultWindowPolicy: 'suggested_window',
          defaultQuestionPresentationMode: 'all_questions_on_one_page',
          defaultCountsInFinalScore: false
        }
      },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );

    await examBuilderService.saveDraftQuestion(
      setup.revision.id,
      {
        questionType: 'objective',
        promptText: 'Override policy question?',
        objectiveMode: 'single_choice',
        objectiveOptions: [
          { id: 'A', text: '1', isCorrect: true },
          { id: 'B', text: '2', isCorrect: false }
        ],
        scoring: { maxScore: 1 }
      },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );
    const published = await examBuilderService.publishRevision(setup.revision.id, {}, { id: 'teacher-1', activeOrgId: 'ORG-1' });

    const allocation = await examBuilderService.createAllocationForPublishedRevision(
      {
        orgId: 'ORG-1',
        classId: 'CLS-1',
        revisionId: published.id,
        windowStartUtc: '2026-04-03T14:00:00.000Z',
        windowEndUtc: '2026-04-03T15:00:00.000Z',
        durationMinutes: 30,
        timezone: 'UTC',
        windowPolicy: 'strict_fixed_window',
        questionPresentationMode: 'sequential_one_by_one',
        countsInFinalScore: true
      },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );

    assert.equal(allocation.windowPolicy, 'strict_fixed_window');
    assert.equal(allocation.questionPresentationMode, 'sequential_one_by_one');
    assert.equal(allocation.countsInFinalScore, true);
  } finally {
    examBuilderService.__resetDependencies();
  }
});

test('examBuilderService clones template as revision copy with parent lineage and copied questions', async () => {
  const deps = buildDependencies();
  examBuilderService.__setDependencies(deps);

  try {
    const setup = await examBuilderService.createTemplate(
      { orgId: 'ORG-1', title: 'Source Exam' },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );

    await examBuilderService.saveDraftQuestion(
      setup.revision.id,
      {
        questionType: 'objective',
        promptText: 'Capital of Canada?',
        objectiveMode: 'single_choice',
        objectiveOptions: [
          { id: 'A', text: 'Toronto', isCorrect: false },
          { id: 'B', text: 'Ottawa', isCorrect: true }
        ],
        scoring: { maxScore: 1 }
      },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );
    await examBuilderService.publishRevision(setup.revision.id, {}, { id: 'teacher-1', activeOrgId: 'ORG-1' });

    const cloned = await examBuilderService.cloneTemplateAsRevision(
      setup.template.id,
      {},
      { id: 'teacher-2', activeOrgId: 'ORG-1' }
    );

    assert.ok(cloned.template?.id);
    assert.equal(cloned.template.parentTemplateId, setup.template.id);
    assert.equal(cloned.template.revisionDepth, 1);
    assert.ok(cloned.revision?.id);
    assert.equal(cloned.revision.status, 'draft');

    const clonedQuestions = await deps.repositories.examQuestions.findByRevisionId(cloned.revision.id);
    assert.equal(clonedQuestions.length, 1);
    assert.equal(clonedQuestions[0].promptText, 'Capital of Canada?');
  } finally {
    examBuilderService.__resetDependencies();
  }
});

test('examBuilderService blocks new draft revision on published template', async () => {
  const deps = buildDependencies();
  examBuilderService.__setDependencies(deps);

  try {
    const setup = await examBuilderService.createTemplate(
      { orgId: 'ORG-1', title: 'Immutable Source' },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );
    await examBuilderService.saveDraftQuestion(
      setup.revision.id,
      {
        questionType: 'objective',
        promptText: '1+1?',
        objectiveMode: 'single_choice',
        objectiveOptions: [
          { id: 'A', text: '2', isCorrect: true },
          { id: 'B', text: '3', isCorrect: false }
        ],
        scoring: { maxScore: 1 }
      },
      { id: 'teacher-1', activeOrgId: 'ORG-1' }
    );
    await examBuilderService.publishRevision(setup.revision.id, {}, { id: 'teacher-1', activeOrgId: 'ORG-1' });

    await assert.rejects(
      async () => examBuilderService.createDraftRevision(
        setup.template.id,
        {},
        { id: 'teacher-1', activeOrgId: 'ORG-1' }
      ),
      /immutable/i
    );
  } finally {
    examBuilderService.__resetDependencies();
  }
});
