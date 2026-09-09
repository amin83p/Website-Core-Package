const test = require('node:test');
const assert = require('node:assert/strict');

require('../packages/school/public/scripts/sessionCalendarCore');

const { resolveResizeHandleEdge } = global.SessionCalendarCore;

function mockHandle({ edge = '', topClass = false } = {}) {
  return {
    getAttribute(name) {
      if (name === 'data-resize-edge') return edge;
      return '';
    },
    classList: {
      contains(className) {
        return topClass && className === 'session-cal-draft-resize-handle-top';
      }
    }
  };
}

test('resolveResizeHandleEdge honors explicit bottom handle attribute', () => {
  const edge = resolveResizeHandleEdge(mockHandle({ edge: 'bottom' }));
  assert.equal(edge, 'bottom');
});

test('resolveResizeHandleEdge honors explicit top handle attribute', () => {
  const edge = resolveResizeHandleEdge(mockHandle({ edge: 'top' }));
  assert.equal(edge, 'top');
});

test('resolveResizeHandleEdge falls back to top class when attribute missing', () => {
  assert.equal(resolveResizeHandleEdge(mockHandle({ topClass: true })), 'top');
  assert.equal(resolveResizeHandleEdge(mockHandle({ topClass: false })), 'bottom');
});
