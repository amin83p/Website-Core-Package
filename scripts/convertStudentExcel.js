const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function convertExcelToCsv(inputFilePath, outputFilePath, sheetIndex = 0) {
  try {
    console.log(`Reading Excel file: ${inputFilePath}, Sheet Index: ${sheetIndex}`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(inputFilePath);
    
    if (sheetIndex >= workbook.worksheets.length) {
      console.error(`Sheet index ${sheetIndex} is out of bounds. The workbook only has ${workbook.worksheets.length} sheets.`);
      return;
    }
    
    const worksheet = workbook.worksheets[sheetIndex];
    const students = [];
    
    let isDataRow = false;
    let lastNameColIdx = -1;
    let firstNameColIdx = -1;
    let clbColIdx = -1;
    let genderColIdx = -1; // We need gender for import, default to 'Unknown' if not found

    worksheet.eachRow((row, rowNumber) => {
      const values = row.values;
      
      // Find header row
      if (!isDataRow) {
        for (let i = 1; i < values.length; i++) {
          const val = String(values[i] || '').trim().toLowerCase();
          if (val.includes('last name')) lastNameColIdx = i;
          if (val.includes('first name')) firstNameColIdx = i;
          if (val.includes('clb')) clbColIdx = i;
          if (val.includes('gender')) genderColIdx = i;
        }
        
        if (lastNameColIdx !== -1 && firstNameColIdx !== -1) {
          isDataRow = true;
          console.log(`Found headers at row ${rowNumber}. Last Name: col ${lastNameColIdx}, First Name: col ${firstNameColIdx}, CLB: col ${clbColIdx}`);
        }
        return;
      }
      
      // Process data rows
      if (isDataRow) {
        let lastName = values[lastNameColIdx];
        let firstName = values[firstNameColIdx];
        let clb = clbColIdx !== -1 ? values[clbColIdx] : '';
        
        // Handle rich text objects in Excel
        if (lastName && typeof lastName === 'object' && lastName.richText) {
          lastName = lastName.richText.map(rt => rt.text).join('');
        }
        if (firstName && typeof firstName === 'object' && firstName.richText) {
          firstName = firstName.richText.map(rt => rt.text).join('');
        }
        if (clb && typeof clb === 'object' && clb.richText) {
          clb = clb.richText.map(rt => rt.text).join('');
        }
        
        lastName = String(lastName || '').trim();
        firstName = String(firstName || '').trim();
        clb = String(clb || '').trim();
        
        if (lastName && firstName && lastName !== 'Last Name' && firstName !== 'First Name' && lastName !== 'Part-time') {
          students.push({
            firstName,
            lastName,
            gender: 'Unknown', // Required field
            clbCurrent: clb
          });
        }
      }
    });
    
    console.log(`Found ${students.length} students.`);
    
    if (students.length > 0) {
      const headers = ['firstName', 'lastName', 'gender', 'clbCurrent'];
      const csvLines = [headers.join(',')];
      
      for (const s of students) {
        csvLines.push([
          escapeCsv(s.firstName),
          escapeCsv(s.lastName),
          escapeCsv(s.gender),
          escapeCsv(s.clbCurrent)
        ].join(','));
      }
      
      fs.writeFileSync(outputFilePath, csvLines.join('\n'), 'utf8');
      console.log(`Successfully wrote CSV to: ${outputFilePath}`);
    } else {
      console.log('No student data found to write.');
    }
    
  } catch (error) {
    console.error('Error converting file:', error);
  }
}

// Execute if run directly
if (require.main === module) {
  const inputPath = process.argv[2] || 'c:/Users/Amin/Downloads/July 2026 Attendance EAL class (3) (1).xlsx';
  const outputPath = process.argv[3] || path.join(__dirname, 'import_students.csv');
  const sheetIndex = parseInt(process.argv[4] || '0', 10);
  
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }
  
  convertExcelToCsv(inputPath, outputPath, sheetIndex);
}

module.exports = convertExcelToCsv;