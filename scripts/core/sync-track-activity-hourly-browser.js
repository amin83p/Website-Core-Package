'use strict';

/**
 * Hourly timeline + core event builders for the browser live in
 * public/scripts/trackActivityCore.browser.js (includes buildHourlyTimelineFromLogs).
 *
 * Regenerate after changing trackActivityCore.browserEntry.js or core/hourly modules:
 *   node scripts/core/build-track-activity-browser.js
 */

const { execSync } = require('child_process');
const path = require('path');

execSync('node scripts/core/build-track-activity-browser.js', {
  cwd: path.join(__dirname, '../..'),
  stdio: 'inherit',
  shell: true
});
