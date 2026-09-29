'use strict';

const fs = require('node:fs');
const path = require('node:path');

const p = path.join(__dirname, '..', 'packages/school/MVC/views/school/schedule/personSchedule.ejs');
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
const head = lines.slice(0, 363).join('\n');
const tail = [
  '',
  '<script type="application/json" id="masterScheduleViewerConfig"><%- JSON.stringify(typeof masterScheduleViewerClientConfig !== \'undefined\' ? masterScheduleViewerClientConfig : {}).replace(/</g, \'\\u003c\') %></script>',
  '<% if (canDragCreateSessions) { %>',
  '<script src="/scripts/masterScheduleViewerStaging.js"></script>',
  '<% } %>',
  '<script src="/scripts/masterScheduleViewer.js"></script>',
  ''
].join('\n');
fs.writeFileSync(p, `${head}${tail}\n`);
console.log('Updated', p);
