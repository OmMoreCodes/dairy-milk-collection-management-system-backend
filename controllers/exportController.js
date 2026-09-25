const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const Organization = require('../models/Organization');
const Farmer = require('../models/Farmer');
const MilkCollection = require('../models/MilkCollection');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function roundTo2(value) {
  return Math.round(value * 100) / 100;
}

function fmtNumber(value) {
  return Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function fmtMoney(value) {
  return 'Rs. ' + Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function fmtDateDisplay(dateStr) {
  if (!isValidDate(dateStr)) return String(dateStr);
  const [y, m, d] = dateStr.split('-').map(Number);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d).padStart(2, '0')} ${monthNames[m - 1]} ${y}`;
}

function fmtDateTime(date) {
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
  });
}

function shiftOrder(shift) {
  return shift === 'Morning' ? 0 : 1;
}

// ---------------------------------------------------------------- PDF helpers

function pdfSummary(doc, items) {
  if (!items || !items.length) return;
  const startX = 40;
  const width = 515;
  const height = 48;
  const y = doc.y;

  doc.save();
  doc.roundedRect(startX, y, width, height, 6).fillAndStroke('#f0f7f3', '#d5e5db');
  doc.restore();

  const colWidth = width / items.length;
  items.forEach((item, i) => {
    const cx = startX + i * colWidth;
    doc.font('Helvetica').fontSize(7.5).fillColor('#6b7280')
      .text(item.label, cx + 4, y + 10, { width: colWidth - 8, align: 'center', lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#14532d')
      .text(item.value, cx + 4, y + 24, { width: colWidth - 8, align: 'center', lineBreak: false });
  });

  doc.y = y + height + 20;
}

function pdfTable(doc, columns, rows, totalsRow) {
  const startX = 40;
  const endX = 555;
  const totalWidth = endX - startX;
  const rowHeight = 20;

  const weightSum = columns.reduce((sum, c) => sum + c.w, 0);
  let cursor = startX;
  const cols = columns.map((c) => {
    const w = (c.w / weightSum) * totalWidth;
    const col = { ...c, w, x: cursor };
    cursor += w;
    return col;
  });

  const drawHeader = () => {
    const y = doc.y;
    doc.save();
    doc.rect(startX, y, totalWidth, rowHeight).fill('#e5f0e9');
    doc.restore();
    cols.forEach((c) => {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#14532d')
        .text(c.label, c.x + 4, y + 6, {
          width: c.w - 8, align: c.align || 'left', lineBreak: false, ellipsis: true
        });
    });
    doc.y = y + rowHeight;
    doc.moveTo(startX, doc.y).lineTo(endX, doc.y).lineWidth(0.75).strokeColor('#cfd8d2').stroke();
    doc.y += 1;
  };

  const needsPageBreak = () => doc.y + rowHeight > doc.page.height - 70;

  const drawRow = (cells, { bold = false, fill = null } = {}) => {
    if (needsPageBreak()) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    if (fill) {
      doc.save();
      doc.rect(startX, y, totalWidth, rowHeight).fill(fill);
      doc.restore();
    }
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
      .fillColor(bold ? '#111827' : '#374151');
    cells.forEach((cell, i) => {
      const c = cols[i];
      doc.text(String(cell), c.x + 4, y + 6, {
        width: c.w - 8, align: c.align || 'left', lineBreak: false, ellipsis: true
      });
    });
    doc.y = y + rowHeight;
  };

  drawHeader();
  rows.forEach((row, index) => {
    drawRow(row, { fill: index % 2 === 1 ? '#f8faf9' : null });
  });
  if (totalsRow) {
    drawRow(totalsRow, { bold: true, fill: '#eef2ef' });
  }
}

function pdfEmptyState(doc) {
  const y = doc.y;
  doc.save();
  doc.roundedRect(40, y, 515, 44, 6).fillAndStroke('#fbfaf5', '#e5e0d1');
  doc.restore();
  doc.font('Helvetica-Oblique').fontSize(10).fillColor('#9ca3af')
    .text('No records found for the selected period.', 40, y + 16, {
      width: 515, align: 'center', lineBreak: false
    });
  doc.y = y + 60;
}

function finishPdf(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 40;
    doc.font('Helvetica').fontSize(7.5).fillColor('#9ca3af');
    doc.text('Generated by Dairy Milk Collection Management System', 40, y, {
      width: 320, align: 'left', lineBreak: false
    });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, 355, y, {
      width: 200, align: 'right', lineBreak: false
    });
  }
}

function pdfToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

async function sendPdf(res, doc, filename) {
  finishPdf(doc);
  const buffer = await pdfToBuffer(doc);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(buffer);
}

function pdfStartDoc(organization, title, subtitleLines) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });

  doc.font('Helvetica-Bold').fontSize(15).fillColor('#14532d')
    .text(organization.dairyName, 40, 40, { width: 340, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(8).fillColor('#6b7280')
    .text('Dairy Milk Collection Management System', 40, 62, { width: 340, lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor('#6b7280')
    .text(`Generated: ${fmtDateTime(new Date())}`, 375, 46, { width: 180, align: 'right', lineBreak: false });

  doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827')
    .text(title, 40, 88, { width: 515, lineBreak: false });
  subtitleLines.forEach((line, i) => {
    doc.font('Helvetica').fontSize(9).fillColor('#374151')
      .text(line, 40, 108 + i * 13, { width: 515, lineBreak: false });
  });

  const dividerY = 108 + subtitleLines.length * 13 + 6;
  doc.moveTo(40, dividerY).lineTo(555, dividerY).lineWidth(1).strokeColor('#d1d5db').stroke();
  doc.y = dividerY + 16;

  return doc;
}

const COLLECTION_COLUMNS = [
  { label: 'Farmer ID', w: 52 },
  { label: 'Farmer Name', w: 88 },
  { label: 'Shift', w: 48 },
  { label: 'Type', w: 42 },
  { label: 'Liters', w: 44, align: 'right' },
  { label: 'Fat %', w: 36, align: 'right' },
  { label: 'SNF %', w: 36, align: 'right' },
  { label: 'Rate', w: 44, align: 'right' },
  { label: 'Amount (Rs)', w: 64, align: 'right' }
];

function collectionRow(c) {
  return [
    c.farmerId?.farmerId || '-',
    c.farmerId?.name || '-',
    c.shift,
    c.milkType,
    fmtNumber(c.liters),
    fmtNumber(c.fat),
    fmtNumber(c.snf),
    fmtNumber(c.rate),
    fmtNumber(c.amount)
  ];
}

// ------------------------------------------------------------------ PDF routes

// GET /api/exports/pdf/daily?date=
exports.exportDailyPdf = async (req, res) => {
  try {
    const { date } = req.query;
    if (isBlank(date) || !isValidDate(date)) {
      return res.status(400).json({ message: 'A valid date is required.' });
    }

    const organization = await Organization.findById(req.user.organizationId);
    const collections = await MilkCollection.find({
      organizationId: req.user.organizationId,
      date
    }).populate('farmerId', 'farmerId name village');

    const totalLiters = roundTo2(collections.reduce((s, c) => s + c.liters, 0));
    const totalAmount = roundTo2(collections.reduce((s, c) => s + c.amount, 0));
    const avgFat = collections.length ? roundTo2(collections.reduce((s, c) => s + c.fat, 0) / collections.length) : 0;
    const avgSnf = collections.length ? roundTo2(collections.reduce((s, c) => s + c.snf, 0) / collections.length) : 0;
    const totalFarmers = new Set(collections.map((c) => String(c.farmerId?._id))).size;

    const records = collections.slice().sort((a, b) =>
      shiftOrder(a.shift) - shiftOrder(b.shift) ||
      String(a.farmerId?.farmerId || '').localeCompare(String(b.farmerId?.farmerId || '')) ||
      a.createdAt - b.createdAt
    );

    const doc = pdfStartDoc(organization, 'Daily Collection Report', [`Date: ${fmtDateDisplay(date)}`]);

    if (collections.length === 0) {
      pdfEmptyState(doc);
    } else {
      pdfSummary(doc, [
        { label: 'TOTAL FARMERS', value: String(totalFarmers) },
        { label: 'COLLECTIONS', value: String(collections.length) },
        { label: 'TOTAL LITERS', value: fmtNumber(totalLiters) },
        { label: 'AVG FAT %', value: fmtNumber(avgFat) },
        { label: 'AVG SNF %', value: fmtNumber(avgSnf) },
        { label: 'TOTAL AMOUNT', value: fmtMoney(totalAmount) }
      ]);

      pdfTable(
        doc,
        COLLECTION_COLUMNS,
        records.map(collectionRow),
        ['', 'Total', '', '', fmtNumber(totalLiters), '', '', '', fmtNumber(totalAmount)]
      );
    }

    return sendPdf(res, doc, `daily-report-${date}.pdf`);
  } catch (err) {
    console.error('exportDailyPdf error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// GET /api/exports/pdf/monthly?month=&year=
exports.exportMonthlyPdf = async (req, res) => {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ message: 'Month must be a number between 1 and 12.' });
    }
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      return res.status(400).json({ message: 'Year must be a valid year (1900-2100).' });
    }

    const pad = (n) => String(n).padStart(2, '0');
    const from = `${year}-${pad(month)}-01`;
    const to = `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;

    const organization = await Organization.findById(req.user.organizationId);
    const collections = await MilkCollection.find({
      organizationId: req.user.organizationId,
      date: { $gte: from, $lte: to }
    }).populate('farmerId', 'farmerId name village');

    const farmersMap = new Map();
    for (const c of collections) {
      const key = String(c.farmerId?._id || 'unknown');
      if (!farmersMap.has(key)) {
        farmersMap.set(key, {
          farmerId: c.farmerId?.farmerId || '-',
          name: c.farmerId?.name || '-',
          village: c.farmerId?.village || '-',
          totalLiters: 0,
          totalAmount: 0,
          collectionCount: 0
        });
      }
      const entry = farmersMap.get(key);
      entry.totalLiters += c.liters;
      entry.totalAmount += c.amount;
      entry.collectionCount += 1;
    }

    const farmers = Array.from(farmersMap.values())
      .map((f) => ({ ...f, totalLiters: roundTo2(f.totalLiters), totalAmount: roundTo2(f.totalAmount) }))
      .sort((a, b) => b.totalLiters - a.totalLiters);

    const totalLiters = roundTo2(farmers.reduce((s, f) => s + f.totalLiters, 0));
    const totalAmount = roundTo2(farmers.reduce((s, f) => s + f.totalAmount, 0));

    const doc = pdfStartDoc(organization, 'Monthly Collection Report', [
      `Month: ${MONTH_NAMES[month - 1]} ${year}  (${fmtDateDisplay(from)} to ${fmtDateDisplay(to)})`
    ]);

    if (collections.length === 0) {
      pdfEmptyState(doc);
    } else {
      pdfSummary(doc, [
        { label: 'FARMERS', value: String(farmers.length) },
        { label: 'COLLECTIONS', value: String(collections.length) },
        { label: 'TOTAL LITERS', value: fmtNumber(totalLiters) },
        { label: 'TOTAL AMOUNT', value: fmtMoney(totalAmount) }
      ]);

      pdfTable(
        doc,
        [
          { label: 'Farmer ID', w: 55 },
          { label: 'Farmer Name', w: 95 },
          { label: 'Village', w: 80 },
          { label: 'Collections', w: 55, align: 'right' },
          { label: 'Total Liters', w: 60, align: 'right' },
          { label: 'Total Amount (Rs)', w: 75, align: 'right' }
        ],
        farmers.map((f) => [
          f.farmerId, f.name, f.village, String(f.collectionCount),
          fmtNumber(f.totalLiters), fmtNumber(f.totalAmount)
        ]),
        ['', 'Total', '', String(collections.length), fmtNumber(totalLiters), fmtNumber(totalAmount)]
      );
    }

    return sendPdf(res, doc, `monthly-report-${year}-${pad(month)}.pdf`);
  } catch (err) {
    console.error('exportMonthlyPdf error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// GET /api/exports/pdf/range?from=&to=
exports.exportRangePdf = async (req, res) => {
  try {
    const { from, to } = req.query;

    if (isBlank(from) || isBlank(to) || !isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ message: 'Valid from and to dates are required.' });
    }
    if (from > to) {
      return res.status(400).json({ message: 'From date must be before or equal to the to date.' });
    }

    const organization = await Organization.findById(req.user.organizationId);
    const collections = await MilkCollection.find({
      organizationId: req.user.organizationId,
      date: { $gte: from, $lte: to }
    }).populate('farmerId', 'farmerId name village');

    const totalLiters = roundTo2(collections.reduce((s, c) => s + c.liters, 0));
    const totalAmount = roundTo2(collections.reduce((s, c) => s + c.amount, 0));
    const farmerCount = new Set(collections.map((c) => String(c.farmerId?._id))).size;

    const records = collections.slice().sort((a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
      shiftOrder(a.shift) - shiftOrder(b.shift) ||
      String(a.farmerId?.farmerId || '').localeCompare(String(b.farmerId?.farmerId || ''))
    );

    const doc = pdfStartDoc(organization, 'Collection Report - Date Range', [
      `Period: ${fmtDateDisplay(from)} to ${fmtDateDisplay(to)}`
    ]);

    if (collections.length === 0) {
      pdfEmptyState(doc);
    } else {
      pdfSummary(doc, [
        { label: 'FARMERS', value: String(farmerCount) },
        { label: 'COLLECTIONS', value: String(collections.length) },
        { label: 'TOTAL LITERS', value: fmtNumber(totalLiters) },
        { label: 'TOTAL AMOUNT', value: fmtMoney(totalAmount) }
      ]);

      const columns = [{ label: 'Date', w: 48 }, ...COLLECTION_COLUMNS];
      pdfTable(
        doc,
        columns,
        records.map((c) => [fmtDateDisplay(c.date), ...collectionRow(c)]),
        ['', '', 'Total', '', '', fmtNumber(totalLiters), '', '', '', fmtNumber(totalAmount)]
      );
    }

    return sendPdf(res, doc, `range-report-${from}-to-${to}.pdf`);
  } catch (err) {
    console.error('exportRangePdf error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// GET /api/exports/pdf/statement?farmerId=&from=&to=
exports.exportStatementPdf = async (req, res) => {
  try {
    const { farmerId, from, to } = req.query;

    if (isBlank(farmerId) || isBlank(from) || isBlank(to)) {
      return res.status(400).json({ message: 'Farmer, from date and to date are required.' });
    }
    if (!mongoose.isValidObjectId(farmerId)) {
      return res.status(400).json({ message: 'Invalid farmer ID.' });
    }
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ message: 'Valid from and to dates are required.' });
    }
    if (from > to) {
      return res.status(400).json({ message: 'From date must be before or equal to the to date.' });
    }

    const organization = await Organization.findById(req.user.organizationId);
    const farmer = await Farmer.findOne({
      _id: farmerId,
      organizationId: req.user.organizationId
    });
    if (!farmer) {
      return res.status(404).json({ message: 'Farmer not found.' });
    }

    const collections = await MilkCollection.find({
      organizationId: req.user.organizationId,
      farmerId: farmer._id,
      date: { $gte: from, $lte: to }
    }).sort({ date: 1, createdAt: 1 });

    const totalLiters = roundTo2(collections.reduce((s, c) => s + c.liters, 0));
    const totalAmount = roundTo2(collections.reduce((s, c) => s + c.amount, 0));

    const doc = pdfStartDoc(organization, 'Farmer Statement', [
      `Farmer: ${farmer.name}  (${farmer.farmerId})`,
      `Village: ${farmer.village}   |   Phone: ${farmer.phone}`,
      `Period: ${fmtDateDisplay(from)} to ${fmtDateDisplay(to)}`
    ]);

    if (collections.length === 0) {
      pdfEmptyState(doc);
    } else {
      pdfSummary(doc, [
        { label: 'COLLECTIONS', value: String(collections.length) },
        { label: 'TOTAL LITERS', value: fmtNumber(totalLiters) },
        { label: 'TOTAL AMOUNT', value: fmtMoney(totalAmount) }
      ]);

      pdfTable(
        doc,
        [
          { label: 'Date', w: 52 },
          { label: 'Shift', w: 48 },
          { label: 'Type', w: 42 },
          { label: 'Liters', w: 46, align: 'right' },
          { label: 'Fat %', w: 38, align: 'right' },
          { label: 'SNF %', w: 38, align: 'right' },
          { label: 'Rate', w: 46, align: 'right' },
          { label: 'Amount (Rs)', w: 64, align: 'right' }
        ],
        collections.map((c) => [
          fmtDateDisplay(c.date), c.shift, c.milkType,
          fmtNumber(c.liters), fmtNumber(c.fat), fmtNumber(c.snf),
          fmtNumber(c.rate), fmtNumber(c.amount)
        ]),
        ['Total', '', '', fmtNumber(totalLiters), '', '', '', fmtNumber(totalAmount)]
      );
    }

    return sendPdf(res, doc, `statement-${farmer.farmerId}-${from}-to-${to}.pdf`);
  } catch (err) {
    console.error('exportStatementPdf error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// ----------------------------------------------------------------- Excel route

// GET /api/exports/excel?from=&to=
exports.exportExcel = async (req, res) => {
  try {
    const { from, to } = req.query;

    if (isBlank(from) || isBlank(to) || !isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ message: 'Valid from and to dates are required.' });
    }
    if (from > to) {
      return res.status(400).json({ message: 'From date must be before or equal to the to date.' });
    }

    const collections = await MilkCollection.find({
      organizationId: req.user.organizationId,
      date: { $gte: from, $lte: to }
    }).populate('farmerId', 'farmerId name village');

    const totalLiters = roundTo2(collections.reduce((s, c) => s + c.liters, 0));
    const totalAmount = roundTo2(collections.reduce((s, c) => s + c.amount, 0));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Dairy Milk Collection Management System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Milk Collections');
    sheet.columns = [
      { header: 'Date', key: 'date', width: 13 },
      { header: 'Shift', key: 'shift', width: 10 },
      { header: 'Farmer ID', key: 'farmerId', width: 12 },
      { header: 'Farmer Name', key: 'farmerName', width: 22 },
      { header: 'Village', key: 'village', width: 16 },
      { header: 'Milk Type', key: 'milkType', width: 11 },
      { header: 'Liters', key: 'liters', width: 10 },
      { header: 'Fat (%)', key: 'fat', width: 9 },
      { header: 'SNF (%)', key: 'snf', width: 9 },
      { header: 'Rate (Rs/L)', key: 'rate', width: 12 },
      { header: 'Amount (Rs)', key: 'amount', width: 13 }
    ];

    collections
      .slice()
      .sort((a, b) =>
        (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
        shiftOrder(a.shift) - shiftOrder(b.shift) ||
        String(a.farmerId?.farmerId || '').localeCompare(String(b.farmerId?.farmerId || ''))
      )
      .forEach((c) => {
        const row = sheet.addRow({
          date: c.date,
          shift: c.shift,
          farmerId: c.farmerId?.farmerId || '-',
          farmerName: c.farmerId?.name || '-',
          village: c.farmerId?.village || '-',
          milkType: c.milkType,
          liters: c.liters,
          fat: c.fat,
          snf: c.snf,
          rate: c.rate,
          amount: c.amount
        });
        row.getCell('liters').numFmt = '#,##0.00';
        row.getCell('fat').numFmt = '0.00';
        row.getCell('snf').numFmt = '0.00';
        row.getCell('rate').numFmt = '#,##0.00';
        row.getCell('amount').numFmt = '#,##0.00';
      });

    const totalsRow = sheet.addRow({
      farmerName: 'Total',
      liters: totalLiters,
      amount: totalAmount
    });
    totalsRow.font = { bold: true };
    totalsRow.getCell('liters').numFmt = '#,##0.00';
    totalsRow.getCell('amount').numFmt = '#,##0.00';
    totalsRow.eachCell((cell) => {
      cell.border = { top: { style: 'double', color: { argb: 'FF14532D' } } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF5F1' } };
    });

    const headerRow = sheet.getRow(1);
    headerRow.height = 22;
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A7F4E' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Summary sheet: overall totals + farmer-wise totals.
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Farmer ID', key: 'farmerId', width: 12 },
      { header: 'Farmer Name', key: 'farmerName', width: 22 },
      { header: 'Village', key: 'village', width: 16 },
      { header: 'Collections', key: 'collectionCount', width: 12 },
      { header: 'Total Liters', key: 'totalLiters', width: 13 },
      { header: 'Total Amount (Rs)', key: 'totalAmount', width: 17 }
    ];

    const farmersMap = new Map();
    for (const c of collections) {
      const key = String(c.farmerId?._id || 'unknown');
      if (!farmersMap.has(key)) {
        farmersMap.set(key, {
          farmerId: c.farmerId?.farmerId || '-',
          farmerName: c.farmerId?.name || '-',
          village: c.farmerId?.village || '-',
          collectionCount: 0,
          totalLiters: 0,
          totalAmount: 0
        });
      }
      const entry = farmersMap.get(key);
      entry.collectionCount += 1;
      entry.totalLiters += c.liters;
      entry.totalAmount += c.amount;
    }

    Array.from(farmersMap.values())
      .sort((a, b) => b.totalLiters - a.totalLiters)
      .forEach((f) => {
        const row = summarySheet.addRow({
          ...f,
          totalLiters: roundTo2(f.totalLiters),
          totalAmount: roundTo2(f.totalAmount)
        });
        row.getCell('totalLiters').numFmt = '#,##0.00';
        row.getCell('totalAmount').numFmt = '#,##0.00';
      });

    const summaryTotals = summarySheet.addRow({
      farmerName: 'Total',
      collectionCount: collections.length,
      totalLiters,
      totalAmount
    });
    summaryTotals.font = { bold: true };
    summaryTotals.getCell('totalLiters').numFmt = '#,##0.00';
    summaryTotals.getCell('totalAmount').numFmt = '#,##0.00';
    summaryTotals.eachCell((cell) => {
      cell.border = { top: { style: 'double', color: { argb: 'FF14532D' } } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF5F1' } };
    });

    const summaryHeader = summarySheet.getRow(1);
    summaryHeader.height = 22;
    summaryHeader.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    summaryHeader.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A7F4E' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="milk-collections-${from}-to-${to}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error('exportExcel error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};
