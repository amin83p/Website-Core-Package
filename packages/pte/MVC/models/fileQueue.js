const { requireCoreModule } = require('../services/pte/pteCoreModuleResolver');

function createLocalQueueWriteFallback() {
  const queue = [];
  let isProcessing = false;

  async function processQueue() {
    if (isProcessing || queue.length === 0) return;
    isProcessing = true;
    const { operation, resolve, reject } = queue.shift();
    try {
      const result = await operation();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      isProcessing = false;
      if (queue.length > 0) processQueue();
    }
  }

  return function queueWrite(operation) {
    return new Promise((resolve, reject) => {
      queue.push({ operation, resolve, reject });
      processQueue();
    });
  };
}

function resolveQueueWrite() {
  try {
    const coreFileQueue = requireCoreModule('MVC/models/fileQueue');
    if (coreFileQueue && typeof coreFileQueue.queueWrite === 'function') {
      return coreFileQueue.queueWrite;
    }
  } catch (_) {
    // Fall through to local fallback.
  }
  return createLocalQueueWriteFallback();
}

module.exports = {
  queueWrite: resolveQueueWrite()
};
