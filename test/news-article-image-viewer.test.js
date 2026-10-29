const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const articleSource = fs.readFileSync(
  path.join(process.cwd(), 'MVC/views/news/article.ejs'),
  'utf8'
);
const scriptSource = fs.readFileSync(
  path.join(process.cwd(), 'public/scripts/news/newsArticleImageViewer.js'),
  'utf8'
);

test('news article page includes ImageViewer modal and bind script', () => {
  assert.match(articleSource, /modal_ImageViewer/);
  assert.match(articleSource, /newsArticleImageViewer\.js/);
  assert.match(articleSource, /NewsArticleImageViewer\.bind/);
});

test('newsArticleImageViewer exposes gallery helpers', () => {
  assert.match(scriptSource, /collectArticleImageGallery/);
  assert.match(scriptSource, /normalizeArticleImageSrc/);
  assert.match(scriptSource, /ImageViewer\.open/);
});
