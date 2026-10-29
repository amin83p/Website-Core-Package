/* global Quill */
(function initNewsFigureBlot(global) {
  if (!global || typeof global.Quill !== 'function') return;

  const FIGURE_LAYOUTS = ['center', 'float-left', 'float-right', 'block'];

  function clampWidthPct(value, fallback) {
    const numeric = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(numeric)) return fallback || 72;
    return Math.min(100, Math.max(25, numeric));
  }

  function normalizeLayoutToken(value) {
    const token = String(value || '').trim().toLowerCase();
    return FIGURE_LAYOUTS.includes(token) ? token : 'center';
  }

  function isEmbeddedImageUrl(value) {
    const token = String(value || '').trim().toLowerCase();
    return token.startsWith('data:') || token.startsWith('blob:');
  }

  const NewsFigureDom = {
    applyToNode(node, value) {
      const existingImg = node.querySelector('img');
      const existingSrc = String(
        node.getAttribute('data-src') || existingImg?.getAttribute('src') || ''
      ).trim();
      let src = String(value?.src || '').trim();
      if (!src) src = existingSrc;
      const layout = normalizeLayoutToken(value?.layout);
      const widthPct = clampWidthPct(value?.widthPct, 72);
      const alt = String(value?.alt || '').trim();
      node.setAttribute('data-news-figure', '1');
      node.setAttribute('data-src', src);
      node.setAttribute('data-layout', layout);
      node.setAttribute('data-width-pct', String(widthPct));
      node.className = `news-figure news-figure--layout-${layout}`;
      node.style.maxWidth = `${widthPct}%`;
      let img = node.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        node.appendChild(img);
      }
      if (src) img.src = src;
      img.alt = alt;
      img.loading = 'lazy';
    },
    readFromNode(node) {
      if (!node) return { src: '', layout: 'center', widthPct: 72, alt: '' };
      const img = node.querySelector('img');
      return {
        src: String(node.getAttribute('data-src') || img?.getAttribute('src') || '').trim(),
        layout: normalizeLayoutToken(node.getAttribute('data-layout')),
        widthPct: clampWidthPct(node.getAttribute('data-width-pct'), 72),
        alt: String(img?.getAttribute('alt') || '').trim()
      };
    }
  };

  const BlockEmbed = Quill.import('blots/block/embed');

  class NewsFigureBlot extends BlockEmbed {
    static create(value) {
      const node = super.create();
      const payload = value && typeof value === 'object' ? value : { src: String(value || '') };
      NewsFigureDom.applyToNode(node, payload);
      return node;
    }

    static value(node) {
      return NewsFigureDom.readFromNode(node);
    }
  }

  NewsFigureBlot.blotName = 'newsFigure';
  NewsFigureBlot.tagName = 'FIGURE';
  NewsFigureBlot.className = 'news-figure';

  Quill.register(NewsFigureBlot);

  function insertNewsFigure(quill, payload, index) {
    if (!quill || !payload?.src || isEmbeddedImageUrl(payload.src)) return null;
    const at = Number.isFinite(index) ? index : (quill.getSelection(true)?.index ?? quill.getLength());
    quill.insertEmbed(at, 'newsFigure', {
      src: payload.src,
      layout: normalizeLayoutToken(payload.layout),
      widthPct: clampWidthPct(payload.widthPct, 72),
      alt: String(payload.alt || '').trim()
    }, 'user');
    quill.setSelection(at + 1, 0, 'silent');
    return at;
  }

  function updateNewsFigureAt(quill, index, payload) {
    if (!quill || !Number.isFinite(index)) return;
    quill.deleteText(index, 1, 'user');
    insertNewsFigure(quill, payload, index);
  }

  function stripEmbeddedImagesFromHtml(html) {
    let out = String(html || '');
    if (!out) return out;
    if (/src\s*=\s*["'](?:data:|blob:)/i.test(out)) {
      out = out.replace(/<figure\b[^>]*data-news-figure[^>]*>[\s\S]*?<\/figure>/gi, (chunk) => (
        /src\s*=\s*["'](?:data:|blob:)/i.test(chunk) ? '' : chunk
      ));
      out = out.replace(/<img\b[^>]*\ssrc\s*=\s*["'](?:data:|blob:)[^"']*["'][^>]*>/gi, '');
    }
    return out;
  }

  function clipboardHasEmbeddedImage(html, plain) {
    const blob = `${String(html || '')}\n${String(plain || '')}`;
    return /src\s*=\s*["'](?:data:|blob:)/i.test(blob);
  }

  global.NewsFigureEditor = {
    FIGURE_LAYOUTS,
    clampWidthPct,
    normalizeLayoutToken,
    NewsFigureDom,
    insertNewsFigure,
    updateNewsFigureAt,
    stripEmbeddedImagesFromHtml,
    clipboardHasEmbeddedImage,
    isEmbeddedImageUrl
  };
}(typeof window !== 'undefined' ? window : null));
