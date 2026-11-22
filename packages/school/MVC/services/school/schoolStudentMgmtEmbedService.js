'use strict';

const EMBED_QUERY_KEY = 'smEmbed';
const EMBED_HTML_CLASS = 'school-sm-embed-iframe';
const EMBED_PAGE_WIDTH_CLASS = 'app-page-width-full';
const EMBED_SECTIONS_CLASS = 'school-sm-embed-section';
const EMBED_PAGE_CSS = 'schoolStudentMgmtEmbed.css';
const EMBED_MAIN_CLASS = 'container my-0';

function isEmbedRequest(req) {
  const q = req && req.query && typeof req.query === 'object' ? req.query : {};
  return String(q[EMBED_QUERY_KEY] || '').trim() === '1';
}

function mergeClassNames(existing, added) {
  const base = String(existing || '').trim().split(/\s+/).filter(Boolean);
  const extra = String(added || '').trim().split(/\s+/).filter(Boolean);
  const set = new Set([...base, ...extra]);
  return Array.from(set).join(' ');
}

function embedRenderLocals(req, existing = {}) {
  if (!isEmbedRequest(req)) {
    return {};
  }
  const base = existing && typeof existing === 'object' ? existing : {};
  const pageCss = String(base.pageCss || '').trim();
  return {
    schoolSmEmbed: true,
    pageCss: pageCss || EMBED_PAGE_CSS,
    htmlClass: mergeClassNames(mergeClassNames(base.htmlClass, EMBED_HTML_CLASS), EMBED_PAGE_WIDTH_CLASS),
    mainClass: EMBED_MAIN_CLASS,
    sectionsPageClass: EMBED_SECTIONS_CLASS
  };
}

module.exports = {
  EMBED_QUERY_KEY,
  isEmbedRequest,
  embedRenderLocals
};