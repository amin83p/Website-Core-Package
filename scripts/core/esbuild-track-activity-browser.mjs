import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '../..');
const entry = path.join(root, 'MVC/services/security/trackActivityCore.browserEntry.js');
const outCore = path.join(root, 'public/scripts/trackActivityCore.browser.js');
const stubDir = path.join(root, 'scripts/core/browser-stubs');
const dataServiceStub = path.join(stubDir, 'dataService.js');
const settingServiceStub = path.join(stubDir, 'settingService.js');
const tmpOut = path.join(root, 'public/scripts/.trackActivityCore.browser.tmp.js');

if (!fs.existsSync(stubDir)) fs.mkdirSync(stubDir, { recursive: true });

fs.writeFileSync(dataServiceStub, `'use strict';
module.exports = {
  fetchData: async () => [],
  getDataById: async () => null
};
`);

fs.writeFileSync(settingServiceStub, `'use strict';
module.exports = {
  get: () => ({ app: { defaultTimezone: 'UTC', timezone: 'UTC' } })
};
`);

const banner = `(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TrackActivityCoreBrowser = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
`;

const footer = `
}));
`;

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'TrackActivityCoreRuntime',
  outfile: tmpOut,
  plugins: [{
    name: 'service-stubs',
    setup(build) {
      build.onResolve({ filter: /[/\\]dataService$/ }, () => ({ path: dataServiceStub }));
      build.onResolve({ filter: /[/\\]settingService$/ }, () => ({ path: settingServiceStub }));
    }
  }]
});

const bundled = fs.readFileSync(tmpOut, 'utf8');
let body = bundled.replace(/^[\s\S]*?TrackActivityCoreRuntime\s*=\s*/, '').replace(/;\s*$/, '');
const trimmedBody = body.trimStart();
if (!trimmedBody.startsWith('return ')) {
  body = `return ${trimmedBody.endsWith(';') ? trimmedBody.slice(0, -1) : trimmedBody};`;
}
fs.writeFileSync(outCore, `${banner}${body}\n${footer}`);
fs.unlinkSync(tmpOut);
console.log('Wrote', outCore);
