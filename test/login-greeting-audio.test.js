'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loginGreetingAudioService = require('../MVC/services/loginGreetingAudioService');

test('resolveForClient is inactive when disabled', () => {
  const result = loginGreetingAudioService.resolveForClient({ loginGreetingAudio: { enabled: false } });
  assert.equal(result.active, false);
  assert.equal(result.enabled, false);
});

test('resolveForClient active requires enabled and audio URL', () => {
  const result = loginGreetingAudioService.resolveForClient({
    loginGreetingAudio: {
      enabled: true,
      audioUrl: '/uploads/GLOBAL/audio/greeting.mp3',
      inactivityHours: 3
    }
  });
  assert.equal(result.active, true);
  assert.equal(result.audioUrl, '/uploads/GLOBAL/audio/greeting.mp3');
  assert.equal(result.inactivityHours, 3);
  assert.equal(result.inactivityMs, 3 * 60 * 60 * 1000);
});

test('sanitizeAudioUrl rejects unsafe paths', () => {
  assert.equal(loginGreetingAudioService.sanitizeAudioUrl('javascript:alert(1)'), '');
  assert.equal(loginGreetingAudioService.sanitizeAudioUrl('/uploads/foo.wav'), '');
  assert.equal(loginGreetingAudioService.sanitizeAudioUrl('/uploads/GLOBAL/audio/greeting.mp3'), '/uploads/GLOBAL/audio/greeting.mp3');
});

test('migrates legacy festiveSeason settings', () => {
  const policy = loginGreetingAudioService.normalizeFromStored(
    loginGreetingAudioService.rawLoginGreetingSource({
      festiveSeason: {
        enabled: true,
        audioUrl: '/uploads/GLOBAL/audio/jingle.mp3',
        audioMaxSeconds: 10
      }
    })
  );
  assert.equal(policy.enabled, true);
  assert.equal(policy.audioUrl, '/uploads/GLOBAL/audio/jingle.mp3');
  assert.equal(policy.audioMaxSeconds, 10);
  assert.equal(policy.inactivityHours, 3);
});

test('layout exposes login greeting config and script', () => {
  const layoutPath = path.resolve(__dirname, '../MVC/views/layouts/layout.ejs');
  const loadingPath = path.resolve(__dirname, '../MVC/views/partials/loadingModal.ejs');
  const layout = fs.readFileSync(layoutPath, 'utf8');
  const loading = fs.readFileSync(loadingPath, 'utf8');

  assert.match(layout, /__LOGIN_GREETING_AUDIO__/);
  assert.match(layout, /loginGreetingAudio\.js/);
  assert.doesNotMatch(layout, /festiveSeason/);
  assert.doesNotMatch(loading, /app-loading-festive-lane/);
});