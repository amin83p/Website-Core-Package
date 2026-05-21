(function registerGenericPickerSchoolProfiles(global) {
  const core = global.GenericPickerCore;
  if (!core) return;

  const utils = core.utils || {};

  core.registerProfile(['teacher', 'teachers'], {
    icon: 'bi-person-workspace',
    getSummary(item) {
      const email = utils.getPrimaryEmail ? utils.getPrimaryEmail(item) : '';
      const org = utils.getOrgInfo ? utils.getOrgInfo(item, 'teachers') : null;
      const bits = [];
      if (email) bits.push(email);
      if (org?.name) bits.push(`Org: ${org.name}`);
      return bits.join(' | ') || 'Teacher record';
    }
  });

  core.registerProfile(['student', 'students'], {
    icon: 'bi-person-vcard-fill',
    getSummary(item) {
      const email = utils.getPrimaryEmail ? utils.getPrimaryEmail(item) : '';
      const feeCategory = String(item?.feeCategory || '').trim();
      const bits = [];
      if (email) bits.push(email);
      if (feeCategory) bits.push(`Fee: ${feeCategory}`);
      return bits.join(' | ') || 'Student record';
    }
  });

  core.registerProfile(['staff'], {
    icon: 'bi-people-fill',
    getSummary(item) {
      const email = utils.getPrimaryEmail ? utils.getPrimaryEmail(item) : '';
      const jobTitle = String(item?.jobTitle || '').trim();
      const bits = [];
      if (email) bits.push(email);
      if (jobTitle) bits.push(jobTitle);
      return bits.join(' | ') || 'Staff record';
    }
  });

  core.registerProfile(['program', 'programs'], {
    icon: 'bi-journal-bookmark-fill',
    getSummary(item) {
      const code = String(item?.code || item?.id || '').trim();
      const status = String(item?.status || '').trim();
      const bits = [];
      if (code) bits.push(code);
      if (status) bits.push(utils.toLabel ? utils.toLabel(status) : status);
      return bits.join(' | ') || 'Program record';
    }
  });

  core.registerProfile(['subject', 'subjects'], {
    icon: 'bi-book-fill',
    getSummary(item) {
      const code = String(item?.code || item?.id || '').trim();
      const credits = item?.credits;
      const bits = [];
      if (code) bits.push(code);
      if (credits !== undefined && credits !== null && credits !== '') bits.push(`Credits: ${credits}`);
      return bits.join(' | ') || 'Subject record';
    }
  });

  core.registerProfile(['class', 'classes'], {
    icon: 'bi-easel-fill',
    getSummary(item) {
      const code = String(item?.code || item?.id || '').trim();
      const status = String(item?.status || '').trim();
      const capacity = item?.capacity;
      const bits = [];
      if (code) bits.push(code);
      if (status) bits.push(utils.toLabel ? utils.toLabel(status) : status);
      if (capacity !== undefined && capacity !== null && capacity !== '') bits.push(`Capacity: ${capacity}`);
      return bits.join(' | ') || 'Class record';
    }
  });

  core.registerProfile(['session', 'sessions'], {
    icon: 'bi-calendar3',
    getSummary(item) {
      const start = String(item?.startDate || item?.sessionDate || '').trim();
      const end = String(item?.endDate || '').trim();
      if (start && end) return `${start} to ${end}`;
      return start || end || 'Session record';
    }
  });

  core.registerProfile(['sessionstatus', 'sessionstatuses', 'session-statuses'], {
    icon: 'bi-sliders',
    getTitle(item) {
      const label = String(item?.label || '').trim();
      const code = String(item?.code || item?.id || '').trim();
      if (label && code) return `${label} (${code})`;
      return label || code || 'Session status';
    },
    getSummary(item, utils) {
      const bits = [];
      if (item?.timesheetFormula) bits.push(`Formula: ${item.timesheetFormula}`);
      if (item?.isFinal) bits.push('Final');
      if (item?.makeUpRequired) bits.push('Make-up');
      if (item?.active === false) bits.push('Inactive');
      return bits.join(' | ') || 'Session status definition';
    }
  });

  core.registerProfile(['department', 'departments'], {
    icon: 'bi-diagram-3-fill',
    getSummary(item) {
      const code = String(item?.code || item?.id || '').trim();
      const manager = String(item?.managerName || '').trim();
      const bits = [];
      if (code) bits.push(code);
      if (manager) bits.push(`Manager: ${manager}`);
      return bits.join(' | ') || 'Department record';
    }
  });

  core.registerProfile(['term', 'terms'], {
    icon: 'bi-calendar3-range-fill',
    getSummary(item) {
      const start = String(item?.startDate || '').trim();
      const end = String(item?.endDate || '').trim();
      const status = String(item?.status || '').trim();
      const bits = [];
      if (start) bits.push(start);
      if (end) bits.push(`to ${end}`);
      if (status) bits.push(utils.toLabel ? utils.toLabel(status) : status);
      return bits.join(' | ') || 'Term record';
    }
  });

  core.registerProfile(['transactiondefinition', 'transactiondefinitions'], {
    icon: 'bi-receipt-cutoff',
    getSummary(item) {
      const bits = [];
      if (item?.status) bits.push(utils.toLabel ? utils.toLabel(item.status) : item.status);
      if (item?.validFrom || item?.validTo) bits.push(`${item.validFrom || '?'} to ${item.validTo || '?'}`);
      return bits.join(' | ') || 'Transaction template';
    }
  });

  core.registerProfile(['account', 'accounts'], {
    icon: 'bi-wallet2',
    getSummary(item) {
      const bits = [];
      if (item?.code) bits.push(String(item.code));
      if (item?.type) bits.push(`Type: ${utils.toLabel ? utils.toLabel(item.type) : item.type}`);
      if (item?.level !== undefined && item?.level !== null && item?.level !== '') bits.push(`Level: ${item.level}`);
      if (item?.partyRole) bits.push(`Role: ${utils.toLabel ? utils.toLabel(item.partyRole) : item.partyRole}`);
      bits.push(`Postable: ${item?.allowPost ? 'Yes' : 'No'}`);
      if (item?.status) bits.push(`Status: ${utils.toLabel ? utils.toLabel(item.status) : item.status}`);
      return bits.join(' | ') || 'Account record';
    },
    getStatusBadge(item, utils) {
      const status = String(item?.status || '').trim().toLowerCase();
      const isActive = status === 'active';
      const isPostable = Boolean(item?.allowPost);
      if (isActive && isPostable) {
        return '<span class="badge bg-success mb-1">Active + Postable</span>';
      }
      if (isActive && !isPostable) {
        return '<span class="badge bg-warning text-dark mb-1">Active + Non-Postable</span>';
      }
      if (!isActive && isPostable) {
        return '<span class="badge bg-secondary mb-1">Inactive + Postable</span>';
      }
      return '<span class="badge bg-danger mb-1">Inactive + Non-Postable</span>';
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
