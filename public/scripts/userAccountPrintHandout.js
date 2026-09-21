// public/scripts/userAccountPrintHandout.js
(function initUserAccountPrintHandout(global) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function resolveSiteOrigin(init) {
    return String(init?.siteBase || '').trim().replace(/\/$/, '')
      || global.location.origin.replace(/\/$/, '');
  }

  function readPayloadFromForm(form, init, options = {}) {
    const uaPrintInit = init && typeof init === 'object' ? init : {};
    const uaOrigin = resolveSiteOrigin(uaPrintInit);
    const email = form?.querySelector('[name="email"]')?.value?.trim() || '—';
    const username = form?.querySelector('[name="username"]')?.value?.trim() || '';

    let statusLabel = '—';
    const statusSelect = form?.querySelector('[name="status"]');
    if (statusSelect) {
      statusLabel = statusSelect.options[statusSelect.selectedIndex]?.text
        || statusSelect.value
        || '—';
    } else if (uaPrintInit.statusLabel) {
      statusLabel = String(uaPrintInit.statusLabel).trim() || '—';
    }

    let personName = String(uaPrintInit.personName || '').trim();
    const personFieldId = options.personNameFieldId || '';
    if (personFieldId) {
      const personField = global.document?.getElementById(personFieldId)?.value?.trim() || '';
      if (personField) {
        personName = personField.replace(/\s*\([^)]*\)\s*$/, '').trim() || personName;
      }
    }

    return {
      userId: String(uaPrintInit.userId || '').trim(),
      appName: String(uaPrintInit.appName || 'Application').trim(),
      personName: personName || '—',
      email,
      username,
      statusLabel,
      loginUrl: `${uaOrigin}/login`,
      microsoftLoginUrl: `${uaOrigin}/auth/microsoft`,
      passwordResetUrl: `${uaOrigin}/password-reset`,
      profileUrl: `${uaOrigin}/profile`,
      microsoftAuthEnabled: uaPrintInit.microsoftAuthEnabled === true
    };
  }

  function buildSignInInstructionsHtml(payload) {
    const loginUrl = escapeHtml(payload.loginUrl);
    const microsoftLoginUrl = escapeHtml(payload.microsoftLoginUrl);
    const loginEmail = escapeHtml(payload.email);
    const usernameValue = escapeHtml(payload.username || '');
    const usernameLoginHint = payload.username
      ? `your username (<strong>${usernameValue}</strong>) or login email (<strong>${loginEmail}</strong>)`
      : `your login email (<strong>${loginEmail}</strong>) or username, if one was assigned`;

    const callout = `
    <div class="callout">
      <strong>Important:</strong> By default, your account may not have a password. You can sign in right away using
      <strong>Microsoft</strong> with your organization email account. Using Microsoft is the recommended way to
      secure your account so it is accessible only through your organization&rsquo;s identity (Microsoft).
    </div>`;

    const option1 = `
    <div class="section-subtitle">Option 1 — Username and password</div>
    <ol class="steps">
      <li>Open the sign-in page: <a href="${loginUrl}">${loginUrl}</a></li>
      <li>Enter ${usernameLoginHint} and your password, then click <strong>Sign in</strong>.</li>
      <li>If you do not have a password yet, ask your administrator to set one or use the password reset flow after your account is active.</li>
    </ol>`;

    const option2 = payload.microsoftAuthEnabled ? `
    <div class="section-subtitle">Option 2 — Microsoft (organization email)</div>
    <ol class="steps">
      <li>Open the sign-in page: <a href="${loginUrl}">${loginUrl}</a></li>
      <li>Click <strong>Microsoft</strong> (or go directly to <a href="${microsoftLoginUrl}">${microsoftLoginUrl}</a>).</li>
      <li>Sign in with your organization Microsoft account. Use the same organization email as your login email (<strong>${loginEmail}</strong>) when prompted.</li>
      <li>This option works even when no local password has been set and helps keep access limited to your organization account.</li>
    </ol>` : `
    <div class="section-subtitle">Option 2 — Microsoft (organization email)</div>
    <p class="steps-note">Microsoft sign-in is not enabled on this site. Contact your administrator if you need organization account access.</p>`;

    return `${callout}${option1}${option2}
    <p class="steps-note">If you cannot sign in with either option, contact your organization administrator for help.</p>`;
  }

  function buildUserAccountPrintDocument(payload, printSettings) {
    const apm = global.AppPrintManager;
    if (!apm) return '';

    const settings = apm.normalizeSettings({
      ...printSettings,
      orientation: 'portrait'
    });
    const orgName = settings.includeOrg !== false ? String(settings.orgName || '').trim() : '';
    const logoUrl = String(settings.logoUrl || '').trim();
    const logoHtml = logoUrl
      ? `<img class="print-logo" src="${escapeHtml(logoUrl)}" alt="">`
      : '';
    const printNoteHtml = apm.buildPrintNoteHtml(settings);
    const previewControlsHtml = apm.buildPreviewControlsHtml(settings);
    const printedAt = new Date().toLocaleString();
    const usernameRow = payload.username
      ? `<tr><th>Username</th><td>${escapeHtml(payload.username)}</td></tr>`
      : `<tr><th>Username</th><td class="muted">—</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml('Account information — ' + (payload.personName !== '—' ? payload.personName : payload.userId))}</title>
  <style id="print-page-orientation-css">@page { margin: 12mm; size: A4 portrait; }</style>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 11px;
      color: #172033;
      line-height: 1.45;
    }
    .sheet { padding: 0; max-width: 720px; margin: 0 auto; }
    .identity-block { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
    .identity-copy { min-width: 0; flex: 1 1 auto; }
    .print-logo { display: block; flex: 0 0 auto; height: 56px; max-width: 180px; object-fit: contain; object-position: right top; }
    .org-name { font-size: 14px; font-weight: 700; margin: 0 0 4px 0; color: #174ea6; }
    .app-name { font-size: 11px; color: #5f6b7a; margin: 0 0 6px 0; }
    .doc-header h1 { margin: 0 0 8px 0; font-size: 18px; font-weight: 700; }
    .print-note {
      margin: 0 0 12px;
      border: 1px solid #cfd7e3;
      background: #f4f7fb;
      padding: 8px 10px;
      white-space: pre-wrap;
    }
    .details-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    .details-table th,
    .details-table td {
      border: 1px solid #cfd7e3;
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    .details-table th {
      width: 32%;
      background: #f4f7fb;
      font-weight: 600;
    }
    .details-table td.muted { color: #5f6b7a; }
    .section-title {
      font-size: 13px;
      font-weight: 700;
      margin: 18px 0 8px 0;
      color: #174ea6;
    }
    .section-subtitle {
      font-size: 12px;
      font-weight: 700;
      margin: 14px 0 6px 0;
      color: #172033;
    }
    .callout {
      margin: 0 0 14px 0;
      padding: 10px 12px;
      border: 1px solid #cfd7e3;
      border-left: 4px solid #174ea6;
      background: #f4f7fb;
      line-height: 1.5;
    }
    .steps-note {
      margin: 8px 0 0 0;
      color: #5f6b7a;
      font-size: 10px;
    }
    .steps { margin: 0 0 12px 0; padding-left: 1.25rem; }
    .steps li { margin-bottom: 6px; }
    .steps a { color: #174ea6; word-break: break-all; }
    .doc-footer {
      margin-top: 20px;
      padding-top: 8px;
      border-top: 1px solid #cfd7e3;
      color: #5f6b7a;
      font-size: 9px;
    }
    @media print {
      body { margin: 0; }
      .no-print { display: none !important; }
      a { color: inherit; text-decoration: underline; }
    }
    @media screen {
      body { background: #e9ecef; padding: 16px; }
      .sheet {
        background: #fff;
        padding: 20px 22px;
        box-shadow: 0 1px 6px rgba(0,0,0,0.12);
      }
    }
  </style>
</head>
<body data-print-orientation="portrait">
  ${previewControlsHtml}
  <div class="sheet">
    <div class="identity-block">
      <div class="identity-copy">
        <header class="doc-header">
          ${orgName ? `<div class="org-name">${escapeHtml(orgName)}</div>` : ''}
          <div class="app-name">${escapeHtml(payload.appName)}</div>
          <h1>Account information</h1>
        </header>
      </div>
      ${logoHtml}
    </div>
    ${printNoteHtml}
    <table class="details-table">
      <tbody>
        <tr><th>Name</th><td>${escapeHtml(payload.personName)}</td></tr>
        <tr><th>User ID</th><td style="font-family: ui-monospace, Consolas, monospace;">${escapeHtml(payload.userId || '—')}</td></tr>
        <tr><th>Login email</th><td>${escapeHtml(payload.email)}</td></tr>
        ${usernameRow}
        <tr><th>Account status</th><td>${escapeHtml(payload.statusLabel)}</td></tr>
      </tbody>
    </table>

    <div class="section-title">How to sign in</div>
    ${buildSignInInstructionsHtml(payload)}

    <div class="section-title">How to change your password</div>
    <p class="steps-note" style="margin-bottom: 8px;">A local password is optional if you use Microsoft. Set or change a password only if you also want to sign in with Option 1.</p>
    <ol class="steps">
      <li><strong>After signing in:</strong> Open your profile at <a href="${escapeHtml(payload.profileUrl)}">${escapeHtml(payload.profileUrl)}</a>, go to <strong>Account Settings</strong>, enter a new password, and save.</li>
      <li><strong>If you forgot your password:</strong> On the sign-in page, click <strong>Forgot password?</strong> or visit <a href="${escapeHtml(payload.passwordResetUrl)}">${escapeHtml(payload.passwordResetUrl)}</a> and follow the email or SMS verification steps.</li>
    </ol>

    <div class="doc-footer">Printed ${escapeHtml(printedAt)}${settings.requestedByLabel ? ' · Prepared by ' + escapeHtml(settings.requestedByLabel) : ''}</div>
  </div>
</body>
</html>`;
  }

  function openAccountPrintPreview(options = {}) {
    const apm = global.AppPrintManager;
    const form = options.form || null;
    const initEl = options.initEl || null;
    if (!apm || !form || !initEl) return null;

    let init;
    try {
      init = JSON.parse(initEl.textContent || '{}');
    } catch (_) {
      init = {};
    }

    const payload = readPayloadFromForm(form, init, {
      personNameFieldId: options.personNameFieldId || ''
    });
    const sourcePath = String(options.sourcePath || global.location?.pathname || '/').trim() || '/';
    const view = String(options.view || 'user-account').trim() || 'user-account';

    const settings = apm.buildDefaultSettings({
      mode: 'user-account',
      sourcePath,
      defaults: { orientation: 'portrait', density: 'normal' }
    });
    const html = buildUserAccountPrintDocument(payload, settings);
    const printWindow = apm.openHtmlPreview({
      title: 'Account information',
      html,
      settings,
      sourcePath,
      view,
      autoPrint: false
    });

    if (!printWindow) {
      if (typeof global.showMessageModal === 'function') {
        global.showMessageModal({
          title: 'Popup blocked',
          icon: 'warning',
          message: 'Allow pop-ups for this site to open the print page.',
          buttons: [{ text: 'Close', class: 'btn-secondary' }]
        });
      } else {
        global.alert('Allow pop-ups for this site to open the print page.');
      }
    }

    return printWindow;
  }

  const api = {
    escapeHtml,
    readPayloadFromForm,
    buildSignInInstructionsHtml,
    buildUserAccountPrintDocument,
    openAccountPrintPreview
  };

  global.UserAccountPrintHandout = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : global);
