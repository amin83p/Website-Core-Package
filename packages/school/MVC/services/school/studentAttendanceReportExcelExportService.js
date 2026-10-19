const attendanceExcelExportService = require('./attendanceExcelExportService');
const studentAttendanceReportService = require('./studentAttendanceReportService');

async function buildStudentAttendanceReportExcelExport(req, options = {}) {
  const personId = String(options.personId || '').trim();
  const startDate = String(options.startDate || '').trim();
  const endDate = String(options.endDate || '').trim();
  const sheetLayout = attendanceExcelExportService.normalizeStudentExcelSheetLayout(options.sheetLayout);

  const collected = await studentAttendanceReportService.collectStudentClassMatrixPayloadsForExport(req, {
    personId,
    startDate,
    endDate
  });

  const entries = Array.isArray(collected.entries) ? collected.entries : [];
  if (!entries.length) {
    const error = new Error('No attendance to export for this student in the selected range.');
    error.statusCode = 400;
    throw error;
  }

  const classEntries = entries.map((row) => ({
    payload: row.payload,
    sheetName: row.className
  }));

  return attendanceExcelExportService.buildStudentAttendanceExcelWorkbook(classEntries, {
    studentName: collected.student?.name || personId,
    startDate: collected.startDate,
    endDate: collected.endDate
  }, {
    sheetLayout
  });
}

module.exports = {
  buildStudentAttendanceReportExcelExport
};
