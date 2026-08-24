'use strict';

/**
 * CSV import: each row creates a new Person + Student (never links an existing person).
 * Columns: firstName, lastName, gender [, dateOfBirth, email, enrollmentDate,
 * countryOfOrigin, feeCategory, middleName, preferredName, phone, localId,
 * customStudentId, academicStatus, notes, ...]
 */

const fs = require('fs');
const { parse } = require('csv-parse');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const {
  getActiveOrgIdOrThrow,
  assertCreateOrgContextOrThrow,
  canCreateOrgScopedItem
} = requireCoreModule('MVC/utils/orgContextUtils');
const { resolveOrgTodayFromContext } = requireCoreModule('MVC/utils/timezoneUtils');
const {
  validateImportRecord,
  admitNewPersonAndStudentFromRecord,
  applyImportDefaults,
  resolveDefaultAdmissionDate
} = require('../../services/school/studentPersonAdmissionService');
const schoolPersonNameDuplicateService = require('../../services/school/schoolPersonNameDuplicateService');
const schoolDataService = require('../../services/school/schoolDataService');
const programRegistrationApplyService = require('../../services/school/programRegistrationApplyService');
const {
  parseProgramRegistrationSelectionRows,
  validateProgramSelectionsForStudent
} = require('../../utils/programRegistrationSelectionUtils');

function buildContext(req) {
  const reqUser = req.user || null;
  let orgId = '';
  let orgToday = '';
  try {
    orgId = reqUser ? String(getActiveOrgIdOrThrow(reqUser) || '').trim() : '';
  } catch (_) {
    orgId = String(reqUser?.activeOrgId || '').trim();
  }
  try {
    orgToday = String(resolveOrgTodayFromContext({
      orgTimeZone: req.orgTimeZone || reqUser?.activeOrgTimeZone,
      user: reqUser
    }) || req.orgToday || reqUser?.orgToday || '').trim();
  } catch (_) {
    orgToday = String(req.orgToday || reqUser?.orgToday || '').trim();
  }

  return {
    userId: reqUser ? reqUser.id : '1',
    username: reqUser?.username || reqUser?.email || '',
    reqUser,
    orgId,
    orgToday
  };
}

function routeAccess(req) {
  return schoolDataService.buildRouteAccessContext(req);
}

async function previewImport(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No file uploaded.' });
    }

    try {
      await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'students' });
    } catch (orgError) {
      return res.status(403).json({ status: 'error', message: orgError.message });
    }

    const context = buildContext(req);
    const fileContent = fs.readFileSync(req.file.path, 'utf8');

    parse(
      fileContent,
      { columns: true, skip_empty_lines: true, trim: true },
      async (err, records) => {
        if (err) {
          return res.status(400).json({ status: 'error', message: 'CSV Parse Error: ' + err.message });
        }

        const previewRows = [];
        for (let i = 0; i < records.length; i++) {
          const rawRow = records[i];
          let rowData = null;
          let error = null;
          let duplicates = [];

          try {
            rowData = applyImportDefaults(rawRow, context);
            validateImportRecord(rowData, context);

            duplicates = await schoolPersonNameDuplicateService.findExactNamePersonMatches({
              reqUser: req.user,
              firstName: rowData.firstName,
              lastName: rowData.lastName
            });
          } catch (e) {
            error = e.message;
          }

          previewRows.push({
            index: i,
            raw: rawRow,
            data: rowData,
            error,
            duplicates
          });
        }

        return res.json({
          status: 'success',
          rows: previewRows,
          orgToday: context.orgToday,
          defaultAdmissionDate: resolveDefaultAdmissionDate(context.orgToday)
        });
      }
    );
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

async function registerProgramsForStudent({
  studentId,
  enrollmentDate,
  programSelections,
  activeOrgId,
  reqUser,
  req
}) {
  const studentSelections = validateProgramSelectionsForStudent(programSelections, enrollmentDate);
  const student = await schoolDataService.getDataById('students', studentId, reqUser, routeAccess(req));
  if (!student) throw new Error('Student not found after import.');

  const registrationResults = [];
  for (const selection of studentSelections) {
    try {
      registrationResults.push(await programRegistrationApplyService.processSingleStudentProgramRegistration({
        student,
        programId: selection.programId,
        registrationDate: selection.registrationDate,
        note: selection.note,
        externalReference: selection.externalReference,
        activeOrgId,
        reqUser,
        autoApproveZeroFee: true
      }));
    } catch (registrationError) {
      registrationResults.push({
        status: 'error',
        programId: selection.programId,
        programLabel: selection.programId,
        studentId,
        totalAmount: 0,
        transactionCount: 0,
        issues: [registrationError.message || 'Program registration failed.'],
        message: registrationError.message || 'Program registration failed.'
      });
    }
  }
  return programRegistrationApplyService.summarizeRegistrationResults(registrationResults);
}

async function processImport(req, res) {
  try {
    try {
      await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'students' });
    } catch (orgError) {
      return res.status(403).json({ status: 'error', message: orgError.message });
    }

    const { rows, programRegistrationSelections } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No rows selected for import.' });
    }

    const context = buildContext(req);
    const activeOrgId = String(context.orgId || '').trim();
    let programSelections = [];

    if (programRegistrationSelections !== undefined && programRegistrationSelections !== null
      && String(programRegistrationSelections).trim() !== '') {
      programSelections = parseProgramRegistrationSelectionRows(programRegistrationSelections);
      if (programSelections.length) {
        const canCreateProgramRegistrations = await canCreateOrgScopedItem(req.user, { scopeLabel: 'program registrations' });
        if (!canCreateProgramRegistrations) {
          return res.status(403).json({
            status: 'error',
            message: 'You do not have permission to create program registrations.'
          });
        }
      }
    }

    const results = [];
    let hasPartial = false;
    let hasFailure = false;

    for (const row of rows) {
      try {
        validateImportRecord(row, context);
        const result = await admitNewPersonAndStudentFromRecord(row, context);
        const outcome = {
          success: true,
          name: result.name,
          email: result.email,
          studentId: result.studentId,
          partial: false
        };

        if (programSelections.length) {
          try {
            const programRegistrations = await registerProgramsForStudent({
              studentId: result.studentId,
              enrollmentDate: row.enrollmentDate,
              programSelections,
              activeOrgId,
              reqUser: context.reqUser,
              req
            });
            outcome.programRegistrations = programRegistrations;
            if (Number(programRegistrations.errorCount || 0) > 0) {
              outcome.partial = true;
              hasPartial = true;
            }
          } catch (programError) {
            outcome.partial = true;
            outcome.programRegistrations = {
              status: 'error',
              message: programError.message || 'Program registration failed.',
              finalizedCount: 0,
              draftCount: 0,
              errorCount: programSelections.length,
              results: []
            };
            hasPartial = true;
          }
        }

        results.push(outcome);
      } catch (e) {
        hasFailure = true;
        results.push({
          success: false,
          name: `${row.firstName || ''} ${row.lastName || ''}`.trim() || 'Unknown',
          error: e.message
        });
      }
    }

    return res.json({
      status: 'success',
      partial: hasPartial || hasFailure,
      results
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  previewImport,
  processImport
};
