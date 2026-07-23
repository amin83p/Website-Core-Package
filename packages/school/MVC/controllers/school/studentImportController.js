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
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');
const { resolveOrgTodayFromContext } = requireCoreModule('MVC/utils/timezoneUtils');
const {
  validateImportRecord,
  admitNewPersonAndStudentFromRecord,
  applyImportDefaults
} = require('../../services/school/studentPersonAdmissionService');
const schoolPersonNameDuplicateService = require('../../services/school/schoolPersonNameDuplicateService');

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

async function previewImport(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No file uploaded.' });
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
            
            // Check for duplicates
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

        return res.json({ status: 'success', rows: previewRows });
      }
    );
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

async function processImport(req, res) {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No rows selected for import.' });
    }

    const context = buildContext(req);
    const results = [];

    for (const row of rows) {
      try {
        validateImportRecord(row, context);
        const result = await admitNewPersonAndStudentFromRecord(row, context);
        results.push({
          success: true,
          name: result.name,
          email: result.email,
          studentId: result.studentId
        });
      } catch (e) {
        results.push({
          success: false,
          name: `${row.firstName || ''} ${row.lastName || ''}`.trim() || 'Unknown',
          error: e.message
        });
      }
    }

    return res.json({ status: 'success', results });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  previewImport,
  processImport
};
