// Smoke test: exceljs must still work after the uuid ^8.3.0 -> ^11.1.1 override.
// 1. require('exceljs') must load in CJS mode (uuid 11 must still expose a
//    CommonJS entry with the named v4 export exceljs destructures).
// 2. Generating a real workbook in memory must succeed and produce a valid
//    xlsx (PK zip magic bytes), including a conditional-formatting rule,
//    which is the only code path in exceljs that actually calls uuid.v4().
// 3. Parsing the generated buffer back must round-trip the values.
//
// Run: npm test (from the backend folder, after npm install).

const ExcelJS = require('exceljs');

async function main() {
  // 1. CJS load check (the require itself would throw if uuid 11 were
  //    ESM-only - exceljs destructures require('uuid') at module load time).
  const uuid = require('uuid');
  const v4 = typeof uuid.v4 === 'function' ? uuid.v4 : null;
  if (!v4) throw new Error('uuid CJS entry does not expose v4()');
  const sample = v4();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sample)) {
    throw new Error('uuid.v4() returned a non-v4 value: ' + sample);
  }
  console.log('PASS  exceljs loads in CJS; uuid.v4() works ->', sample);

  // 2. Build a workbook shaped like the app's Excel export (two sheets,
  //    styled header, number formats, totals row) plus a conditional format
  //    rule - the only place exceljs internally calls uuidv4().
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Milk Collections');
  ws.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Farmer', key: 'farmer', width: 20 },
    { header: 'Liters', key: 'liters', width: 10, style: { numFmt: '#,##0.00' } },
    { header: 'Amount', key: 'amount', width: 14, style: { numFmt: '#,##0.00' } }
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A7F4E' } };
  ws.addRow({ date: '2026-09-28', farmer: 'Ramesh Patel', liters: 12.5, amount: 406.25 });
  ws.addRow({ date: '2026-09-28', farmer: 'Sunita Devi', liters: 8.25, amount: 268.13 });
  const total = ws.addRow({ date: '', farmer: 'Total', liters: 20.75, amount: 674.38 });
  total.font = { bold: true };
  ws.getColumn('liters').numFmt = '#,##0.00';

  // Conditional formatting -> forces the uuid.v4() code path in
  // cf-rule-ext-xform.js (model.x14Id / id assignment).
  ws.addConditionalFormatting({
    ref: 'C2:C4',
    rules: [
      {
        type: 'cellIs',
        operator: 'greaterThan',
        formulae: ['10'],
        style: { font: { color: { argb: 'FF9C0006' } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } },
        priority: 1,
        ext: { x14: true }
      }
    ]
  });

  const summary = wb.addWorksheet('Summary');
  summary.addRow(['Farmer', 'Total Liters']);
  summary.addRow(['Ramesh Patel', 12.5]);
  summary.addRow(['Sunita Devi', 8.25]);

  const buffer = await wb.xlsx.writeBuffer();
  const bytes = Buffer.from(buffer);
  if (bytes.byteLength < 1000) throw new Error('workbook suspiciously small: ' + bytes.byteLength + ' bytes');
  if (bytes.slice(0, 2).toString('ascii') !== 'PK') throw new Error('not a zip/xlsx (missing PK magic)');
  console.log('PASS  workbook generated:', bytes.byteLength, 'bytes, PK magic OK, includes a conditional-format rule (uuid.v4 path exercised)');

  // 3. Round-trip: read the buffer back and confirm values survived.
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buffer);
  const ws2 = wb2.getWorksheet('Milk Collections');
  const liters = ws2.getRow(3).getCell(3).value;   // 8.25
  const farmer = ws2.getRow(2).getCell(2).value;   // Ramesh Patel
  if (farmer !== 'Ramesh Patel') throw new Error('round-trip farmer mismatch: ' + farmer);
  if (Number(liters) !== 8.25) throw new Error('round-trip liters mismatch: ' + liters);
  const sheetCount = wb2.worksheets.length;
  if (sheetCount !== 2) throw new Error('expected 2 worksheets after round-trip, got ' + sheetCount);
  console.log('PASS  round-trip parse OK (2 sheets, values intact)');

  console.log('RESULT: exceljs fully compatible with uuid@11.1.1 override');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
