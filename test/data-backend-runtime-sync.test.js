'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MONGO_ENV = {
  DATA_BACKEND: 'mongo',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/test-runtime-sync',
  DATA_BACKEND_SYNC_INTERVAL_MS: '60000'
};

const RUNTIME_SERVICE_PATH = require.resolve('../MVC/services/dataBackendRuntimeService');
const SELECTOR_PATH = require.resolve('../MVC/repositories/backend/repositoryBackendSelector');
const MONGO_CONNECTION_PATH = require.resolve('../MVC/infrastructure/mongo/mongoConnection');
const RUNTIME_PATH = require.resolve('../MVC/infrastructure/runtime/dataBackendRuntime');

function createCacheEntry(filename, exportsValue) {
  return {
    id: filename,
    filename,
    loaded: true,
    exports: exportsValue
  };
}

function saveModuleCache(paths = []) {
  const saved = new Map();
  paths.forEach((modulePath) => {
    if (require.cache[modulePath]) saved.set(modulePath, require.cache[modulePath]);
  });
  return saved;
}

function restoreModuleCache(saved) {
  saved.forEach((entry, modulePath) => {
    require.cache[modulePath] = entry;
  });
  Object.keys(require.cache).forEach((modulePath) => {
    if (!saved.has(modulePath) && [
      RUNTIME_SERVICE_PATH,
      SELECTOR_PATH,
      MONGO_CONNECTION_PATH
    ].includes(modulePath)) {
      delete require.cache[modulePath];
    }
  });
}

function loadRuntimeModules({ connectMongoImpl }) {
  const saved = saveModuleCache([RUNTIME_PATH, MONGO_CONNECTION_PATH, RUNTIME_SERVICE_PATH, SELECTOR_PATH]);
  const mongoExports = { ...require(MONGO_CONNECTION_PATH), connectMongo: connectMongoImpl };
  delete require.cache[RUNTIME_SERVICE_PATH];
  delete require.cache[SELECTOR_PATH];
  require.cache[MONGO_CONNECTION_PATH] = createCacheEntry(MONGO_CONNECTION_PATH, mongoExports);

  const { setActiveDataBackendConfig } = require(RUNTIME_PATH);
  const dataBackendRuntimeService = require(RUNTIME_SERVICE_PATH);
  const { runByRepositoryBackend } = require(SELECTOR_PATH);
  const { registerCoreEntityQueryExecutors } = require('../MVC/models/queryExecutorBootstrap');

  return {
    setActiveDataBackendConfig,
    dataBackendRuntimeService,
    runByRepositoryBackend,
    registerCoreEntityQueryExecutors,
    restore: () => restoreModuleCache(saved)
  };
}

function activateJsonRecovery(setActiveDataBackendConfig, env = MONGO_ENV) {
  setActiveDataBackendConfig({
    mode: 'json',
    requested: 'mongo',
    mongo: { ready: true, uri: env.MONGODB_URI },
    fallback: {
      active: true,
      reason: 'mongo_connection_failed',
      message: 'Test recovery mode'
    },
    runtime: {
      requestedMode: 'mongo',
      activeMode: 'json',
      lastSyncAttemptAt: 0
    }
  });
}

test('syncActiveDataBackendForRepositoryAccess restores mongo after recovery', async () => {
  let connectCalls = 0;
  const modules = loadRuntimeModules({
    connectMongoImpl: async () => {
      connectCalls += 1;
    }
  });

  try {
    activateJsonRecovery(modules.setActiveDataBackendConfig);
    modules.dataBackendRuntimeService.resetSyncStateForTests();

    const outcome = await modules.dataBackendRuntimeService.syncActiveDataBackendForRepositoryAccess({
      force: true,
      env: MONGO_ENV
    });
    assert.equal(outcome.mode, 'mongo');
    assert.equal(outcome.changed, true);
    assert.equal(connectCalls, 1);
    assert.equal(modules.dataBackendRuntimeService.getPublicBackendStatus().mode, 'mongo');
    assert.equal(modules.dataBackendRuntimeService.isRecoveryModeActive(), false);
  } finally {
    modules.restore();
  }
});

test('syncActiveDataBackendForRepositoryAccess throttles mongo retry attempts', async () => {
  let connectCalls = 0;
  const modules = loadRuntimeModules({
    connectMongoImpl: async () => {
      connectCalls += 1;
      throw new Error('mongo unavailable');
    }
  });

  try {
    activateJsonRecovery(modules.setActiveDataBackendConfig);
    modules.dataBackendRuntimeService.resetSyncStateForTests();

    const first = await modules.dataBackendRuntimeService.syncActiveDataBackendForRepositoryAccess({
      force: true,
      env: MONGO_ENV
    });
    assert.equal(first.recoveryActive, true);
    assert.equal(connectCalls, 1);

    const second = await modules.dataBackendRuntimeService.syncActiveDataBackendForRepositoryAccess({
      force: false,
      env: MONGO_ENV
    });
    assert.equal(second.throttled, true);
    assert.equal(connectCalls, 1);
  } finally {
    modules.restore();
  }
});

test('runByRepositoryBackend uses mongo handler after successful sync', async () => {
  const previousEnv = {
    DATA_BACKEND: process.env.DATA_BACKEND,
    MONGODB_URI: process.env.MONGODB_URI,
    DATA_BACKEND_SYNC_INTERVAL_MS: process.env.DATA_BACKEND_SYNC_INTERVAL_MS
  };
  Object.assign(process.env, MONGO_ENV);

  const modules = loadRuntimeModules({
    connectMongoImpl: async () => {}
  });

  try {
    activateJsonRecovery(modules.setActiveDataBackendConfig);
    modules.dataBackendRuntimeService.resetSyncStateForTests();

    const outcome = await modules.runByRepositoryBackend({}, {
      json: async () => 'json-path',
      mongo: async () => 'mongo-path'
    }, 'test.repository');

    assert.equal(outcome, 'mongo-path');
  } finally {
    if (previousEnv.DATA_BACKEND === undefined) delete process.env.DATA_BACKEND;
    else process.env.DATA_BACKEND = previousEnv.DATA_BACKEND;
    if (previousEnv.MONGODB_URI === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = previousEnv.MONGODB_URI;
    if (previousEnv.DATA_BACKEND_SYNC_INTERVAL_MS === undefined) delete process.env.DATA_BACKEND_SYNC_INTERVAL_MS;
    else process.env.DATA_BACKEND_SYNC_INTERVAL_MS = previousEnv.DATA_BACKEND_SYNC_INTERVAL_MS;
    modules.restore();
  }
});

test('backend change listener is invoked when sync restores mongo', async () => {
  const modules = loadRuntimeModules({
    connectMongoImpl: async () => {}
  });

  try {
    activateJsonRecovery(modules.setActiveDataBackendConfig);
    modules.dataBackendRuntimeService.resetSyncStateForTests();

    const listenerCalls = [];
    modules.dataBackendRuntimeService.setBackendChangeListener((config, previousMode) => {
      listenerCalls.push({ mode: config.mode, previousMode });
      modules.registerCoreEntityQueryExecutors({ backendMode: config.mode });
    });

    await modules.dataBackendRuntimeService.syncActiveDataBackendForRepositoryAccess({
      force: true,
      env: MONGO_ENV
    });
    assert.equal(listenerCalls.length, 1);
    assert.equal(listenerCalls[0].mode, 'mongo');
    assert.equal(listenerCalls[0].previousMode, 'json');
  } finally {
    modules.restore();
  }
});
