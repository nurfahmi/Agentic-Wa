const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * Parent agency code mapping based on name patterns.
 */
const CODE_PATTERNS = [
  { patterns: ['REJIMEN', 'TENTERA', 'ARMOR', 'ARTILERI', 'BRIGED', 'BATALION', 'WOKSYOP', 'WKSP', 'WOKSHO', 'MARKAS', 'PLATUN', 'ORDNAN', 'KOR RISIK', 'ANGKATAN TENTERA', 'RAMD', 'RAND', 'RENJER', 'SKUADRON', 'MEKANISE', 'KOMPENI BEK', 'GERAK KHAS', 'PASUKAN KHAS', 'KEM TERENDAK', 'KEM SG BESI', 'KEM MAHKOTA', 'KEM BENTONG', 'KEM LIPIS', 'BN PERUBATAN', 'BN KP DIRAJA'], code: 'ATM', parent: 'Angkatan Tentera Malaysia' },
  { patterns: ['BALAI POLIS', 'POLIS DIRAJA', 'IPD ', 'IPK ', 'ISNKRI', 'PULAPOL', 'BUKIT AMAN', 'KONTINJEN', 'BAHAGIAN LATIHAN (IBU PEJABAT) PDRM', 'BAHAGIAN PENTADBIRAN PDRM', 'BAHAGIAN PERKHIDMATAN', 'BAHAGIAN URUSETIA KPN', 'JABATAN SIASATAN JENAYAH', 'JABATAN SIASATAN PERISIKAN', 'JABATAN KESELAMATAN DALAM NEGERI', 'JABATAN LOGISTIK', 'JABATAN SIASATAN NARKOTIK', 'JABATAN PENCEGAHAN', 'JABATAN PENGURUSAN PDRM', 'JABATAN POLIS BANTUAN', 'POLIS MARIN', 'POLIS PELABUHAN', 'MAKTAB POLIS', 'PASUKAN GERAKAN AM', 'UNIT BERSAMA POLIS'], code: 'PDRM', parent: 'Polis Diraja Malaysia' },
  { patterns: ['BOMBA', 'PENYELAMAT'], code: 'JBPM', parent: 'Jabatan Bomba dan Penyelamat Malaysia' },
  { patterns: ['HOSPITAL', 'KLINIK KESIHATAN', 'INSTITUT KESIHATAN', 'JABATAN KESIHATAN', 'PEJABAT KESIHATAN', 'MAKMAL KESIHATAN'], code: 'KKM', parent: 'Kementerian Kesihatan Malaysia' },
  { patterns: ['JABATAN PENDIDIKAN', 'PEJABAT PENDIDIKAN', 'SEKOLAH MENENGAH', 'SEKOLAH KEBANGSAAN', 'SK ', 'SMK ', 'MRSM', 'KOLEJ MATRIKULASI', 'POLITEKNIK', 'INSTITUT PENDIDIKAN GURU'], code: 'KPM', parent: 'Kementerian Pendidikan Malaysia' },
  { patterns: ['UNIVERSITI'], code: 'KPT', parent: 'Kementerian Pengajian Tinggi' },
  { patterns: ['AGENSI ANTIDADAH', 'AADK'], code: 'AADK', parent: 'Agensi Antidadah Kebangsaan' },
  { patterns: ['MARITIM', 'APMM', 'ZON MARITIM'], code: 'APMM', parent: 'Agensi Penguatkuasaan Maritim Malaysia' },
  { patterns: ['MAHKAMAH'], code: 'JKSM', parent: 'Jabatan Kehakiman Syariah Malaysia' },
  { patterns: ['IMIGRESEN'], code: 'JIM', parent: 'Jabatan Imigresen Malaysia' },
  { patterns: ['KASTAM'], code: 'JKDM', parent: 'Jabatan Kastam Diraja Malaysia' },
  { patterns: ['PENJARA'], code: 'JPM-PENJARA', parent: 'Jabatan Penjara Malaysia' },
  { patterns: ['PERTAHANAN AWAM'], code: 'JPAM', parent: 'Jabatan Pertahanan Awam Malaysia' },
  { patterns: ['AUDIT'], code: 'JAN', parent: 'Jabatan Audit Negara' },
  { patterns: ['KERJA RAYA'], code: 'JKR', parent: 'Jabatan Kerja Raya' },
  { patterns: ['PENGAIRAN', 'SALIRAN'], code: 'JPS', parent: 'Jabatan Pengairan dan Saliran' },
  { patterns: ['PERHUTANAN'], code: 'JPSM', parent: 'Jabatan Perhutanan' },
  { patterns: ['KEBAJIKAN MASYARAKAT'], code: 'JKM', parent: 'Jabatan Kebajikan Masyarakat' },
  { patterns: ['TENAGA KERJA', 'TENAGA MANUSIA', 'TENAGA RAKYAT', 'ADTEC', 'ILP '], code: 'JTM', parent: 'Jabatan Tenaga Manusia' },
  { patterns: ['JAKIM', 'HAL EHWAL ISLAM', 'AGAMA ISLAM'], code: 'JAKIM', parent: 'Jabatan Kemajuan Islam Malaysia' },
  { patterns: ['SPRM', 'RASUAH', 'PENCEGAH RASUAH'], code: 'SPRM', parent: 'Suruhanjaya Pencegahan Rasuah Malaysia' },
  { patterns: ['HASIL DALAM NEGERI', 'LHDN'], code: 'LHDN', parent: 'Lembaga Hasil Dalam Negeri' },
  { patterns: ['PENGANGKUTAN JALAN', 'JPJ'], code: 'JPJ', parent: 'Jabatan Pengangkutan Jalan' },
  { patterns: ['PENDAFTARAN NEGARA', 'JPN '], code: 'JPN', parent: 'Jabatan Pendaftaran Negara' },
  { patterns: ['VETERINAR', 'PERKHIDMATAN HAIWAN'], code: 'DVS', parent: 'Jabatan Perkhidmatan Veterinar' },
  { patterns: ['PERTANIAN'], code: 'DOA', parent: 'Jabatan Pertanian' },
  { patterns: ['PERIKANAN'], code: 'DOF', parent: 'Jabatan Perikanan' },
  { patterns: ['METEOROLOGI', 'KAJI CUACA'], code: 'MET', parent: 'Jabatan Meteorologi Malaysia' },
  { patterns: ['UKUR DAN PEMETAAN'], code: 'JUPEM', parent: 'Jabatan Ukur dan Pemetaan' },
  { patterns: ['TANAH DAN GALIAN', 'MINERAL DAN GEOSAINS'], code: 'JMG', parent: 'Jabatan Mineral dan Geosains' },
  { patterns: ['NUKLEAR'], code: 'AELB', parent: 'Agensi Nuklear Malaysia' },
  { patterns: ['ANGKASA'], code: 'MYSA', parent: 'Agensi Angkasa Malaysia' },
  { patterns: ['FELDA'], code: 'FELDA', parent: 'Lembaga Kemajuan Tanah Persekutuan' },
  { patterns: ['DEWAN BANDARAYA', 'DBKL'], code: 'DBKL', parent: 'Dewan Bandaraya Kuala Lumpur' },
  { patterns: ['MAJLIS BANDARAYA', 'MAJLIS PERBANDARAN', 'MAJLIS DAERAH'], code: 'PBT', parent: 'Pihak Berkuasa Tempatan' },
  { patterns: ['SETIAUSAHA KERAJAAN', 'PEJABAT SETIAUSAHA', 'SUK '], code: 'SUK', parent: 'Pejabat Setiausaha Kerajaan Negeri' },
  { patterns: ['PEJABAT DAERAH'], code: 'PDT', parent: 'Pejabat Daerah dan Tanah' },
  { patterns: ['TENAGA NASIONAL', 'TNB'], code: 'TNB', parent: 'Tenaga Nasional Berhad' },
];

function detectCode(name) {
  const upper = name.toUpperCase();
  for (const mapping of CODE_PATTERNS) {
    for (const pat of mapping.patterns) {
      if (upper.includes(pat)) {
        return { code: mapping.code, parent: mapping.parent };
      }
    }
  }
  return { code: null, parent: null };
}

/**
 * Parse PDF and extract employer entries using pdfjs-dist
 */
async function parsePdf(buffer) {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  const uint8 = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data: uint8 }).promise;
  
  let fullText = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }

  const lines = fullText.split('\n');
  const entries = [];
  const re = /\d+\s*(.+?)\s+(AG|GLC|PDRM|BA|BN|PBT|SA|STATE)\s+(\d+)%/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let match;
    while ((match = re.exec(trimmed)) !== null) {
      let name = match[1].trim();
      // Strip leading row number (e.g. "1 ARMOR" -> "ARMOR")
      name = name.replace(/^\d+\s*/, '');
      const sector = match[2];
      const deduction = parseInt(match[3]);
      if (name.length > 2 && name.length <= 191) {
        entries.push({ name, sector, deduction });
      }
    }
    re.lastIndex = 0;
  }

  const seen = new Set();
  return entries.filter(e => {
    if (seen.has(e.name)) return false;
    seen.add(e.name);
    return true;
  });
}

/**
 * Import parsed entries into database
 */
async function importEntries(entries, isApproved = true) {
  let inserted = 0, skipped = 0;

  for (const entry of entries) {
    try {
      const existing = await prisma.governmentEmployer.findFirst({ where: { name: entry.name } });
      if (existing) { skipped++; continue; }

      const { code, parent } = detectCode(entry.name);

      await prisma.governmentEmployer.create({
        data: {
          name: entry.name,
          code: code,
          sector: entry.sector,
          deduction: entry.deduction,
          category: entry.sector === 'PDRM' ? 'PDRM' : 'PERSEKUTUAN',
          ministry: parent,
          isApproved,
        },
      });
      inserted++;
    } catch (err) {
      if (err.code === 'P2002') { skipped++; continue; }
      logger.error(`Import employer error for ${entry.name}:`, err.message);
      skipped++;
    }
  }

  return { total: entries.length, inserted, skipped };
}

module.exports = { parsePdf, importEntries, detectCode, CODE_PATTERNS };
