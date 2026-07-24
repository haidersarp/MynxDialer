const fs   = require('fs');
const { parse }   = require('csv-parse');
const { getPool } = require('../db/connection');

const SYSTEM_FIELDS = {
  phone:      { label: 'Phone Number *',  aliases: ['phone','telephone','number','phone_number','mobile','cell','tel','telno','contactnumber'] },
  first_name: { label: 'First Name',      aliases: ['first_name','firstname','first','fname','forename','forenames','givenname'] },
  last_name:  { label: 'Last Name',       aliases: ['last_name','lastname','last','lname','surname','familyname'] },
  email:      { label: 'Email',           aliases: ['email','email_address','e_mail','emailaddress'] },
  address:    { label: 'Address',         aliases: ['address','addr','street','address1','addr1','addressline1','add1'] },
  city:       { label: 'City',            aliases: ['city','town','posttown','town_city'] },
  state:      { label: 'State',           aliases: ['state','province','county','postcounty'] },
  zip:        { label: 'Zip/Postal',      aliases: ['zip','zip_code','postal','postcode','post_code'] },
  alt_phone:  { label: 'Alt Phone',       aliases: ['alt_phone','alt_number','phone2','mobile2'] },
  dob:        { label: 'Date of Birth',   aliases: ['dob','date_of_birth','birth_date','birthdate'] },
  title:      { label: 'Title',           aliases: ['title','salutation','prefix'] },
};

// Excel (.xlsx/.xls) support. Multer strips the extension, so detect by magic
// bytes (XLSX = ZIP 'PK\x03\x04', XLS = OLE 'D0CF11E0'). If it's Excel, convert
// the first worksheet to a temp CSV and parse THAT — so the whole existing CSV
// pipeline (mapping, dedup, DNC, import) is reused unchanged. CSV/TXT pass through
// untouched. On any conversion failure we fall back to the original path (the CSV
// parser then surfaces a clean "failed to parse").
function toCsvPathIfExcel(filePath) {
  try {
    const fd  = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    const isExcel = (buf[0] === 0x50 && buf[1] === 0x4B) ||  // PK.. (xlsx/zip)
                    (buf[0] === 0xD0 && buf[1] === 0xCF);     // OLE  (xls)
    if (!isExcel) return filePath;
    const XLSX = require('xlsx');
    const wb   = XLSX.readFile(filePath);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const csv  = XLSX.utils.sheet_to_csv(ws);
    const csvPath = filePath + '.conv.csv';
    fs.writeFileSync(csvPath, csv);
    return csvPath;
  } catch (_) {
    return filePath;
  }
}

function autoDetect(headers) {
  const mapping = {};
  for (const [field, { aliases }] of Object.entries(SYSTEM_FIELDS)) {
    const found = headers.find(h =>
      aliases.some(a => h.toLowerCase().replace(/[\s_\-\.]/g,'') === a.replace(/[\s_\-]/g,''))
    );
    if (found) mapping[found] = field;
  }
  return mapping; // { csvCol: systemField }
}

// Parse headers + first 5 rows — used by the mapping wizard
async function parseHeaders(filePath) {
  const parsePath = toCsvPathIfExcel(filePath);
  return new Promise((resolve, reject) => {
    const rows = [];
    const parser = parse({ columns: true, skip_empty_lines: true, trim: true, to: 6,
      relax_column_count: true, bom: true, relax_quotes: true });
    parser.on('readable', function () {
      let r;
      while ((r = this.read()) !== null) rows.push(r);
    });
    parser.on('error', reject);
    parser.on('end', () => {
      if (parsePath !== filePath) { try { fs.unlinkSync(parsePath); } catch (_) {} }
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const detected = autoDetect(headers);
      resolve({ headers, preview: rows.slice(0, 5), detected_mapping: detected });
    });
    fs.createReadStream(parsePath).pipe(parser);
  });
}

// Full import with mapping + list_id
async function importCSV(filePath, campaignId, listId, columnMapping, options = {}) {
  const pool = getPool();
  const allowDuplicates = !!(options && options.allowDuplicates);
  const parsePath = toCsvPathIfExcel(filePath);

  return new Promise((resolve, reject) => {
    const rows = [];
    const parser = parse({ columns: true, skip_empty_lines: true, trim: true,
      relax_column_count: true, bom: true, relax_quotes: true });
    parser.on('readable', function () { let r; while ((r = this.read()) !== null) rows.push(r); });
    parser.on('error', reject);
    parser.on('end', async () => {
      try { fs.unlinkSync(filePath); } catch (_) {}
      if (parsePath !== filePath) { try { fs.unlinkSync(parsePath); } catch (_) {} }

      // columnMapping = { csvCol: systemField } e.g. { "Phone": "phone", "FName": "first_name" }
      // Auto-detect if not provided
      if (!columnMapping && rows.length) {
        columnMapping = autoDetect(Object.keys(rows[0]));
      }

      const revMap = {}; // systemField → csvCol
      if (columnMapping) {
        for (const [csv, sys] of Object.entries(columnMapping)) {
          revMap[sys] = csv;
        }
      }

      if (!revMap.phone) {
        return reject(new Error('No phone column mapped. Please map a column to Phone Number.'));
      }

      // Load existing phones + DNC
      const existingRows = await pool.execute('SELECT phone FROM leads WHERE campaign_id = ?', [campaignId]);
      const existing = new Set(existingRows[0].map(r => r.phone));
      const dncRows  = await pool.execute('SELECT phone FROM dnc_list WHERE account_id = (SELECT account_id FROM campaigns WHERE id = ?)', [campaignId]);
      const dnc      = new Set(dncRows[0].map(r => r.phone));

      let imported = 0, skipped = 0, duplicates = 0, dnc_skipped = 0;
      const validRows = [];

      for (const row of rows) {
        const raw   = revMap.phone ? row[revMap.phone] : null;
        const phone = raw ? String(raw).replace(/\D/g,'') : null;
        if (!phone || phone.length < 7)     { skipped++;    continue; }
        if (dnc.has(phone))                  { dnc_skipped++; continue; }
        if (existing.has(phone))             { duplicates++; if (!allowDuplicates) continue; }

        // Custom fields = any CSV column NOT mapped to a system field
        const mappedCsvCols = new Set(Object.keys(columnMapping || {}));
        const custom = {};
        for (const [col, val] of Object.entries(row)) {
          if (!mappedCsvCols.has(col) && val) custom[col] = val;
        }

        validRows.push([
          campaignId,
          listId || null,
          phone,
          revMap.first_name  ? (row[revMap.first_name]  || null) : null,
          revMap.last_name   ? (row[revMap.last_name]   || null) : null,
          revMap.email       ? (row[revMap.email]       || null) : null,
          revMap.address     ? (row[revMap.address]     || null) : null,
          revMap.city        ? (row[revMap.city]        || null) : null,
          revMap.state       ? (row[revMap.state]       || null) : null,
          revMap.zip         ? (row[revMap.zip]         || null) : null,
          Object.keys(custom).length ? JSON.stringify(custom) : null,
        ]);
        existing.add(phone);
      }

      const BATCH = 500;
      for (let i = 0; i < validRows.length; i += BATCH) {
        const batch = validRows.slice(i, i + BATCH);
        const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',');
        try {
          await pool.execute(
            `INSERT INTO leads (campaign_id, list_id, phone, first_name, last_name, email, address, city, state, zip, custom_fields) VALUES ${placeholders}`,
            batch.flat()
          );
          imported += batch.length;
        } catch (err) {
          console.error('[Import] Batch error:', err.message);
          skipped += batch.length;
        }
      }

      // Update list stats
      if (listId) {
        await pool.execute(
          'UPDATE lead_lists SET imported_count = ?, total_rows = ?, duplicate_count = ?, skipped_count = ? WHERE id = ?',
          [imported, rows.length, duplicates, skipped + dnc_skipped, listId]
        );
      }

      resolve({ imported, skipped, duplicates, dnc_skipped, total: rows.length, allowDuplicates });
    });
    fs.createReadStream(parsePath).pipe(parser);
  });
}

module.exports = { importCSV, parseHeaders, SYSTEM_FIELDS, autoDetect };