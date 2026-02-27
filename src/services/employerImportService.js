const pdf = require('pdf-parse');
const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * Parent agency code mapping based on name patterns.
 * Pattern → { code, parentAgency }
 */
const CODE_PATTERNS = [
  // Military
  { patterns: ['REJIMEN', 'TENTERA', 'ARMOR', 'ARTILERI', 'BRIGED', 'BATALION', 'WOKSYOP', 'WKSP', 'WOKSHO', 'MARKAS', 'PLATUN', 'ORDNAN', 'KOR RISIK', 'ANGKATAN TENTERA', 'RAMD', 'RAND', 'RENJER', 'SKUADRON', 'MEKANISE', 'KOMPENI BEK', 'GERAK KHAS', 'PASUKAN KHAS', 'KEM TERENDAK', 'KEM SG BESI', 'KEM MAHKOTA', 'KEM BENTONG', 'KEM LIPIS', 'BN PERUBATAN', 'BN KP DIRAJA'], code: 'ATM', parent: 'Angkatan Tentera Malaysia' },
  // Police
  { patterns: ['BALAI POLIS', 'POLIS DIRAJA', 'IPD ', 'IPK ', 'ISNKRI', 'PULAPOL', 'BUKIT AMAN', 'KONTINJEN', 'BAHAGIAN LATIHAN (IBU PEJABAT) PDRM', 'BAHAGIAN PENTADBIRAN PDRM', 'BAHAGIAN PERKHIDMATAN', 'BAHAGIAN URUSETIA KPN', 'JABATAN SIASATAN JENAYAH', 'JABATAN SIASATAN PERISIKAN', 'JABATAN KESELAMATAN DALAM NEGERI', 'JABATAN LOGISTIK', 'JABATAN SIASATAN NARKOTIK', 'JABATAN PENCEGAHAN', 'JABATAN PENGURUSAN PDRM', 'JABATAN POLIS BANTUAN', 'POLIS MARIN', 'POLIS PELABUHAN', 'MAKTAB POLIS', 'PASUKAN GERAKAN AM', 'UNIT BERSAMA POLIS'], code: 'PDRM', parent: 'Polis Diraja Malaysia' },
  // Fire & Rescue
  { patterns: ['BOMBA', 'PENYELAMAT'], code: 'JBPM', parent: 'Jabatan Bomba dan Penyelamat Malaysia' },
  // Health
  { patterns: ['HOSPITAL', 'KLINIK KESIHATAN', 'INSTITUT KESIHATAN', 'JABATAN KESIHATAN', 'PEJABAT KESIHATAN', 'MAKMAL KESIHATAN'], code: 'KKM', parent: 'Kementerian Kesihatan Malaysia' },
  // Education
  { patterns: ['JABATAN PENDIDIKAN', 'PEJABAT PENDIDIKAN', 'SEKOLAH MENENGAH', 'SEKOLAH KEBANGSAAN', 'SK ', 'SMK ', 'MRSM', 'KOLEJ MATRIKULASI', 'POLITEKNIK', 'INSTITUT PENDIDIKAN GURU'], code: 'KPM', parent: 'Kementerian Pendidikan Malaysia' },
  // Universities
  { patterns: ['UNIVERSITI'], code: 'KPT', parent: 'Kementerian Pengajian Tinggi' },
  // Anti-Drug
  { patterns: ['AGENSI ANTIDADAH', 'AADK'], code: 'AADK', parent: 'Agensi Antidadah Kebangsaan' },
  // Maritime
  { patterns: ['MARITIM', 'APMM', 'ZON MARITIM'], code: 'APMM', parent: 'Agensi Penguatkuasaan Maritim Malaysia' },
  // Courts / Judiciary
  { patterns: ['MAHKAMAH'], code: 'JKSM', parent: 'Jabatan Kehakiman Syariah Malaysia' },
  // Immigration
  { patterns: ['IMIGRESEN'], code: 'JIM', parent: 'Jabatan Imigresen Malaysia' },
  // Customs
  { patterns: ['KASTAM'], code: 'JKDM', parent: 'Jabatan Kastam Diraja Malaysia' },
  // Prison
  { patterns: ['PENJARA'], code: 'JPM-PENJARA', parent: 'Jabatan Penjara Malaysia' },
  // Civil Defence
  { patterns: ['PERTAHANAN AWAM'], code: 'JPAM', parent: 'Jabatan Pertahanan Awam Malaysia' },
  // Audit
  { patterns: ['AUDIT'], code: 'JAN', parent: 'Jabatan Audit Negara' },
  // Public Works
  { patterns: ['KERJA RAYA'], code: 'JKR', parent: 'Jabatan Kerja Raya' },
  // Irrigation & Drainage
  { patterns: ['PENGAIRAN', 'SALIRAN'], code: 'JPS', parent: 'Jabatan Pengairan dan Saliran' },
  // Forestry
  { patterns: ['PERHUTANAN'], code: 'JPSM', parent: 'Jabatan Perhutanan' },
  //Welfare
  { patterns: ['KEBAJIKAN MASYARAKAT'], code: 'JKM', parent: 'Jabatan Kebajikan Masyarakat' },
  // Labour
  { patterns: ['TENAGA KERJA', 'TENAGA MANUSIA', 'TENAGA RAKYAT', 'ADTEC', 'ILP '], code: 'JTM', parent: 'Jabatan Tenaga Manusia' },
  // JAKIM
  { patterns: ['JAKIM', 'HAL EHWAL ISLAM', 'AGAMA ISLAM'], code: 'JAKIM', parent: 'Jabatan Kemajuan Islam Malaysia' },
  // MACC
  { patterns: ['SPRM', 'RASUAH', 'PENCEGAH RASUAH'], code: 'SPRM', parent: 'Suruhanjaya Pencegahan Rasuah Malaysia' },
  // LHDN
  { patterns: ['HASIL DALAM NEGERI', 'LHDN'], code: 'LHDN', parent: 'Lembaga Hasil Dalam Negeri' },
  // Road Transport
  { patterns: ['PENGANGKUTAN JALAN', 'JPJ'], code: 'JPJ', parent: 'Jabatan Pengangkutan Jalan' },
  // Registration
  { patterns: ['PENDAFTARAN NEGARA', 'JPN '], code: 'JPN', parent: 'Jabatan Pendaftaran Negara' },
  // Veterinary
  { patterns: ['VETERINAR', 'PERKHIDMATAN HAIWAN'], code: 'DVS', parent: 'Jabatan Perkhidmatan Veterinar' },
  // Agriculture
  { patterns: ['PERTANIAN'], code: 'DOA', parent: 'Jabatan Pertanian' },
  // Fisheries
  { patterns: ['PERIKANAN'], code: 'DOF', parent: 'Jabatan Perikanan' },
  // Meteorology
  { patterns: ['METEOROLOGI', 'KAJI CUACA'], code: 'MET', parent: 'Jabatan Meteorologi Malaysia' },
  // Survey / Mapping
  { patterns: ['UKUR DAN PEMETAAN'], code: 'JUPEM', parent: 'Jabatan Ukur dan Pemetaan' },
  // Land & Mines
  { patterns: ['TANAH DAN GALIAN', 'MINERAL DAN GEOSAINS'], code: 'JMG', parent: 'Jabatan Mineral dan Geosains' },
  // Nuclear
  { patterns: ['NUKLEAR'], code: 'AELB', parent: 'Agensi Nuklear Malaysia' },
  // Space Agency
  { patterns: ['ANGKASA'], code: 'MYSA', parent: 'Agensi Angkasa Malaysia' },
  // FELDA
  { patterns: ['FELDA'], code: 'FELDA', parent: 'Lembaga Kemajuan Tanah Persekutuan' },
  // DBKL
  { patterns: ['DEWAN BANDARAYA', 'DBKL'], code: 'DBKL', parent: 'Dewan Bandaraya Kuala Lumpur' },
  // Local Councils (PBT)
  { patterns: ['MAJLIS BANDARAYA', 'MAJLIS PERBANDARAN', 'MAJLIS DAERAH'], code: 'PBT', parent: 'Pihak Berkuasa Tempatan' },
  // State Secretary
  { patterns: ['SETIAUSAHA KERAJAAN', 'PEJABAT SETIAUSAHA', 'SUK '], code: 'SUK', parent: 'Pejabat Setiausaha Kerajaan Negeri' },
  // District Office
  { patterns: ['PEJABAT DAERAH'], code: 'PDT', parent: 'Pejabat Daerah dan Tanah' },
  // TNB
  { patterns: ['TENAGA NASIONAL', 'TNB'], code: 'TNB', parent: 'Tenaga Nasional Berhad' },
];

/**
 * Auto-detect parent agency code from employer name
 */
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
 * Parse PDF and extract employer entries
 * Format: NUMBER NAME SECTOR DEDUCTION%
 */
async function parsePdf(buffer) {
  const data = await pdf(buffer);
  const lines = data.text.split('\n');
  const entries = [];
  const re = /^\d*\s*(.+?)\s+(AG|GLC|PDRM|BA|BN|PBT|SA|STATE)\s+(\d+)%/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(re);
    if (match) {
      const name = match[1].trim();
      const sector = match[2];
      const deduction = parseInt(match[3]);
      if (name.length > 2) {
        entries.push({ name, sector, deduction });
      }
    }
  }

  // Deduplicate by name
  const seen = new Set();
  return entries.filter(e => {
    if (seen.has(e.name)) return false;
    seen.add(e.name);
    return true;
  });
}

/**
 * Import parsed entries into database
 * @param {Array} entries - parsed entries from PDF
 * @param {boolean} isApproved - true for eligible, false for not eligible
 * @returns {object} { total, inserted, skipped }
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
