const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const test = require('node:test');
const assert = require('node:assert/strict');

const systemSettingsController = require('../MVC/controllers/systemSettingsController');
const systemSettingsRepository = require('../MVC/repositories/systemSettingsRepository');
const dataBackendRuntimeService = require('../MVC/services/dataBackendRuntimeService');
const coreBootstrapBaselineService = require('../MVC/services/coreBootstrapBaselineService');

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

test('core bootstrap page controller renders preflight and action state', async () => {
  const originalGetSettings = systemSettingsRepository.getSettings;
  const originalRuntime = dataBackendRuntimeService.getPublicBackendStatus;
  const originalPreflight = coreBootstrapBaselineService.preflight;

  systemSettingsRepository.getSettings = async () => ({ app: {} });
  dataBackendRuntimeService.getPublicBackendStatus = () => ({ mode: 'json', mongo: { ready: false } });
  coreBootstrapBaselineService.preflight = async () => ({
    action: 'preflight',
    baseline: { id: 'core-bootstrap-security-baseline', version: '1.0.0', sourceRoot: 'data/bootstrap/core' },
    summary: { baselineRows: 10, plannedCreates: 10, existingSame: 0, conflicts: 0 },
    entities: []
  });

  const res = makeResponse();
  try {
    await systemSettingsController.showCoreBootstrapPage({ user: { id: 'USER_1' }, actionStateId: 'STATE_BOOT_1' }, res);
    assert.equal(res.rendered?.view, 'systemSettings/coreBootstrapSettings');
    assert.equal(res.rendered?.payload?.actionStateId, 'STATE_BOOT_1');
    assert.equal(res.rendered?.payload?.preflight?.action, 'preflight');
  } finally {
    systemSettingsRepository.getSettings = originalGetSettings;
    dataBackendRuntimeService.getPublicBackendStatus = originalRuntime;
    coreBootstrapBaselineService.preflight = originalPreflight;
  }
});

test('core bootstrap preflight/apply controllers return structured payloads', async () => {
  const originalRuntime = dataBackendRuntimeService.getPublicBackendStatus;
  const originalPreflight = coreBootstrapBaselineService.preflight;
  const originalApply = coreBootstrapBaselineService.apply;

  dataBackendRuntimeService.getPublicBackendStatus = () => ({ mode: 'json', mongo: { ready: false } });
  coreBootstrapBaselineService.preflight = async () => ({ action: 'preflight', summary: { plannedCreates: 5 }, run: { id: 'RUN_PRE_1' } });
  coreBootstrapBaselineService.apply = async () => ({ action: 'apply', summary: { created: 5 }, run: { id: 'RUN_APPLY_1' } });

  try {
    const preRes = makeResponse();
    await systemSettingsController.preflightCoreBootstrapBaseline({ user: { id: 'USER_2' } }, preRes);
    assert.equal(preRes.statusCode, 200);
    assert.equal(preRes.jsonPayload?.status, 'success');
    assert.equal(preRes.jsonPayload?.report?.run?.id, 'RUN_PRE_1');

    const applyRes = makeResponse();
    await systemSettingsController.applyCoreBootstrapBaseline({ user: { id: 'USER_2' }, body: {} }, applyRes);
    assert.equal(applyRes.statusCode, 200);
    assert.equal(applyRes.jsonPayload?.status, 'success');
    assert.equal(applyRes.jsonPayload?.report?.run?.id, 'RUN_APPLY_1');
  } finally {
    dataBackendRuntimeService.getPublicBackendStatus = originalRuntime;
    coreBootstrapBaselineService.preflight = originalPreflight;
    coreBootstrapBaselineService.apply = originalApply;
  }
});

test('core bootstrap EJS compiles and includes expected actions', () => {
  const viewPath = path.join(process.cwd(), 'MVC', 'views', 'systemSettings', 'coreBootstrapSettings.ejs');
  const template = fs.readFileSync(viewPath, 'utf8');
  const render = ejs.compile(template, { filename: viewPath });

  const html = render({
    title: 'Core Bootstrap Baseline',
    runtimeBackend: { mode: 'json', mongo: { ready: false } },
    preflight: {
      baseline: { id: 'core-bootstrap-security-baseline', version: '1.0.0', sourceRoot: 'data/bootstrap/core' },
      summary: { baselineRows: 10, plannedCreates: 8, existingSame: 2, conflicts: 0 },
      entities: []
    },
    actionStateId: 'STATE_VIEW_BOOT',
    user: { id: 'USER_3' }
  });

  assert.match(html, /Core Bootstrap Baseline/);
  assert.match(html, /Refresh Preflight/);
  assert.match(html, /Apply Baseline/);
  assert.match(html, /\/systemSettings\/bootstrap\/core\/preflight/);
  assert.match(html, /\/systemSettings\/bootstrap\/core\/apply/);
});
