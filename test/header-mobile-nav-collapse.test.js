const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cssPath = path.join(__dirname, '..', 'public', 'styles', 'main.css');
const headerPath = path.join(__dirname, '..', 'MVC', 'views', 'partials', 'header.ejs');
const css = fs.readFileSync(cssPath, 'utf8');
const header = fs.readFileSync(headerPath, 'utf8');

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

test('mobile hamburger exposes quick actions and unread dot markers', () => {
  assert.match(header, /id="headerHamburgerUnreadDot"/);
  assert.match(header, /class="header-mobile-quick-actions d-lg-none"/);
  assert.match(header, /id="chatGlobalTriggerMobile"/);
  assert.match(header, /id="chatGlobalTriggerMobileUnreadDot"/);
  assert.match(header, /id="headerStartMenuTriggerMobile"/);
  assert.match(css, /\.header-mobile-quick-actions/);
  assert.match(css, /\.header-chat-unread-dot/);
});
