const test = require('node:test');
const assert = require('node:assert/strict');

const applicationRestartService = require('../MVC/services/applicationRestartService');

test('evaluateRestartPermission blocks restart when env flag is unset', () => {
  const result = applicationRestartService.evaluateRestartPermission({});
  assert.equal(result.allowed, false);
  assert.match(result.message, /ALLOW_IN_APP_APPLICATION_RESTART/);
});

test('evaluateRestartPermission allows restart when env flag is true', () => {
  const result = applicationRestartService.evaluateRestartPermission({
    ALLOW_IN_APP_APPLICATION_RESTART: 'true'
  });
  assert.equal(result.allowed, true);
});

test('scheduleGracefulRestart closes http server and exits process', async () => {
  const originalExit = process.exit;
  let closed = false;
  let exitCode = null;
  const httpServer = {
    close(callback) {
      closed = true;
      if (typeof callback === 'function') callback();
    }
  };

  process.exit = (code) => {
    exitCode = code;
  };

  try {
    applicationRestartService.scheduleGracefulRestart({
      httpServer,
      restartDelayMs: 10,
      shutdownTimeoutMs: 20
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(closed, true);
    assert.equal(exitCode, 0);
  } finally {
    process.exit = originalExit;
  }
});
