import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '../..');
const entry = path.join(root, 'packages/school/MVC/services/school/sarLocalExportCore.browserEntry.js');
const workerEntry = path.join(root, 'packages/school/MVC/services/school/sarLocalExport.workerEntry.js');
const outCore = path.join(root, 'public/scripts/sarLocalExportCore.browser.js');
const outWorker = path.join(root, 'public/scripts/sarLocalExport.worker.js');
const tmpOut = path.join(root, 'public/scripts/.sarLocalExportCore.browser.tmp.js');

const banner = `(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SarLocalExportCore = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
`;

const footer = `
}));
`;

const sharedBuild = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  define: { global: 'globalThis' }
};

await esbuild.build({
  entryPoints: [entry],
  globalName: 'SarLocalExportCoreRuntime',
  outfile: tmpOut,
  ...sharedBuild
});

const bundled = fs.readFileSync(tmpOut, 'utf8');
let body = bundled.replace(/^[\s\S]*?SarLocalExportCoreRuntime\s*=\s*/, '').replace(/;\s*$/, '');
const trimmedBody = body.trimStart();
if (!trimmedBody.startsWith('return ')) {
  body = `return ${trimmedBody.endsWith(';') ? trimmedBody.slice(0, -1) : trimmedBody};`;
}
fs.writeFileSync(outCore, `${banner}${body}\n${footer}`);
fs.unlinkSync(tmpOut);

await esbuild.build({
  entryPoints: [workerEntry],
  outfile: outWorker,
  ...sharedBuild
});

console.log('Wrote', outCore);
console.log('Wrote', outWorker);
