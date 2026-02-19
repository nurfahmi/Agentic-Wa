const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create Superadmin
  const password = await bcrypt.hash('admin123', 12);
  const superadmin = await prisma.user.upsert({
    where: { email: 'admin@koperasi.gov.my' },
    update: {},
    create: {
      name: 'Super Admin',
      email: 'admin@koperasi.gov.my',
      password,
      role: 'SUPERADMIN',
      status: 'ACTIVE',
    },
  });
  console.log('✅ Superadmin created:', superadmin.email);

  // Create sample users
  const users = [
    { name: 'Ahmad Razak', email: 'ahmad@koperasi.gov.my', role: 'ADMIN' },
    { name: 'Siti Aminah', email: 'siti@koperasi.gov.my', role: 'MASTER_AGENT' },
    { name: 'Mohd Faizal', email: 'faizal@koperasi.gov.my', role: 'AGENT' },
    { name: 'Nurul Huda', email: 'nurul@koperasi.gov.my', role: 'AGENT' },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, password, status: 'ACTIVE' },
    });
  }
  console.log('✅ Sample users created');

  // Government Employers
  const employers = [
    { name: 'Jabatan Perdana Menteri', code: 'JPM', ministry: 'JPM', category: 'PERSEKUTUAN' },
    { name: 'Kementerian Kewangan', code: 'MOF', ministry: 'MOF', category: 'PERSEKUTUAN' },
    { name: 'Kementerian Pendidikan Malaysia', code: 'MOE', ministry: 'KPM', category: 'PERSEKUTUAN' },
    { name: 'Kementerian Kesihatan Malaysia', code: 'MOH', ministry: 'KKM', category: 'PERSEKUTUAN' },
    { name: 'Kementerian Dalam Negeri', code: 'MOHA', ministry: 'KDN', category: 'PERSEKUTUAN' },
    { name: 'Kementerian Pertahanan', code: 'MINDEF', ministry: 'MINDEF', category: 'PERSEKUTUAN' },
    { name: 'Polis Diraja Malaysia', code: 'PDRM', ministry: 'KDN', category: 'PERSEKUTUAN' },
    { name: 'Angkatan Tentera Malaysia', code: 'ATM', ministry: 'MINDEF', category: 'PERSEKUTUAN' },
    { name: 'Jabatan Kastam Diraja Malaysia', code: 'JKDM', ministry: 'MOF', category: 'PERSEKUTUAN' },
    { name: 'Jabatan Imigresen Malaysia', code: 'JIM', ministry: 'KDN', category: 'PERSEKUTUAN' },
    { name: 'Suruhanjaya Perkhidmatan Awam', code: 'SPA', ministry: 'JPA', category: 'PERSEKUTUAN' },
    { name: 'Jabatan Perkhidmatan Awam', code: 'JPA', ministry: 'JPA', category: 'PERSEKUTUAN' },
    { name: 'Kerajaan Negeri Selangor', code: 'SEL', ministry: null, category: 'NEGERI' },
    { name: 'Kerajaan Negeri Johor', code: 'JHR', ministry: null, category: 'NEGERI' },
    { name: 'Dewan Bandaraya Kuala Lumpur', code: 'DBKL', ministry: null, category: 'PBT' },
  ];
  for (const emp of employers) {
    await prisma.governmentEmployer.upsert({
      where: { code: emp.code },
      update: {},
      create: { ...emp, isApproved: true },
    });
  }
  console.log('✅ Government employers seeded:', employers.length);

  // Koperasi Rules
  const rules = [
    { ruleKey: 'min_salary', ruleValue: '1800', label: 'Gaji Minimum (RM)' },
    { ruleKey: 'max_age', ruleValue: '58', label: 'Umur Maksimum' },
    { ruleKey: 'must_be_penjawat_awam', ruleValue: 'true', label: 'Mesti Penjawat Awam' },
    { ruleKey: 'max_financing_amount', ruleValue: '200000', label: 'Jumlah Pembiayaan Maksimum (RM)' },
    { ruleKey: 'min_service_years', ruleValue: '1', label: 'Tahun Perkhidmatan Minimum' },
  ];
  for (const r of rules) {
    await prisma.koperasiRule.upsert({
      where: { ruleKey: r.ruleKey },
      update: {},
      create: { ...r, isActive: true },
    });
  }
  console.log('✅ Koperasi rules seeded');

  // Knowledge Base Entries
  const kbEntries = [
    {
      category: 'FAQ',
      title: 'Apakah syarat kelayakan pembiayaan?',
      content: 'Untuk layak memohon pembiayaan koperasi, anda mesti memenuhi syarat berikut: 1) Penjawat Awam yang disahkan dalam jawatan, 2) Gaji bulanan minimum RM1,800, 3) Umur di bawah 58 tahun, 4) Tidak disenarai hitam oleh mana-mana institusi kewangan. Kelulusan tertakluk kepada semakan lanjut oleh pegawai kami.',
    },
    {
      category: 'DOCUMENTS',
      title: 'Dokumen yang diperlukan',
      content: 'Dokumen yang perlu disediakan: 1) Slip gaji terkini (3 bulan terkini), 2) Surat pengesahan jawatan/employment letter, 3) Salinan kad pengenalan (IC), 4) Penyata bank 3 bulan terkini. Semua dokumen boleh dihantar melalui WhatsApp dalam format gambar atau PDF.',
    },
    {
      category: 'RULES',
      title: 'Kadar pembiayaan',
      content: 'Kadar keuntungan pembiayaan koperasi adalah antara 3.5% hingga 6.5% setahun bergantung kepada jumlah dan tempoh pembiayaan. Tempoh pembiayaan antara 1 hingga 10 tahun. Jumlah pembiayaan minimum RM5,000 dan maksimum RM200,000. Bayaran bulanan akan ditolak terus dari gaji.',
    },
    {
      category: 'FAQ',
      title: 'Berapa lama proses kelulusan?',
      content: 'Proses kelulusan biasanya mengambil masa 3-5 hari bekerja selepas semua dokumen lengkap diterima. Anda akan dimaklumkan melalui WhatsApp mengenai status permohonan anda. Untuk sebarang pertanyaan lanjut, pegawai kami sedia membantu.',
    },
    {
      category: 'SOP',
      title: 'SOP Eskalasi ke Pegawai',
      content: 'Eskalasi kepada pegawai dilakukan apabila: 1) AI tidak dapat mengesahkan maklumat pelanggan, 2) Pelanggan meminta untuk bercakap dengan pegawai, 3) Kes kelayakan sempadan (borderline), 4) Dokumen tidak dapat dibaca oleh OCR, 5) Pelanggan menunjukkan ketidakpuasan hati. Pegawai akan mengambil alih dalam masa 15 minit waktu operasi.',
    },
  ];
  for (const entry of kbEntries) {
    const existing = await prisma.knowledgeBase.findFirst({ where: { title: entry.title } });
    if (!existing) {
      await prisma.knowledgeBase.create({ data: { ...entry, isActive: true } });
    }
  }
  console.log('✅ Knowledge base entries seeded');

  // Site Settings
  const defaultSettings = [
    { key: 'site_name', value: 'Koperasi AI' },
    { key: 'default_theme', value: 'light' },
    { key: 'waba_verify_token', value: 'koperasi-verify-token' },
  ];
  for (const s of defaultSettings) {
    await prisma.siteSetting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
  }
  console.log('✅ Site settings seeded');

  console.log('\n🎉 Seed complete!');
  console.log('📧 Login: admin@koperasi.gov.my');
  console.log('🔑 Password: admin123');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
