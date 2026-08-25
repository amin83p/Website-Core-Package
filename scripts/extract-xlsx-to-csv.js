const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
const outDir = process.argv[3];

if (!src || !outDir) {
  console.error('Usage: node scripts/extract-xlsx-to-csv.js <input.xlsx> <output-dir>');
  process.exit(1);
}

function csvEscape(val) {
  if (val == null) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function cellValue(cell) {
  if (!cell || cell.value == null) return '';
  const v = cell.value;
  if (typeof v === 'object') {
    if (v.result != null) return v.result;
    if (v.text != null) return v.text;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (Array.isArray(v)) return v.map((x) => (x && x.text) || x).join('');
    if (v.hyperlink) return v.text || v.hyperlink;
    if (v.formula) return v.result != null ? v.result : '';
    return JSON.stringify(v);
  }
  return v;
}

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(src);
  fs.mkdirSync(outDir, { recursive: true });

  const written = [];
  wb.eachSheet((ws) => {
    const safeName = ws.name.replace(/[<>:'"/\\|?*]/g, '_').trim() || 'sheet';
    const rows = [];

    ws.eachRow({ includeEmpty: true }, (row) => {
      const vals = [];
      const colCount = Math.max(ws.columnCount || 0, row.cellCount || 0, row.actualCellCount || 0);
      for (let c = 1; c <= colCount; c++) {
        vals.push(csvEscape(cellValue(row.getCell(c))));
      }
      while (vals.length && vals[vals.length - 1] === '') vals.pop();
      rows.push(vals.join(','));
    });

    while (rows.length && rows[rows.length - 1] === '') rows.pop();

    const file = path.join(outDir, `${safeName}.csv`);
    fs.writeFileSync(file, rows.length ? `${rows.join('\n')}\n` : '', 'utf8');
    written.push({ sheet: ws.name, file, rows: rows.length });
  });

  console.log(JSON.stringify({ outDir, sheets: written }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
