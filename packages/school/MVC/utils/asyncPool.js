'use strict';

/**
 * Run async workers over items with a concurrency limit; results preserve input order.
 */
async function runWithConcurrency(items = [], limit = 3, worker = async () => null) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const concurrency = Math.max(1, Number(limit) || 1);
  const results = new Array(list.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < list.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(list[index], index);
    }
  }

  const workers = [];
  const poolSize = Math.min(concurrency, list.length);
  for (let i = 0; i < poolSize; i += 1) {
    workers.push(runWorker());
  }
  await Promise.all(workers);
  return results;
}

module.exports = {
  runWithConcurrency
};
