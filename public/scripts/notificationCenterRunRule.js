(function initNotificationCenterRunRule(global) {
  function resolveCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content || '';
  }

  function resolveCsrfHeaders() {
    const csrfToken = resolveCsrfToken();
    const headers = {
      Accept: 'application/json',
      'X-AJAX-Request': '1'
    };
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
      headers['csrf-token'] = csrfToken;
    }
    return headers;
  }

  function showRunRuleWaitingModal() {
    if (typeof global.showLoading !== 'function') return null;
    return global.showLoading({
      title: 'Running evaluation',
      note: 'Please wait while this rule is evaluated. You will be taken to the results when finished.',
      operation: 'Notification Centre'
    });
  }

  function hideRunRuleWaitingModal(token) {
    if (typeof global.hideLoading !== 'function') return;
    if (token) global.hideLoading(token);
    else global.hideLoading({ force: true });
  }

  /**
   * @param {string} runUrl POST URL for /rules/:id/run
   * @returns {Promise<{ ok: boolean, runId?: string, message?: string }>}
   */
  async function postRunRule(runUrl) {
    const url = String(runUrl || '').trim();
    if (!url) {
      return { ok: false, message: 'Run URL is missing.' };
    }
    const loadingToken = showRunRuleWaitingModal();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: resolveCsrfHeaders(),
        credentials: 'same-origin'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status !== 'ok' || !payload.run?.id) {
        hideRunRuleWaitingModal(loadingToken);
        return {
          ok: false,
          message: payload.message || 'Could not run this rule.'
        };
      }
      hideRunRuleWaitingModal(loadingToken);
      return { ok: true, runId: String(payload.run.id) };
    } catch (error) {
      hideRunRuleWaitingModal(loadingToken);
      return {
        ok: false,
        message: error?.message || 'Could not run this rule.'
      };
    }
  }

  async function runRuleAndRedirect(runUrl) {
    const result = await postRunRule(runUrl);
    if (!result.ok) {
      if (typeof global.showMessageModal === 'function') {
        await global.showMessageModal({
          title: 'Run failed',
          message: result.message || 'Could not run this rule.',
          icon: 'error',
          size: 'md'
        });
      }
      return false;
    }
    global.location.href = '/school/notification-center/runs/' + encodeURIComponent(result.runId);
    return true;
  }

  global.NotificationCenterRunRule = {
    postRunRule,
    runRuleAndRedirect,
    resolveCsrfHeaders
  };
})(window);
