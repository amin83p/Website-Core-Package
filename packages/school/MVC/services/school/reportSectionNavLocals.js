const { SECTIONS } = require('../../routes/schoolRouteDependencies');

function escapeHrefAttr(value) {
  return String(value || '').replace(/"/g, '&quot;');
}

function attachReportSectionNavLocals(res) {
  const reportsSection = SECTIONS.SCHOOL_REPORTS || 'SCHOOL_REPORTS';
  const reportDashHref = `/dashboard/section-nav/${encodeURIComponent(reportsSection)}`;

  res.locals.schoolReportsDashboardHref = reportDashHref;
  res.locals.reportDashHref = reportDashHref;

  const reportSectionDashboardBtn = `<a href="${escapeHrefAttr(reportDashHref)}" class="school-navigator-dashboard school-navigator-reports-dashboard btn btn-filled btn-secondary btn-md mb-2" title="School Reports (Alt+Shift+R)" aria-keyshortcuts="Alt+Shift+R"><i class="bi bi-file-earmark-richtext me-1"></i> School Reports</a>`;
  res.locals.reportListHeaderManageBtns = [reportSectionDashboardBtn];

  return {
    reportDashHref,
    headerBtnCount: res.locals.reportListHeaderManageBtns.length
  };
}

module.exports = { attachReportSectionNavLocals };
