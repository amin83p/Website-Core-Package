(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function toHours(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatHours(value) {
    return toHours(value).toFixed(2);
  }

  function renderTable(departmentTotals, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const heading = String(opts.heading || 'Hours by Department').trim() || 'Hours by Department';
    const wrapperClass = String(opts.wrapperClass || 'mt-4 pt-3 border-top').trim();
    const rows = Array.isArray(departmentTotals?.rows) ? departmentTotals.rows : [];
    const totals = departmentTotals?.totals || {
      groupHours: 0,
      oneOnOneHours: 0,
      oneOnOneOptionalHours: 0,
      groupPendingHours: 0,
      oneOnOnePendingHours: 0,
      totalHours: 0
    };

    if (!rows.length) {
      return [
        '<section class="' + escapeHtml(wrapperClass) + '">',
        '<div class="fw-bold mb-2"><i class="bi bi-diagram-3 me-2 text-primary"></i>' + escapeHtml(heading) + '</div>',
        '<div class="small text-muted mb-3">Group and one-on-one hours are split when a class has max capacity of 1 or only one student is enrolled in the timesheet period. One-on-one optional hours are informational only and do not affect payroll totals.</div>',
        '<div class="text-center text-muted py-3 border rounded bg-light">No department hours yet.</div>',
        '</section>'
      ].join('');
    }

    let totalGroup = 0;
    let totalOneOnOne = 0;
    let totalOneOnOneOptional = 0;
    let totalPending = 0;

    const bodyRows = rows.map(function (row) {
      const groupHours = toHours(row.groupHours);
      const oneOnOneHours = toHours(row.oneOnOneHours);
      const oneOnOneOptionalHours = toHours(row.oneOnOneOptionalHours);
      const pendingHours = toHours(row.groupPendingHours) + toHours(row.oneOnOnePendingHours);
      const rowTotal = toHours(row.totalHours) || Number((groupHours + oneOnOneHours + pendingHours).toFixed(2));
      totalGroup += groupHours;
      totalOneOnOne += oneOnOneHours;
      totalOneOnOneOptional += oneOnOneOptionalHours;
      totalPending += pendingHours;
      return [
        '<tr>',
        '<td class="ps-3 fw-semibold">' + escapeHtml(row.departmentName || 'No Department') + '</td>',
        '<td class="text-end pe-3 fw-semibold">' + formatHours(groupHours) + '</td>',
        '<td class="text-end pe-3 fw-semibold">' + formatHours(oneOnOneHours) + '</td>',
        '<td class="text-end pe-3 fw-semibold text-info-emphasis">' + formatHours(oneOnOneOptionalHours) + '</td>',
        '<td class="text-end pe-3 fw-semibold text-warning">' + formatHours(pendingHours) + '</td>',
        '<td class="text-end pe-3 fw-semibold text-success">' + formatHours(rowTotal) + '</td>',
        '</tr>'
      ].join('');
    }).join('');

    const grandTotal = Number((totalGroup + totalOneOnOne + totalPending).toFixed(2));
    const footerGroup = formatHours(totals.groupHours ?? totalGroup);
    const footerOneOnOne = formatHours(totals.oneOnOneHours ?? totalOneOnOne);
    const footerOptional = formatHours(totals.oneOnOneOptionalHours ?? totalOneOnOneOptional);
    const footerPending = formatHours((totals.groupPendingHours || 0) + (totals.oneOnOnePendingHours || 0) || totalPending);
    const footerTotal = formatHours(totals.totalHours ?? grandTotal);

    return [
      '<section class="' + escapeHtml(wrapperClass) + '">',
      '<div class="fw-bold mb-2"><i class="bi bi-diagram-3 me-2 text-primary"></i>' + escapeHtml(heading) + '</div>',
      '<div class="small text-muted mb-3">Group and one-on-one hours are split when a class has max capacity of 1 or only one student is enrolled in the timesheet period. One-on-one optional hours are informational only and do not affect payroll totals.</div>',
      '<div class="table-responsive">',
      '<table class="table table-bordered table-sm align-middle mb-0">',
      '<thead class="table-light">',
      '<tr>',
      '<th class="ps-3">Department</th>',
      '<th class="text-end pe-3" style="width: 120px;">Group Hours</th>',
      '<th class="text-end pe-3" style="width: 120px;">One-on-One Hours</th>',
      '<th class="text-end pe-3" style="width: 120px;">One-on-One Optional</th>',
      '<th class="text-end pe-3" style="width: 120px;">Pending</th>',
      '<th class="text-end pe-3" style="width: 120px;">Total</th>',
      '</tr>',
      '</thead>',
      '<tbody>', bodyRows, '</tbody>',
      '<tfoot class="table-light">',
      '<tr>',
      '<th class="ps-3">Total</th>',
      '<th class="text-end pe-3 text-success">' + footerGroup + '</th>',
      '<th class="text-end pe-3 text-success">' + footerOneOnOne + '</th>',
      '<th class="text-end pe-3 text-info-emphasis">' + footerOptional + '</th>',
      '<th class="text-end pe-3 text-warning">' + footerPending + '</th>',
      '<th class="text-end pe-3 text-success">' + footerTotal + '</th>',
      '</tr>',
      '</tfoot>',
      '</table>',
      '</div>',
      '</section>'
    ].join('');
  }

  global.TimesheetDepartmentHoursView = {
    renderTable: renderTable
  };
}(typeof window !== 'undefined' ? window : global));
