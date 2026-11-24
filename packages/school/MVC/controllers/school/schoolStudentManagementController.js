const reportHubStudentDirectoryService = require('../../services/school/reportHubStudentDirectoryService');
const studentFileTimelineService = require('../../services/school/studentFileTimelineService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

async function canEditStudentClbForUser(reqUser) {
  return Boolean(await adminAuthorityService.isAdminForRequestAsync(
    reqUser,
    SECTIONS.SCHOOL_STUDENTS,
    OPERATIONS.UPDATE,
    {
      orgId: reqUser?.activeOrgId,
      section: { id: SECTIONS.SCHOOL_STUDENTS, category: 'SCHOOL' }
    }
  ));
}

exports.showStudentManagementPage = async (req, res) => {
  try {
    const canEditStudentClb = await canEditStudentClbForUser(req.user);
    res.render('school/studentManagement', {
      title: 'School Student Management',
      bodyClass: 'school-student-management-page',
      mainClass: 'school-student-management-main p-0 my-0',
      schoolSectionDashboardHref: res.locals?.schoolSectionDashboardHref || '/dashboard/section-nav/SCHOOL',
      includeModal: true,
      canEditStudentClb,
      user: req.user
    });
  } catch (error) {
    res.status(500).render('error', {
      title: 'School Student Management',
      error,
      message: error.message,
      user: req.user
    });
  }
};

exports.searchHubStudents = async (req, res) => {
  try {
    const result = await reportHubStudentDirectoryService.searchStudents(req.query || {}, req);
    res.json({ status: 'success', ...result });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.status(statusCode).json({
      status: 'error',
      message: error.message || 'Unable to search students.'
    });
  }
};

exports.getHubStudentProfile = async (req, res) => {
  try {
    const profile = await reportHubStudentDirectoryService.buildPersonalProfile(req.params.studentId, req);
    res.json({ status: 'success', profile });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.status(statusCode).json({
      status: 'error',
      message: error.message || 'Unable to load student profile.'
    });
  }
};

exports.getHubStudentPopulationSummary = async (req, res) => {
  try {
    const summary = await reportHubStudentDirectoryService.getStudentPopulationSummary(req);
    res.json({ status: 'success', summary });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.status(statusCode).json({
      status: 'error',
      message: error.message || 'Unable to load student population summary.'
    });
  }
};

exports.getHubStudentTimeline = async (req, res) => {
  try {
    const timeline = await studentFileTimelineService.buildStudentFileTimeline(req.params.studentId, req);
    res.json({ status: 'success', timeline });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.status(statusCode).json({
      status: 'error',
      message: error.message || 'Unable to load student timeline.'
    });
  }
};