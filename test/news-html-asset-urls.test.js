'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ensureRootRelativeWebPath,
  normalizeNewsHtmlAssetUrls,
  extractImgSrcList
} = require('../MVC/utils/newsHtmlAssetUrls');

test('ensureRootRelativeWebPath adds leading slash for site paths', () => {
  assert.equal(ensureRootRelativeWebPath('images/news/a.jpg'), '/images/news/a.jpg');
  assert.equal(ensureRootRelativeWebPath('/uploads/GLOBAL/x.png'), '/uploads/GLOBAL/x.png');
  assert.equal(ensureRootRelativeWebPath('https://cdn.example/x.png'), 'https://cdn.example/x.png');
});

test('normalizeNewsHtmlAssetUrls fixes relative img src in article HTML', () => {
  const input = '<p><img src="images/news/banner.jpg" alt="x"></p>';
  const output = normalizeNewsHtmlAssetUrls(input);
  assert.equal(output, '<p><img src="/images/news/banner.jpg" alt="x"></p>');
  assert.deepEqual(extractImgSrcList(output), ['/images/news/banner.jpg']);
});

test('normalizeNewsHtmlAssetUrls rewrites localhost upload URLs to same-origin /uploads', () => {
  const input = '<p><img src="http://127.0.0.1:8080/uploads/GLOBAL/news/a.jpg" alt="x"></p>';
  const output = normalizeNewsHtmlAssetUrls(input);
  assert.match(output, /src="\/uploads\/GLOBAL\/news\/a\.jpg"/);
});

test('normalizeNewsHtmlAssetUrls strips data:image img tags', () => {
  const input = '<p>Hello</p><img src="data:image/png;base64,abc" alt="x">';
  const output = normalizeNewsHtmlAssetUrls(input);
  assert.equal(output, '<p>Hello</p>');
  assert.deepEqual(extractImgSrcList(output), []);
});

test('normalizeNewsHtmlAssetUrls normalizes figure markup and preserves layout attrs', () => {
  const input =
    '<figure class="news-figure" data-news-figure="1" data-src="images/news/pic.jpg" data-width-pct="50" data-layout="float-right">' +
    '<img src="images/news/pic.jpg" alt=""></figure>';
  const output = normalizeNewsHtmlAssetUrls(input);
  assert.match(output, /data-src="\/images\/news\/pic\.jpg"/);
  assert.match(output, /data-layout="float-right"/);
  assert.match(output, /data-width-pct="50"/);
  assert.match(output, /news-figure--layout-float-right/);
  assert.match(output, /src="\/images\/news\/pic\.jpg"/);
});

test('normalizeNewsHtmlAssetUrls removes figures with embedded data-src', () => {
  const input =
    '<p>x</p><figure data-news-figure="1" data-src="data:image/png;base64,xx">' +
    '<img src="data:image/png;base64,xx"></figure><p>y</p>';
  const output = normalizeNewsHtmlAssetUrls(input);
  assert.equal(output, '<p>x</p><p>y</p>');
});
