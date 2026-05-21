const { AsyncLocalStorage } = require('node:async_hooks');

const requestContextStorage = new AsyncLocalStorage();

function normalizeContext(seed = {}) {
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) return {};
  return { ...seed };
}

function runWithRequestContext(seed = {}, callback = () => {}) {
  const context = normalizeContext(seed);
  return requestContextStorage.run(context, callback);
}

function getRequestContext() {
  const store = requestContextStorage.getStore();
  if (!store || typeof store !== 'object') return null;
  return store;
}

function mergeRequestContext(patch = {}) {
  const store = getRequestContext();
  if (!store || !patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
  Object.assign(store, patch);
  return true;
}

function setRequestContextValue(key, value) {
  const store = getRequestContext();
  const token = String(key || '').trim();
  if (!store || !token) return false;
  store[token] = value;
  return true;
}

function getRequestContextValue(key, fallback = null) {
  const store = getRequestContext();
  const token = String(key || '').trim();
  if (!store || !token) return fallback;
  return Object.prototype.hasOwnProperty.call(store, token) ? store[token] : fallback;
}

module.exports = {
  runWithRequestContext,
  getRequestContext,
  mergeRequestContext,
  setRequestContextValue,
  getRequestContextValue
};
