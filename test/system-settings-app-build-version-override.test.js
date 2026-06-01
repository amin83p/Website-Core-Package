const test = require('node:test');
const assert = require('node:assert/strict');

const systemSettingsController = require('../MVC/controllers/systemSettingsController');
const systemSettingsRepository = require('../MVC/repositories/systemSettingsRepository');
const settingService = require('../MVC/services/settingService');

function makeJsonResponse() {
  return {
    statusCode: 200,
    jsonPayload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonPayload = payload;
      return this;
    },
    redirect() {
      throw new Error('redirect should not be used in AJAX flow');
    },
    render() {
      throw new Error('render should not be used in AJAX flow');
    }
  };
}

test('updateAppSettings persists buildVersionOverride and refreshes runtime build locals', async () => {
  const originalGetSettings = systemSettingsRepository.getSettings;
  const originalUpdateSettings = systemSettingsRepository.updateSettings;
  const originalRefresh = settingService.refresh;
  const res = makeJsonResponse();
  let capturedUpdate = null;
  let refreshCalled = 0;
  let buildRefreshCalled = 0;

  systemSettingsRepository.getSettings = async () => ({
    app: {
      publicMenu: {
        defaultHomePath: '/',
        items: []
      },
      brand: {},
      contactPage: {}
    }
  });
  systemSettingsRepository.updateSettings = async (payload) => {
    capturedUpdate = payload;
  };
  settingService.refresh = async () => {
    refreshCalled += 1;
  };

  try {
    await systemSettingsController.updateAppSettings({
      body: {
        defaultPageSize: '30',
        searchDefaultKeyword: 'aaa',
        buildVersionOverride: '  RELEASE-abc123def456  ',
        uploadsPath: 'uploads'
      },
      headers: {
        'x-ajax-request': 'true'
      },
      user: { id: 'USER_APP_SETTINGS_1' },
      app: {
        locals: {
          refreshBuildVersion() {
            buildRefreshCalled += 1;
          }
        }
      }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonPayload?.status, 'success');
    assert.equal(refreshCalled, 1);
    assert.equal(buildRefreshCalled, 1);
    assert.equal(capturedUpdate?.app?.buildVersionOverride, 'RELEASE-abc123def456');
  } finally {
    systemSettingsRepository.getSettings = originalGetSettings;
    systemSettingsRepository.updateSettings = originalUpdateSettings;
    settingService.refresh = originalRefresh;
  }
});
