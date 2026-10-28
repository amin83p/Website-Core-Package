const { SECTIONS } = require('../../routes/schoolRouteDependencies');

function escapeHrefAttr(value) {
  return String(value || '').replace(/"/g, '&quot;');
}

function attachReportSectionNavLocals(res) {
  const reportsSection = SECTIONS.SCHOOL_REPORTS || 'SCHOOL_REPORTS';
  const reportDashHref = `/dashboard/section-nav/${encodeURIComponent(reportsSection)}`;
  const schoolDashHref = String(res.locals?.schoolSectionDashboardHref || '').trim()
    || `/dashboard/section-nav/${encodeURIComponent(SECTIONS.SCHOOL || 'SCHOOL')}`;

  res.locals.schoolReportsDashboardHref = reportDashHref;
  res.locals.reportDashHref = reportDashHref;

  const reportSchoolDashboardBtn = `<a href="${escapeHrefAttr(schoolDashHref)}" class="school-navigator-dashboard btn btn-filled btn-secondary btn-md mb-2"><i class="bi bi-speedometer2 me-1"></i> School Dashboard</a>`;
  const reportSectionDashboardBtn = `<a href="${escapeHrefAttr(reportDashHref)}" class="school-navigator-dashboard school-navigator-reports-dashboard btn btn-filled btn-secondary btn-md mb-2" title="School Reports (Alt+Shift+R)" aria-keyshortcuts="Alt+Shift+R"><i class="bi bi-file-earmark-richtext me-1"></i> School Reports</a>`;
  res.locals.reportListHeaderManageBtns = [reportSchoolDashboardBtn, reportSectionDashboardBtn];

  return {
    reportDashHref,
    headerBtnCount: res.locals.reportListHeaderManageBtns.length
  };
}

module.exports = { attachReportSectionNavLocals };
