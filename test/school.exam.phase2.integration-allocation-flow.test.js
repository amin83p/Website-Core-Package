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
      return next;
    },
    async getById(id) {
      return rows.find((row) => String(row?.id || '') === String(id || '')) || null;
    },
    async create(payload) {
      const id = String(payload?.id || `${Date.now()}_${Math.floor(Math.random() * 1000)}`);
      const row = { ...payload, id };
      rows.push(row);
      return row;
    },
    async update(id, patch) {
      const idx = rows.findIndex((row) => String(row?.id || '') === String(id || ''));
      if (idx < 0) throw new Error('Record not found.');
      rows[idx] = { ...rows[idx], ...(patch || {}) };
      return rows[idx];
    },
    async remove(id) {
      const idx = rows.findIndex((row) => String(row?.id || '') === String(id || ''));
      if (idx < 0) return false;
      rows.splice(idx, 1);
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
  const classes = createInMemoryCrudStore([
    { id: 'CLS-1', orgId: 'ORG-1', title: 'Class 1' },
    { id: 'CLS-2', orgId: 'ORG-2', title: 'Class 2' }
  ]);
  const students = createInMemoryCrudStore([
    { id: 'STU-1', orgId: 'ORG-1', personId: 'PER-1' },
    { id: 'STU-2', orgId: 'ORG-1', personId: 'PER-2' },
    { id: 'STU-X', orgId: 'ORG-2', personId: 'PER-X' }
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

test('integration: active-org class -> allocation -> assignment generation flow', async () => {
  const deps = buildDependencies();
  examBuilderService.__setDependencies(deps);

  try {
    const actor = { id: 'teacher-1', activeOrgId: 'ORG-1' };
    const setup = await examBuilderService.createTemplate(
      { orgId: 'ORG-1', title: 'Reading Quiz' },
      actor
    );
    await examBuilderService.saveDraftQuestion(
      setup.revision.id,
      {
        questionType: 'objective',
        promptText: 'Pick correct answer',
        objectiveMode: 'single_choice',
        objectiveOptions: [
          { id: 'A', text: 'Wrong', isCorrect: false },
          { id: 'B', text: 'Right', isCorrect: true }
        ],
        scoring: { maxScore: 1 }
      },
      actor
    );
    const published = await examBuilderService.publishRevision(setup.revision.id, {}, actor);
    const allocation = await examBuilderService.createAllocationForPublishedRevision(
      {
        orgId: 'ORG-1',
        classId: 'CLS-1',
        revisionId: published.id,
        timezone: 'UTC',
        windowStartUtc: '2026-05-01T13:00:00.000Z',
        windowEndUtc: '2026-05-01T15:00:00.000Z',
        durationMinutes: 60
      },
      actor
    );

    const generated = await examBuilderService.createAssignmentsForAllocation(
      {
        orgId: 'ORG-1',
        allocationId: allocation.id,
        studentIds: ['STU-1', 'STU-2', 'STU-X']
      },
      actor
    );

    assert.equal(generated.created.length, 2);
    assert.equal(generated.skippedStudentIds.length, 1);
    assert.ok(generated.skippedStudentIds.includes('STU-X'));

    const duplicateRun = await examBuilderService.createAssignmentsForAllocation(
      {
        orgId: 'ORG-1',
        allocationId: allocation.id,
        studentIds: ['STU-1', 'STU-2']
      },
      actor
    );
    assert.equal(duplicateRun.created.length, 0);
    assert.equal(duplicateRun.skippedStudentIds.length, 2);
  } finally {
    examBuilderService.__resetDependencies();
  }
});
