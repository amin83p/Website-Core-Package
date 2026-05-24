const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CURRENT_MIDDLEWARE_ROOT = path.join(ROOT_DIR, 'MVC/middleware');
const PACKAGE_MIDDLEWARE_ROOT = path.join(ROOT_DIR, 'packages/pte/MVC/middleware');
const CURRENT_UTIL_ROOT = path.join(ROOT_DIR, 'MVC/utils');
const PACKAGE_UTIL_ROOT = path.join(ROOT_DIR, 'packages/pte/MVC/utils');

const PTE_MIDDLEWARE_FILES = Object.freeze([
  'pteUploadContextMiddleware.js'
]);

const PTE_UTILITY_FILES = Object.freeze([
  'pteUploadPathUtils.js'
]);

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function expectedShimRequirePath({ packageRoot, currentRoot, relativeFile }) {
  const packageShimPath = path.join(packageRoot, relativeFile);
  const currentPath = path.join(currentRoot, relativeFile).replace(/\.js$/, '');
  let relativeRequirePath = path.relative(path.dirname(packageShimPath), currentPath).replace(/\\/g, '/');
  if (!relativeRequirePath.startsWith('.')) {
    relativeRequirePath = `./${relativeRequirePath}`;
  }
  return relativeRequirePath;
}

function assertFilePresence({ files, packageRoot, currentRoot }) {
  files.forEach((relativeFile) => {
    assert.equal(fs.existsSync(path.join(currentRoot, relativeFile)), true, `${relativeFile} should exist in current MVC`);
    assert.equal(fs.existsSync(path.join(packageRoot, relativeFile)), true, `${relativeFile} should exist in the package`);
  });
}

function readSourceRelativePackage({ packageRoot, currentRoot, relativeFile }) {
  const packagePath = path.join(packageRoot, relativeFile);
  const source = readText(packagePath);
  const expectedRequire = expectedShimRequirePath({
    packageRoot,
    currentRoot,
    relativeFile
  });
  return { source, expectedRequire };
}

test('PTE package middleware and utility files exist for upload boundaries', () => {
  assertFilePresence({
    files: PTE_MIDDLEWARE_FILES,
    packageRoot: PACKAGE_MIDDLEWARE_ROOT,
    currentRoot: CURRENT_MIDDLEWARE_ROOT
  });
  assertFilePresence({
    files: PTE_UTILITY_FILES,
    packageRoot: PACKAGE_UTIL_ROOT,
    currentRoot: CURRENT_UTIL_ROOT
  });
});

test('PTE package middleware and utility files delegate to core implementations', () => {
  [
    {
      packageRoot: PACKAGE_MIDDLEWARE_ROOT,
      currentRoot: CURRENT_MIDDLEWARE_ROOT,
      relativeFile: 'pteUploadContextMiddleware.js'
    },
    {
      packageRoot: PACKAGE_UTIL_ROOT,
      currentRoot: CURRENT_UTIL_ROOT,
      relativeFile: 'pteUploadPathUtils.js'
    }
  ].forEach(({ packageRoot, currentRoot, relativeFile }) => {
    const { source, expectedRequire } = readSourceRelativePackage({
      packageRoot,
      currentRoot,
      relativeFile
    });

    assert.equal(
      source.includes(`require('${expectedRequire}')`),
      true,
      `${relativeFile} should delegate via ${expectedRequire}`
    );
  });
});

test('PTE package upload utility behavior matches current utility behavior', () => {
  const rootUtility = require(path.join(CURRENT_UTIL_ROOT, 'pteUploadPathUtils'));
  const packageUtility = require(path.join(PACKAGE_UTIL_ROOT, 'pteUploadPathUtils'));

  const bucketSamples = Object.freeze([
    'practice_by_skills',
    'smart_practice',
    'mock_exams',
    'question_bank',
    'students',
    'public_applicants',
    'unknown'
  ]);
  bucketSamples.forEach((bucket) => {
    assert.equal(
      rootUtility.normalizeBucketToken(bucket),
      packageUtility.normalizeBucketToken(bucket),
      `normalizeBucketToken(${bucket}) should match`
    );
  });

  const sampleContext = {
    bucket: rootUtility.PTE_BUCKETS.STUDENTS,
    itemId: ' Item 01 '
  };
  assert.equal(
    rootUtility.getQuestionBankRoot(),
    packageUtility.getQuestionBankRoot(),
    'getQuestionBankRoot should match'
  );
  assert.equal(
    rootUtility.buildStudentCategory(sampleContext),
    packageUtility.buildStudentCategory(sampleContext),
    'buildStudentCategory should match'
  );
});

test('PTE package upload middleware applies the same context shape as current middleware', async () => {
  const rootMiddleware = require(path.join(CURRENT_MIDDLEWARE_ROOT, 'pteUploadContextMiddleware'));
  const packageMiddleware = require(path.join(PACKAGE_MIDDLEWARE_ROOT, 'pteUploadContextMiddleware'));

  function createBaseReq() {
    return {
      user: { id: 'USR001' },
      body: {
        practiceName: 'Sample Practice',
        testName: 'Sample Test'
      },
      params: {
        sessionId: '',
        itemId: 'ItemOne'
      },
      accessScope: 'org-1'
    };
  }

  function runWithNext(middleware, req) {
    return new Promise((resolve, reject) => {
      const res = {
        status: (code) => ({
          json: (payload) => {
            reject(new Error(`unexpected status ${code}: ${JSON.stringify(payload)}`));
          }
        })
      };
      const next = () => resolve(req);
      const result = middleware(req, res, next);
      if (result && typeof result.then === 'function') {
        result.then(() => {
          resolve(req);
        }).catch(reject);
      }
    });
  }

  const rootQuestionBankReq = await runWithNext(
    rootMiddleware.setQuestionBankContext,
    createBaseReq()
  );
  const packageQuestionBankReq = await runWithNext(
    packageMiddleware.setQuestionBankContext,
    createBaseReq()
  );
  assert.equal(
    rootQuestionBankReq.pteStorageContext.bucket,
    packageQuestionBankReq.pteStorageContext.bucket,
    'question bank bucket should match'
  );

  const rootStudentReq = await runWithNext(
    rootMiddleware.setStudentContext({ publicApplicant: true }),
    createBaseReq()
  );
  const packageStudentReq = await runWithNext(
    packageMiddleware.setStudentContext({ publicApplicant: true }),
    createBaseReq()
  );
  assert.equal(
    rootStudentReq.pteStorageContext.bucket,
    packageStudentReq.pteStorageContext.bucket,
    'student public bucket should match'
  );

  const rootRuntimeReq = await runWithNext(
    rootMiddleware.setRuntimeAttemptContext('mock'),
    createBaseReq()
  );
  const packageRuntimeReq = await runWithNext(
    packageMiddleware.setRuntimeAttemptContext('mock'),
    createBaseReq()
  );
  assert.equal(
    rootRuntimeReq.pteStorageContext.bucket,
    packageRuntimeReq.pteStorageContext.bucket,
    'runtime bucket should match'
  );
});
