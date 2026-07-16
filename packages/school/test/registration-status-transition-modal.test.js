const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

function buildElement(overrides = {}) {
  const listeners = {};
  const listenerCounts = {};
  return {
    dataset: {},
    value: '',
    textContent: '',
    className: '',
    classList: {
      classes: new Set(),
      toggle(name, force) {
        if (force) this.classes.add(name);
        else this.classes.delete(name);
      },
      contains(name) { return this.classes.has(name); }
    },
    disabled: false,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, handler) {
      listeners[type] = handler;
      listenerCounts[type] = Number(listenerCounts[type] || 0) + 1;
    },
    trigger(type) {
      return listeners[type]?.();
    },
    listeners,
    listenerCounts,
    ...overrides
  };
}

test('status modal uses preview before cancellation confirmation', async () => {
  const partial = read('../MVC/views/school/partials/registrationStatusTransitionModal.ejs');
  const sourceMatch = partial.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(sourceMatch, 'status modal client script should be present');
  const clientScript = sourceMatch[1]
    .replace(/<%- JSON\.stringify\(String\(registrationStatusRegistrationId \|\| ''\)\) %>/, "'SPR-1'")
    .replace(/<%- JSON\.stringify\(String\(registrationStatusEndpointBase \|\| ''\)\) %>/, "'/school/programs/registrations/SPR-1/status'");

  const modalElement = buildElement();
  const cancelButton = buildElement({ dataset: { targetStatus: 'cancelled' } });
  const elements = {
    registrationStatusModal: modalElement,
    status_target: buildElement(),
    status_effectiveDate: buildElement(),
    status_reason: buildElement(),
    status_preview: buildElement(),
    status_feedback: buildElement(),
    status_modalTitle: buildElement(),
    status_stepNumber: buildElement(),
    status_stepLabel: buildElement(),
    status_stepDetails: buildElement(),
    status_stepReview: buildElement({ classList: { classes: new Set(['d-none']), toggle(name, force) { if (force) this.classes.add(name); else this.classes.delete(name); }, contains(name) { return this.classes.has(name); } } }),
    status_reviewEffectiveDate: buildElement(),
    status_reviewReason: buildElement(),
    btnPreviewStatus: buildElement(),
    btnBackStatus: buildElement(),
    btnApplyStatus: buildElement({ disabled: true }),
    hid_actionStateId: buildElement({ value: 'ACTION-1' })
  };
  const domReadyHandlers = [];
  let modalShowCount = 0;
  let reloadCount = 0;
  const requests = [];
  const loadingEvents = [];
  let resolvePreviewResponse = null;
  const context = {
    Date,
    Error,
    JSON,
    Promise,
    document: {
      readyState: 'loading',
      getElementById(id) { return elements[id] || null; },
      querySelectorAll(selector) {
        return selector === '.btn-registration-status' ? [cancelButton] : [];
      },
      addEventListener(type, handler) {
        if (type === 'DOMContentLoaded') domReadyHandlers.push(handler);
      }
    },
    window: {
      location: { reload() { reloadCount += 1; } },
      showLoading(options) {
        loadingEvents.push({ type: 'show', options });
        return 'loading-preview';
      },
      hideLoading(token) { loadingEvents.push({ type: 'hide', token }); }
    },
    fetch: async (url) => {
      requests.push(url);
      if (String(url).endsWith('/preview')) {
        return await new Promise((resolve) => {
          resolvePreviewResponse = () => resolve({
            ok: true,
            json: async () => ({ status: 'success', preview: { sourceTransactions: [{ id: 'TX-1' }], adjustmentTotal: 25 } })
          });
        });
      }
      return { ok: true, json: async () => ({ status: 'success' }) };
    }
  };

  vm.runInNewContext(clientScript, context);
  assert.equal(cancelButton.listenerCounts.click || 0, 0, 'button binding waits for Bootstrap');
  assert.equal(domReadyHandlers.length, 1);

  context.window.bootstrap = {
    Modal: {
      getOrCreateInstance(element) {
        assert.equal(element, modalElement);
        return { show() { modalShowCount += 1; } };
      }
    }
  };
  domReadyHandlers[0]();
  domReadyHandlers[0]();
  cancelButton.trigger('click');

  assert.equal(cancelButton.listenerCounts.click, 1, 'button binding is registered once');
  assert.equal(elements.status_target.value, 'cancelled');
  assert.equal(elements.status_reason.value, '');
  assert.equal(elements.btnApplyStatus.disabled, true);
  assert.equal(elements.btnPreviewStatus.textContent, 'Preview Cancellation');
  assert.equal(elements.btnApplyStatus.classList.contains('d-none'), true);
  assert.equal(modalShowCount, 1);

  elements.status_reason.value = 'Student did not start.';
  const previewRequest = elements.btnPreviewStatus.trigger('click');
  const duplicatePreviewRequest = elements.btnPreviewStatus.trigger('click');
  assert.equal(elements.btnPreviewStatus.disabled, true);
  assert.deepEqual(requests, ['/school/programs/registrations/SPR-1/status/preview']);
  assert.deepEqual(JSON.parse(JSON.stringify(loadingEvents)), [{
    type: 'show',
    options: {
      title: 'Previewing Cancellation',
      note: 'Please wait while the registration and financial impacts are checked.',
      operation: 'Registration Status Preview'
    }
  }]);
  resolvePreviewResponse();
  await previewRequest;
  await duplicatePreviewRequest;

  assert.equal(elements.status_stepNumber.textContent, 'Step 2 of 2');
  assert.equal(elements.status_stepReview.classList.contains('d-none'), false);
  assert.equal(elements.status_stepDetails.classList.contains('d-none'), true);
  assert.equal(elements.status_reviewReason.textContent, 'Student did not start.');
  assert.equal(elements.btnApplyStatus.textContent, 'Cancel Registration');
  assert.equal(elements.btnApplyStatus.disabled, false);
  assert.deepEqual(JSON.parse(JSON.stringify(loadingEvents)), [
    {
      type: 'show',
      options: {
        title: 'Previewing Cancellation',
        note: 'Please wait while the registration and financial impacts are checked.',
        operation: 'Registration Status Preview'
      }
    },
    { type: 'hide', token: 'loading-preview' }
  ]);
  assert.deepEqual(requests, ['/school/programs/registrations/SPR-1/status/preview']);

  await elements.btnApplyStatus.trigger('click');
  assert.deepEqual(requests, [
    '/school/programs/registrations/SPR-1/status/preview',
    '/school/programs/registrations/SPR-1/status/apply'
  ]);
  assert.equal(reloadCount, 1);
});

test('program and term detail pages use the shared status modal', () => {
  const programDetails = read('../MVC/views/school/program/programRegistrationDetails.ejs');
  const termDetails = read('../MVC/views/school/program/termRegistrationDetails.ejs');

  assert.match(programDetails, /data-target-status="cancelled"/);
  assert.match(programDetails, /registrationStatusTransitionModal/);
  assert.match(termDetails, /data-target-status="cancelled"/);
  assert.match(termDetails, /registrationStatusTransitionModal/);
});
