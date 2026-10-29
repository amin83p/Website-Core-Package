(function initNewsArticleImageViewer(global) {
  'use strict';

  function normalizeArticleImageSrc(rawSrc) {
    const src = String(rawSrc || '').trim();
    if (!src) return src;
    if (/^https?:\/\//i.test(src)) {
      try {
        const parsed = new URL(src);
        const host = parsed.hostname.toLowerCase();
        const isPrivate = host === 'localhost'
          || host.endsWith('.localhost')
          || host.endsWith('.local')
          || host.endsWith('.internal')
          || /^127\./.test(host)
          || /^10\./.test(host)
          || /^192\.168\./.test(host)
          || /^169\.254\./.test(host);
        if (isPrivate) {
          const uploadsMatch = parsed.pathname.match(/\/uploads\/(.+)$/i);
          if (uploadsMatch && uploadsMatch[1]) {
            return `/uploads/${uploadsMatch[1]}`;
          }
        }
      } catch (_) {
        return src;
      }
      return src;
    }
    if (!src.startsWith('/')) return `/${src.replace(/^\/+/, '')}`;
    return src;
  }

  function imageNameFromAlt(altText, fallback) {
    const alt = String(altText || '').trim();
    return alt || fallback || 'Image';
  }

  function collectArticleImageGallery({ heroImg, bodyRoot, defaultName = 'Image' } = {}) {
    const gallery = [];
    const urlToIndex = new Map();

    function pushItem(url, name) {
      const token = String(url || '').trim();
      if (!token || urlToIndex.has(token)) return;
      urlToIndex.set(token, gallery.length);
      gallery.push({
        url: token,
        name: String(name || 'Image').trim() || 'Image',
        mimeType: 'image/*'
      });
    }

    if (heroImg && heroImg.getAttribute) {
      const heroUrl = normalizeArticleImageSrc(heroImg.getAttribute('src'));
      if (heroUrl) {
        pushItem(heroUrl, imageNameFromAlt(heroImg.getAttribute('alt'), defaultName));
      }
    }

    if (bodyRoot && bodyRoot.querySelectorAll) {
      const bodyImages = bodyRoot.querySelectorAll('img[src]');
      let bodyIndex = 0;
      bodyImages.forEach((img) => {
        const url = normalizeArticleImageSrc(img.getAttribute('src'));
        if (!url) return;
        bodyIndex += 1;
        pushItem(url, imageNameFromAlt(img.getAttribute('alt'), `Image ${bodyIndex}`));
      });
    }

    return { gallery, urlToIndex };
  }

  function rewriteImageSources({ heroImg, bodyRoot } = {}) {
    if (heroImg && heroImg.getAttribute) {
      const nextHero = normalizeArticleImageSrc(heroImg.getAttribute('src'));
      if (nextHero && nextHero !== heroImg.getAttribute('src')) {
        heroImg.setAttribute('src', nextHero);
      }
    }
    if (!bodyRoot || !bodyRoot.querySelectorAll) return;
    bodyRoot.querySelectorAll('img[src]').forEach((img) => {
      const nextSrc = normalizeArticleImageSrc(img.getAttribute('src'));
      if (nextSrc && nextSrc !== img.getAttribute('src')) {
        img.setAttribute('src', nextSrc);
      }
    });
  }

  function openViewerForImage(url, name, gallery, index) {
    const fileUrl = String(url || '').trim();
    if (!fileUrl) return;
    if (global.ImageViewer && typeof global.ImageViewer.open === 'function') {
      global.ImageViewer.open(fileUrl, name, 'image/*', {
        gallery: Array.isArray(gallery) ? gallery : [],
        index: Number.isFinite(index) ? index : 0
      });
      return;
    }
    global.open(fileUrl, '_blank', 'noopener');
  }

  function bindNewsArticleImageViewer(options = {}) {
    const heroImg = options.heroImg || null;
    const bodyRoot = options.bodyRoot || null;
    const defaultName = String(options.defaultName || 'Image').trim() || 'Image';

    rewriteImageSources({ heroImg, bodyRoot });
    const { gallery, urlToIndex } = collectArticleImageGallery({ heroImg, bodyRoot, defaultName });
    if (!gallery.length) return { gallery, urlToIndex };

    function onImageActivate(event) {
      const img = event.currentTarget;
      if (!img) return;
      event.preventDefault();
      event.stopPropagation();
      const url = normalizeArticleImageSrc(img.getAttribute('src'));
      if (!url) return;
      const index = urlToIndex.has(url) ? urlToIndex.get(url) : 0;
      const item = gallery[index] || gallery[0];
      openViewerForImage(item.url, item.name, gallery, index);
    }

    function onImageKeydown(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onImageActivate(event);
    }

    function wireImage(img) {
      if (!img || img.dataset.newsImageViewerBound === '1') return;
      img.dataset.newsImageViewerBound = '1';
      img.classList.add('news-article-preview-image');
      img.setAttribute('tabindex', '0');
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', imageNameFromAlt(img.getAttribute('alt'), 'View image'));
      img.addEventListener('click', onImageActivate);
      img.addEventListener('keydown', onImageKeydown);
    }

    if (heroImg) wireImage(heroImg);
    if (bodyRoot) {
      bodyRoot.querySelectorAll('img[src]').forEach(wireImage);
    }

    return { gallery, urlToIndex };
  }

  global.NewsArticleImageViewer = {
    normalizeArticleImageSrc,
    collectArticleImageGallery,
    rewriteImageSources,
    bind: bindNewsArticleImageViewer
  };
})(typeof window !== 'undefined' ? window : globalThis);
