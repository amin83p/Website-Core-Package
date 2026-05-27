const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const test = require('node:test');
const assert = require('node:assert/strict');

const systemSettingsController = require('../MVC/controllers/systemSettingsController');
const systemSettingsRepository = require('../MVC/repositories/systemSettingsRepository');
const dataBackendRuntimeService = require('../MVC/services/dataBackendRuntimeService');
const coreResetRebootstrapService = require('../MVC/services/coreResetRebootstrapService');

function makeResponse() {
  return {
    rendered: null,
    jsonPayload: null,
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, payload) {
      this.rendered = { view, payload };
      return this;
    },
    json(payload) {
      this.jsonPayload = payload;
      return this;
    }
  };
}

test('core reset page controller renders preflight and action state', async () => {
  const originalGetSettings = systemSettingsRepository.getSettings;
  const originalRuntime = dataBackendRuntimeService.getPublicBackendStatus;
  const originalPreflight = coreResetRebootstrapService.preflightReset;

  systemSettingsRepository.getSettings = async () => ({ app: {} });
  dataBackendRuntimeService.getPublicBackendStatus = () => ({ mode: 'json', mongo: { ready: false } });
  coreResetRebootstrapService.preflightReset = async () => ({
    action: 'reset-preflight',
    baseline: { id: 'core-bootstrap-security-baseline', version: '1.0.0' },
    entities: [{ entityType: 'sections', rowCount: 4 }],
    summary: { entityCount: 1, totalRows: 4 }
  });

  const res = makeResponse();
  try {
    await systemSettingsController.showCoreResetPage({ user: { id: 'USER_1' }, actionStateId: 'STATE_RESET_1' }, res);
    assert.equal(res.rendered?.view, 'systemSettings/coreResetSettings');
    assert.equal(res.rendered?.payload?.actionStateId, 'STATE_RESET_1');
    assert.equal(res.rendered?.payload?.confirmTokenHint, 'RESET CORE');
  } finally {
    systemSettingsRepository.getSettings = originalGetSettings;
    dataBackendRuntimeService.getPublicBackendStatus = originalRuntime;
    coreResetRebootstrapService.preflightReset = originalPreflight;
  }
});

test('core reset preflight/apply controllers return structured payloads', async () => {
  const originalRuntime = dataBackendRuntimeService.getPublicBackendStatus;
  const originalPreflight = coreResetRebootstrapService.preflightReset;
  const originalApply = coreResetRebootstrapService.applyCoreReset;

  dataBackendRuntimeService.getPublicBackendStatus = () => ({ mode: 'json', mongo: { ready: false } });
  coreResetRebootstrapService.preflightReset = async () => ({
    action: 'reset-preflight',
    summary: { totalRows: 7 },
    run: { id: 'RUN_RESET_PRE_1' }
  });
  coreResetRebootstrapService.applyCoreReset = async () => ({
    action: 'reset-apply',
    overallStatus: 'success',
    runIds: { resetApplyRunId: 'RUN_RESET_APPLY_1' }
  });

  try {
    const preRes = makeResponse();
    await systemSettingsController.preflightCoreReset({ user: { id: 'USER_2' } }, preRes);
    assert.equal(preRes.statusCode, 200);
    assert.equal(preRes.jsonPayload?.status, 'success');
    assert.equal(preRes.jsonPayload?.report?.run?.id, 'RUN_RESET_PRE_1');

    const applyRes = makeResponse();
    await systemSettingsController.applyCoreReset({ user: { id: 'USER_2' }, body: { confirmToken: 'RESET CORE' } }, applyRes);
    assert.equal(applyRes.statusCode, 200);
    assert.equal(applyRes.jsonPayload?.status, 'success');
    assert.equal(applyRes.jsonPayload?.report?.runIds?.resetApplyRunId, 'RUN_RESET_APPLY_1');
  } finally {
    dataBackendRuntimeService.getPublicBackendStatus = originalRuntime;
    coreResetRebootstrapService.preflightReset = originalPreflight;
    coreResetRebootstrapService.applyCoreReset = originalApply;
  }
});

test('core reset apply controller rejects invalid token', async () => {
  const originalRuntime = dataBackendRuntimeService.getPublicBackendStatus;
  const originalApply = coreResetRebootstrapService.applyCoreReset;

  dataBackendRuntimeService.getPublicBackendStatus = () => ({ mode: 'json' });
  coreResetRebootstrapService.applyCoreReset = async () => {
    const error = new Error('Confirmation token mismatch.');
    error.code = 'confirm_token_invalid';
    throw error;
  };

  try {
    const res = makeResponse();
    await systemSettingsController.applyCoreReset({ user: { id: 'USER_4' }, body: { confirmToken: 'BAD' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonPayload?.status, 'error');
    assert.match(String(res.jsonPayload?.message || ''), /confirmation token/i);
  } finally {
    dataBackendRuntimeService.getPublicBackendStatus = originalRuntime;
    coreResetRebootstrapService.applyCoreReset = originalApply;
  }
});

test('core reset EJS compiles and includes expected actions', () => {
  const viewPath = path.join(process.cwd(), 'MVC', 'views', 'systemSettings', 'coreResetSettings.ejs');
  const template = fs.readFileSync(viewPath, 'utf8');
  const render = ejs.compile(template, { filename: viewPath });

  const html = render({
    title: 'Core Reset',
    runtimeBackend: { mode: 'json', mongo: { ready: false } },
    preflight: {
      baseline: { id: 'core-bootstrap-security-baseline', version: '1.0.0' },
      entities: [{ entityType: 'sections', rowCount: 2 }],
      summary: { entityCount: 1, totalRows: 2 }
    },
    confirmTokenHint: 'RESET CORE',
    actionStateId: 'STATE_VIEW_RESET',
    user: { id: 'USER_3' }
  });

  assert.match(html, /Core Reset/);
  assert.match(html, /Refresh Preflight/);
  assert.match(html, /Apply Core Reset/);
  assert.match(html, /RESET CORE/);
  assert.match(html, /\/systemSettings\/core-reset\/preflight/);
  assert.match(html, /\/systemSettings\/core-reset\/apply/);
});
