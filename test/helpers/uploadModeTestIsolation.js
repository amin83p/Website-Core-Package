'use strict';

const settingService = require('../../MVC/services/settingService');

const ORIGINAL_GET_VALUE = settingService.getValue;

const UPLOAD_APP_KEYS = new Set([
  'uploadStorageBackend',
  'azureBlobContainer',
  'azureBlobPrefix',
  'uploadRemoteReadMode'
]);

const DEFAULT_APP_UPLOAD_STUBS = {
  uploadStorageBackend: 'local',
  azureBlobContainer: 'uploads',
  azureBlobPrefix: '',
  uploadRemoteReadMode: 'redirect'
};

let backendOverride = null;
let extraAppStubs = {};
let savedUploadMode;

function stubUploadStorageBackend(mode) {
  backendOverride = mode == null ? null : String(mode).trim().toLowerCase();
}

function setAppUploadStubs(stubs = {}) {
  extraAppStubs = { ...stubs };
}

function restoreUploadModeTestState() {
  backendOverride = null;
  extraAppStubs = {};
  settingService.getValue = ORIGINAL_GET_VALUE;
}

function wrapGetValueForUploadTests(originalGetValue = ORIGINAL_GET_VALUE) {
  settingService.getValue = (section, key) => {
    if (section === 'app' && UPLOAD_APP_KEYS.has(key)) {
      if (Object.prototype.hasOwnProperty.call(extraAppStubs, key)) {
        return extraAppStubs[key];
      }
      if (key === 'uploadStorageBackend' && backendOverride != null) {
        return backendOverride;
      }
      if (Object.prototype.hasOwnProperty.call(DEFAULT_APP_UPLOAD_STUBS, key)) {
        return DEFAULT_APP_UPLOAD_STUBS[key];
      }
    }
    return originalGetValue.call(settingService, section, key);
  };
}

/**
 * Stub app.uploadStorageBackend (and related upload app keys) to stable local defaults
 * so tests are not affected by data/systemSettings.json or CI UPLOAD_MODE env values.
 */
function installUploadModeTestIsolation(test, options = {}) {
  const originalGetValue = options.originalGetValue || ORIGINAL_GET_VALUE;

  test.beforeEach(() => {
    savedUploadMode = process.env.UPLOAD_MODE;
    delete process.env.UPLOAD_MODE;
    backendOverride = null;
    extraAppStubs = {};
    wrapGetValueForUploadTests(originalGetValue);
  });

  test.afterEach(() => {
    restoreUploadModeTestState();
    if (options.originalGetValue) {
      settingService.getValue = options.originalGetValue;
    }
    if (savedUploadMode === undefined) delete process.env.UPLOAD_MODE;
    else process.env.UPLOAD_MODE = savedUploadMode;
  });
}

module.exports = {
  installUploadModeTestIsolation,
  stubUploadStorageBackend,
  setAppUploadStubs,
  restoreUploadModeTestState,
  wrapGetValueForUploadTests,
  DEFAULT_APP_UPLOAD_STUBS
};