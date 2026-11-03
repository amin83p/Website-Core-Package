const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cssPath = path.join(__dirname, '..', 'public', 'styles', 'main.css');
const css = fs.readFileSync(cssPath, 'utf8');

test('compact header keeps mobile nav row available for hamburger collapse', () => {
  assert.match(
    css,
    /@media\s*\(\s*max-width:\s*991\.98px\s*\)[\s\S]*#main-header\.header-minimized \.header-nav-row[\s\S]*pointer-events:\s*auto/
  );
  assert.match(
    css,
    /@media\s*\(\s*max-width:\s*991\.98px\s*\)[\s\S]*#main-header #navbarNav\.show/
  );
});
