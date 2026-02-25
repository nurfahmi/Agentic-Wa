const prisma = require('../config/database');

let cache = { data: null, ts: 0 };
const CACHE_TTL = 60000; // 60 seconds

const DEFAULTS = {
  ai_agent_name: 'Puan Sarah',
  ai_koperasi_name: 'Koperasi Muhibbah Alliance',
  ai_greeting_message: 'Salam Tuan/Puan, boleh saya tahu Tuan/Puan bekerja di bawah kementerian mana?\n\nUntuk makluman, pinjaman peribadi I-Syariah ini khas untuk Anggota Kerajaan sahaja. 😊',
  ai_eligible_message: 'Baik, adakah tuan/puan berminat buat semakan kelayakan? Jika YE, boleh whatsapp gaji slip terkini anda utk semak kelayakan ye😁',
  ai_not_eligible_message: 'Maaf tuan/puan, {reason}. Terima kasih🧕',
  ai_escalation_message: 'Baik, pegawai kami akan hubungi tuan/puan untuk bantuan lanjut. Terima kasih🧕',
  ai_slip_received_message: 'Terima kasih, slip gaji telah diterima. Pegawai kami akan hubungi tuan/puan untuk semakan kelayakan. Terima kasih 🧕',
  ai_product_info: 'Pinjaman Peribadi I-Syariah untuk Anggota Kerajaan (Penjawat Awam) sahaja. Syarat: Mesti penjawat awam, gaji minimum RM1,800, umur bawah 58 tahun, potongan gaji tidak melebihi 60%. Koperasi Muhibbah Alliance bekerjasama dengan Koperasi Kopunas Kuwait Finance House, Yayasan Ihsan Rakyat Ambank, Ukhwah Maybank, Bank Rakyat dan Yayasan Teguh Iman. Ibu pejabat di KL.',
  ai_custom_instructions: 'Balas dengan ringkas dan mesra. Guna bahasa santai seperti admin biasa. Boleh guna emoji 🧕😁. Jangan tulis ayat panjang. Satu hingga dua ayat sahaja setiap mesej.',
  ai_escalation_triggers: 'slip_received,pre_eligible,user_request_human,angry_keywords,follow_up',
  ai_silence_hours: '24',
  ai_bad_words: 'scam,scammer,tipu,penipuan,bodoh,stupid,babi,sial',
};

async function getAiSettings() {
  if (Date.now() - cache.ts < CACHE_TTL && cache.data) {
    return cache.data;
  }

  try {
    const keys = Object.keys(DEFAULTS);
    const rows = await prisma.siteSetting.findMany({
      where: { key: { in: keys } },
    });

    const dbMap = {};
    rows.forEach((r) => (dbMap[r.key] = r.value));

    // Merge: DB values override defaults, empty strings fall back to defaults
    const data = {};
    for (const key of keys) {
      data[key] = (dbMap[key] && dbMap[key].trim()) || DEFAULTS[key];
    }

    cache = { data, ts: Date.now() };
    return data;
  } catch {
    return { ...DEFAULTS };
  }
}

function clearCache() {
  cache = { data: null, ts: 0 };
}

module.exports = { getAiSettings, clearCache, DEFAULTS };
