/* global Quill */
(function attachNewsFigureFloatLayout(root) {
  const globalRoot = root || (typeof globalThis !== 'undefined' ? globalThis : {});

  function isEmptyQuillParagraph(el) {
    if (!el || String(el.nodeName || '').toUpperCase() !== 'P') return false;
    const text = String(el.textContent || '').replace(/\u200B/g, '').trim();
    if (text) return false;
    const html = String(el.innerHTML || '').trim().toLowerCase();
    return html === '' || html === '<br>' || html === '<br/>' || html === '<br />';
  }

  function getFigureFloatLayout(fig) {
    if (!fig || !fig.classList) return null;
    if (fig.classList.contains('news-figure--layout-float-left')) return 'float-left';
    if (fig.classList.contains('news-figure--layout-float-right')) return 'float-right';
    return null;
  }

  function isFloatedFigure(el) {
    return el && el.matches && el.matches('figure.news-figure') && !!getFigureFloatLayout(el);
  }

  /**
   * Pure planner for tests: blocks are { kind: 'figure'|'p', floatLayout?, isEmpty? }.
   * Returns parallel array of flags for each p: { clear, floatGap, postFloat }.
   */
  function planFloatParagraphClasses(blocks) {
    const plans = [];
    let activeFloat = false;
    let floatEnded = false;
    let sawWrapText = false;
    let emptyAfterWrapStreak = 0;

    blocks.forEach((block) => {
      if (block.kind === 'figure') {
        if (block.floatLayout) {
          activeFloat = true;
          floatEnded = false;
          sawWrapText = false;
          emptyAfterWrapStreak = 0;
        } else {
          activeFloat = false;
          floatEnded = false;
          sawWrapText = false;
          emptyAfterWrapStreak = 0;
        }
        return;
      }
      if (block.kind !== 'p') return;

      const isEmpty = !!block.isEmpty;
      let clear = false;
      let floatGap = false;
      let postFloat = false;

      if (floatEnded) {
        postFloat = true;
      } else if (activeFloat) {
        if (isEmpty) {
          if (sawWrapText) {
            emptyAfterWrapStreak += 1;
            if (emptyAfterWrapStreak >= 2) {
              clear = true;
              floatEnded = true;
              activeFloat = false;
            } else {
              floatGap = true;
            }
          } else {
            floatGap = true;
          }
        } else {
          emptyAfterWrapStreak = 0;
          sawWrapText = true;
        }
      }

      plans.push({ clear, floatGap, postFloat });
    });

    return plans;
  }

  function buildBlockDescriptors(children) {
    const blocks = [];
    children.forEach((el) => {
      if (isFloatedFigure(el)) {
        blocks.push({ kind: 'figure', floatLayout: getFigureFloatLayout(el), el });
        return;
      }
      if (el.matches && el.matches('figure.news-figure')) {
        blocks.push({ kind: 'figure', floatLayout: null, el });
        return;
      }
      if (String(el.nodeName || '').toUpperCase() === 'P') {
        blocks.push({ kind: 'p', isEmpty: isEmptyQuillParagraph(el), el });
      }
    });
    return blocks;
  }

  function syncNewsFigureFloatLayout(editorRoot) {
    const root = editorRoot && editorRoot.querySelector
      ? editorRoot
      : (typeof document !== 'undefined' ? document.querySelector(editorRoot) : null);
    if (!root) return;

    const children = Array.from(root.children);
    const blocks = buildBlockDescriptors(children);
    const descriptorOnly = blocks.map((b) => ({
      kind: b.kind,
      floatLayout: b.floatLayout,
      isEmpty: b.isEmpty
    }));
    const plans = planFloatParagraphClasses(descriptorOnly);

    let planIndex = 0;
    blocks.forEach((block) => {
      if (block.kind !== 'p' || !block.el) return;
      const plan = plans[planIndex] || { clear: false, floatGap: false, postFloat: false };
      planIndex += 1;
      block.el.classList.toggle('news-figure-clear', !!plan.clear);
      block.el.classList.toggle('news-p-float-gap', !!plan.floatGap);
      block.el.classList.toggle('news-figure-post-float', !!plan.postFloat);
    });
  }

  function debounce(fn, waitMs) {
    let timer = null;
    return function debounced(...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(this, args);
      }, waitMs);
    };
  }

  const api = {
    isEmptyQuillParagraph,
    planFloatParagraphClasses,
    syncNewsFigureFloatLayout,
    debounceSync: debounce(syncNewsFigureFloatLayout, 80)
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  globalRoot.NewsFigureFloatLayout = api;
}(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : {}));
