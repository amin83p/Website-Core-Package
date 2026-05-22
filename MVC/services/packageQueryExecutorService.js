const path = require('path');

const startupLogger = require('../utils/startupLogger');
const { normalizeBackendMode } = require('../../config/dataBackend');
const { registerEntityQueryExecutor } = require('../models/queryExecutionBridge');
const packageRegistryService = require('./packageRegistryService');
const packageLoaderService = require('./packageLoaderService');
const packageManifestService = require('./packageManifestService');

const BUILTIN_REPOSITORY_MODULES = Object.freeze({
  school: '../repositories/school',
  ielts: '../repositories/ielts',
  benchpath: '../repositories/benchpath'
});

const BUILTIN_QUERY_EXECUTOR_DECLARATIONS = Object.freeze({
  school: Object.freeze([
    { entity: 'school.students', source: 'school', repository: 'students' },
    { entity: 'school.programs', source: 'school', repository: 'programs' },
    { entity: 'school.transactiondefinitions', source: 'school', repository: 'transactionDefinitions' },
    { entity: 'school.schoolaccounts', source: 'school', repository: 'schoolAccounts' },
    { entity: 'school.globaltransactions', source: 'school', repository: 'globalTransactions' },
    { entity: 'school.transactionjournals', source: 'school', repository: 'transactionJournals' },
    { entity: 'school.academicledger', source: 'school', repository: 'academicLedger' },
    { entity: 'school.academicsnapshots', source: 'school', repository: 'academicSnapshots' },
    { entity: 'school.reporttemplates', source: 'school', repository: 'reportTemplates' },
    { entity: 'school.reportassignments', source: 'school', repository: 'reportAssignments' },
    { entity: 'school.reportinstances', source: 'school', repository: 'reportInstances' },
    { entity: 'school.subjects', source: 'school', repository: 'subjects' },
    { entity: 'school.classes', source: 'school', repository: 'classes' },
    { entity: 'school.holidays', source: 'school', repository: 'holidays' },
    { entity: 'school.terms', source: 'school', repository: 'terms' },
    { entity: 'school.departments', source: 'school', repository: 'departments' },
    { entity: 'school.teachers', source: 'school', repository: 'teachers' },
    { entity: 'school.staff', source: 'school', repository: 'staff' },
    { entity: 'school.payrates', source: 'school', repository: 'payRates' },
    { entity: 'school.sessionstatuses', source: 'school', repository: 'sessionStatuses' },
    { entity: 'school.timesheetperiods', source: 'school', repository: 'timesheetPeriods' },
    { entity: 'school.timesheets', source: 'school', repository: 'timesheets' },
    { entity: 'school.studentprogramregistrations', source: 'school', repository: 'studentProgramRegistrations' },
    { entity: 'school.studentprogrampriorsubjects', source: 'school', repository: 'studentProgramPriorSubjects' },
    { entity: 'school.studenttermregistrations', source: 'school', repository: 'studentTermRegistrations' },
    { entity: 'school.classenrollmentperiods', source: 'school', repository: 'classEnrollmentPeriods' }
  ]),
  ielts: Object.freeze([
    { entity: 'ielts.task2samples', source: 'ielts', repository: 'task2Samples' },
    { entity: 'ielts.microassessments', source: 'ielts', repository: 'microAssessments' },
    { entity: 'ielts.prompts', source: 'ielts', repository: 'prompts' },
    { entity: 'ielts.scoringhistory', source: 'ielts', repository: 'scoringHistory' }
  ])
});

function cleanText(value, max = 2000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(value = '') {
  return cleanText(value, 80).toLowerCase();
}

function normalizeEntityName(value = '') {
  return cleanText(value, 240).toLowerCase();
}

function normalizeRepositoryKey(value = '') {
  return cleanText(value, 240);
}

function resolveProjectRoot() {
  return path.resolve(__dirname, '../../');
}

function createRepositoryExecutor(repository) {
  return async (plan = {}) => {
    if (!repository || typeof repository.list !== 'function') return [];
    const rows = await repository.list({
      query: plan.query || {},
      scope: plan.scope || {},
      projection: plan.projection || null,
      pagination: plan.pagination || null,
      sort: plan.sort || null,
      skipExecutor: true
    });
    return Array.isArray(rows) ? rows : [];
  };
}

function resolveManifestQueryExecutors(manifest = {}, packageId = '') {
  const declared = Array.isArray(manifest?.queryExecutors)
    ? manifest.queryExecutors.filter((row) => row && typeof row === 'object')
    : [];
  if (declared.length) return declared;
  const fallback = BUILTIN_QUERY_EXECUTOR_DECLARATIONS[normalizePackageId(packageId)];
  return Array.isArray(fallback) ? fallback : [];
}

function resolveRepositoryModulePath(packageId = '', declaration = {}) {
  const explicitPath = cleanText(declaration?.modulePath || declaration?.repositoryModulePath || '', 1200);
  if (explicitPath) {
    return path.isAbsolute(explicitPath)
      ? explicitPath
      : path.resolve(resolveProjectRoot(), explicitPath);
  }

  const explicitSource = normalizePackageId(declaration?.source || declaration?.repositorySource || '');
  const sourceKey = explicitSource || normalizePackageId(packageId);
  const relative = BUILTIN_REPOSITORY_MODULES[sourceKey];
  if (!relative) return '';
  return path.resolve(__dirname, relative);
}

function normalizeDeclaration(packageId = '', declaration = {}) {
  const entity = normalizeEntityName(declaration?.entity);
  if (!entity) throw new Error('queryExecutors declaration requires entity.');

  const repository = normalizeRepositoryKey(
    declaration?.repository
    || declaration?.repositoryKey
    || declaration?.exportName
  );
  if (!repository) throw new Error(`queryExecutors declaration for "${entity}" requires repository key.`);

  const modulePath = resolveRepositoryModulePath(packageId, declaration);
  if (!modulePath) {
    throw new Error(`queryExecutors declaration for "${entity}" could not resolve repository module path.`);
  }

  return {
    entity,
    repository,
    modulePath
  };
}

function buildResultRow(input = {}) {
  return {
    entity: normalizeEntityName(input.entity),
    repository: cleanText(input.repository, 240),
    modulePath: cleanText(input.modulePath, 1200),
    status: cleanText(input.status, 80).toLowerCase(),
    message: cleanText(input.message, 2000)
  };
}

function createSummary(packageId = '') {
  return {
    packageId: normalizePackageId(packageId),
    requested: 0,
    registered: 0,
    skipped: 0,
    failed: 0,
    results: []
  };
}

async function registerManifestQueryExecutors(context = {}, options = {}) {
  const packageId = normalizePackageId(context?.packageId || context?.manifest?.id || '');
  const summary = createSummary(packageId);
  const logger = options?.logger || startupLogger;
  const backendMode = normalizeBackendMode(context?.backendMode || options?.backendMode || 'json');

  if (!packageId) {
    summary.failed += 1;
    summary.results.push(buildResultRow({
      status: 'failed',
      message: 'Missing packageId for query executor registration.'
    }));
    return summary;
  }

  if (backendMode !== 'json') {
    return summary;
  }

  const manifest = context?.manifest && typeof context.manifest === 'object'
    ? context.manifest
    : {};
  const declarations = resolveManifestQueryExecutors(manifest, packageId);
  if (!declarations.length) return summary;

  for (const declaration of declarations) {
    summary.requested += 1;
    let normalized;
    try {
      normalized = normalizeDeclaration(packageId, declaration);
    } catch (error) {
      summary.failed += 1;
      summary.results.push(buildResultRow({
        entity: declaration?.entity,
        repository: declaration?.repository,
        status: 'failed',
        message: error?.message || String(error)
      }));
      continue;
    }

    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const repositoryModule = require(normalized.modulePath);
      const repository = repositoryModule?.[normalized.repository];
      if (!repository || typeof repository.list !== 'function') {
        throw new Error(`Repository "${normalized.repository}" is missing list().`);
      }

      registerEntityQueryExecutor(normalized.entity, createRepositoryExecutor(repository));
      summary.registered += 1;
      summary.results.push(buildResultRow({
        ...normalized,
        status: 'registered',
        message: 'Registered.'
      }));
    } catch (error) {
      summary.failed += 1;
      summary.results.push(buildResultRow({
        ...normalized,
        status: 'failed',
        message: error?.message || String(error)
      }));
    }
  }

  if (logger && typeof logger.info === 'function' && (summary.registered || summary.failed)) {
    logger.info('PACKAGE_QUERY_EXECUTORS', 'REGISTER', `Registered query executors for ${packageId}.`, {
      packageId,
      requested: summary.requested,
      registered: summary.registered,
      failed: summary.failed
    });
  }

  return summary;
}

function createAggregateSummary(backendMode = 'json') {
  return {
    backendMode: normalizeBackendMode(backendMode || 'json'),
    requested: 0,
    registered: 0,
    skipped: 0,
    failed: 0,
    packages: []
  };
}

function mergeSummaryTotals(target = {}, source = {}) {
  target.requested += Number(source.requested || 0);
  target.registered += Number(source.registered || 0);
  target.skipped += Number(source.skipped || 0);
  target.failed += Number(source.failed || 0);
}

async function refreshEnabledPackageQueryExecutors(options = {}) {
  const logger = options?.logger || startupLogger;
  const backendMode = normalizeBackendMode(options?.backendMode || 'json');
  const packageRootDir = path.resolve(
    String(options?.packageRootDir || path.join(resolveProjectRoot(), 'packages'))
  );
  const summary = createAggregateSummary(backendMode);
  if (backendMode !== 'json') return summary;

  const rows = await packageRegistryService.listPackageRegistry({
    backendMode
  });
  const enabledRows = rows.filter((row) => row && row.enabled === true);

  for (const row of enabledRows) {
    const packageId = normalizePackageId(row?.packageId || row?.id || '');
    if (!packageId) continue;

    try {
      // eslint-disable-next-line no-await-in-loop
      const manifestPath = await packageLoaderService.resolveManifestPath(packageId, row, packageRootDir);
      if (!manifestPath) {
        const result = createSummary(packageId);
        result.failed += 1;
        result.results.push(buildResultRow({
          status: 'failed',
          message: 'No manifest file found for enabled package.'
        }));
        mergeSummaryTotals(summary, result);
        summary.packages.push(result);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const rawManifest = await packageLoaderService.readManifestFile(manifestPath);
      const manifest = packageManifestService.validatePackageManifest(rawManifest, {
        knownIds: []
      });
      if (manifest.id !== packageId) {
        throw new Error(`Manifest id "${manifest.id}" does not match registry packageId "${packageId}".`);
      }

      // eslint-disable-next-line no-await-in-loop
      const result = await registerManifestQueryExecutors({
        packageId,
        manifest,
        manifestPath,
        backendMode
      }, { logger });
      mergeSummaryTotals(summary, result);
      summary.packages.push(result);
    } catch (error) {
      const result = createSummary(packageId);
      result.failed += 1;
      result.results.push(buildResultRow({
        status: 'failed',
        message: error?.message || String(error)
      }));
      mergeSummaryTotals(summary, result);
      summary.packages.push(result);
    }
  }

  return summary;
}

function createLoaderHooks(options = {}) {
  const logger = options?.logger || startupLogger;
  return {
    registerQueryExecutors: async (context = {}) => registerManifestQueryExecutors(context, {
      ...options,
      logger
    })
  };
}

module.exports = {
  BUILTIN_REPOSITORY_MODULES,
  BUILTIN_QUERY_EXECUTOR_DECLARATIONS,
  createRepositoryExecutor,
  resolveManifestQueryExecutors,
  registerManifestQueryExecutors,
  refreshEnabledPackageQueryExecutors,
  createLoaderHooks
};
