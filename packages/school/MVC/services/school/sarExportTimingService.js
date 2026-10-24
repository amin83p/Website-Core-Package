'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const startupLogger = requireCoreModule('MVC/utils/startupLogger');
const sarExportConfigService = require('./sarExportConfigService');

function timingEnabled() {
  return sarExportConfigService.isExportTimingEnabled();
}

function createTimer(label = 'sar.export') {
  const startedAt = Date.now();
  const spans = [];

  return {
    mark(phase, extra = {}) {
      spans.push({
        phase: String(phase || '').trim(),
        ms: Date.now() - startedAt,
        ...extra
      });
    },
    log(meta = {}) {
      if (!timingEnabled()) return;
      const totalMs = Date.now() - startedAt;
      startupLogger.info('SAR_EXPORT', 'TIMING', String(label), {
        totalMs,
        spans,
        ...meta
      });
    }
  };
}

module.exports = {
  timingEnabled,
  createTimer
};
