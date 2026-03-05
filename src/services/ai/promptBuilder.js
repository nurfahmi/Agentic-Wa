const { getAiSettings } = require('../../utils/getAiSettings');
const prisma = require('../../config/database');

const CATEGORY_TO_STAGE = {
  'greeting': 'greeting',
  'scam_defense': 'scam_defense',
  'eligibility_ask': 'employer_verify',
  'employer_check': 'employer_verify',
  'eligible': 'eligibility',
  'not_eligible': 'eligibility',
  'product_info': 'product_info',
  'escalation': 'escalation',
  'follow_up': 'follow_up',
  'staff_verify': 'staff_verify',
  'general': 'general',
};

/**
 * Stage-aware example selection.
 * 1. Always include priority >= 8 (critical examples)
 * 2. Match by conversation stage
 * 3. Group multi-turn flows together
 * 4. Separate negative examples
 * 5. Fallback to keyword-scored examples
 */
async function getRelevantExamples(userMessage, conversationStage) {
  const allExamples = await prisma.chatExample.findMany({
    where: { active: true },
    orderBy: [{ priority: 'desc' }, { turnOrder: 'asc' }, { createdAt: 'desc' }],
  });

  if (!allExamples.length) return '';

  const lower = userMessage.toLowerCase();
  const selected = [];
  const negative = [];
  const includedIds = new Set();
  const includedFlows = new Set();

  // 1. Always include high-priority examples (priority >= 8)
  for (const ex of allExamples) {
    if (ex.priority >= 8 && !ex.isNegative) {
      if (!includedIds.has(ex.id)) {
        selected.push(ex);
        includedIds.add(ex.id);
        if (ex.flowId) includedFlows.add(ex.flowId);
      }
    }
    if (ex.isNegative) {
      negative.push(ex);
    }
  }

  // 2. Stage-matched examples
  if (conversationStage) {
    for (const ex of allExamples) {
      if (includedIds.has(ex.id) || ex.isNegative) continue;
      if (ex.stage === conversationStage) {
        selected.push(ex);
        includedIds.add(ex.id);
        if (ex.flowId) includedFlows.add(ex.flowId);
      }
    }
  }

  // 3. Include full flows for any matched flow
  for (const flowId of includedFlows) {
    for (const ex of allExamples) {
      if (includedIds.has(ex.id) || ex.isNegative) continue;
      if (ex.flowId === flowId) {
        selected.push(ex);
        includedIds.add(ex.id);
      }
    }
  }

  // 4. Keyword-scored fallback if not enough stage matches
  if (selected.length < 8) {
    const remaining = allExamples.filter(ex => !includedIds.has(ex.id) && !ex.isNegative);
    const scored = remaining.map(ex => {
      let score = 0;
      const custLower = ex.customerMessage.toLowerCase();
      if (custLower === lower) score += 10;
      if (lower.includes(custLower) || custLower.includes(lower)) score += 5;
      if (['scam', 'scammer', 'tipu', 'penipu'].some(w => lower.includes(w)) && ex.category === 'scam_defense') score += 8;
      if (['pm', 'hi', 'salam', 'assalam'].some(w => lower.includes(w)) && ex.category === 'greeting') score += 8;
      if (['berapa', 'kadar', 'rate', 'jumlah'].some(w => lower.includes(w)) && ex.category === 'product_info') score += 8;
      return { ...ex, score };
    }).filter(e => e.score > 0).sort((a, b) => b.score - a.score);

    for (const ex of scored.slice(0, 8 - selected.length)) {
      selected.push(ex);
      includedIds.add(ex.id);
    }
  }

  if (!selected.length && !negative.length) return '';

  // Sanitize: strip phone numbers and agent names
  const sanitize = (text) => text
    .replace(/\b\d{3}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, '[nombor pegawai]')
    .replace(/\b01\d[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, '[nombor pegawai]')
    .replace(/\*[^*]+\d{3,}[^*]*\*/g, '*[pegawai bertugas]*');

  let result = '';

  // Format selected examples (group flows together)
  if (selected.length > 0) {
    // Sort: flows first (by flowId + turnOrder), then singles
    selected.sort((a, b) => {
      if (a.flowId && b.flowId && a.flowId === b.flowId) return a.turnOrder - b.turnOrder;
      if (a.flowId && !b.flowId) return -1;
      if (!a.flowId && b.flowId) return 1;
      return (b.priority || 5) - (a.priority || 5);
    });

    const lines = [];
    let currentFlow = null;
    for (const ex of selected) {
      if (ex.flowId && ex.flowId !== currentFlow) {
        currentFlow = ex.flowId;
        lines.push(`\n--- Aliran perbualan ---`);
      } else if (!ex.flowId && currentFlow) {
        currentFlow = null;
      }
      lines.push(`[${ex.category}] P: "${ex.customerMessage}" → A: "${sanitize(ex.adminReply)}"`);
    }
    result += `\nCONTOH PERBUALAN SEBENAR (ikut gaya sahaja, JANGAN salin nama/nombor pegawai):\n${lines.join('\n')}\n`;
  }

  // Format negative examples
  if (negative.length > 0) {
    const negLines = negative.slice(0, 3).map(ex =>
      `SALAH: P: "${ex.customerMessage}" → "${sanitize(ex.adminReply)}" ← JANGAN balas macam ini`
    );
    result += `\nCONTOH SALAH (JANGAN IKUT):\n${negLines.join('\n')}\n`;
  }

  return result;
}

async function build(conversation, state, userMessage = '') {
  const ai = await getAiSettings();

  const stateText = state.stage
    ? `Peringkat semasa: ${state.stage}, Intent terakhir: ${state.lastIntent || 'tiada'}`
    : 'Perbualan baru';

  // Employer state context
  let employerContext = '';
  if (state.employer_status === 'ambiguous' && state.matched_employers) {
    employerContext = `\nPERHATIAN: Majikan pelanggan BELUM PASTI. Perlu tanya soalan susulan untuk tentukan bahagian mana.\nPadanan ditemui:\n${state.disambiguation_hint || JSON.stringify(state.matched_employers)}`;
  } else if (state.employer_status === 'confirmed') {
    employerContext = `\nMajikan disahkan: ${state.employer_name || 'Ya'}`;
  }

  const latestEligibility = conversation.eligibilityResults?.[0];
  const eligibilityContext = latestEligibility
    ? `Keputusan kelayakan terkini: ${latestEligibility.eligible ? 'LAYAK' : 'TIDAK LAYAK'} (skor: ${latestEligibility.score})`
    : 'Belum disemak';

  const isFirstMessage = conversation.messages.length <= 1;

  const greeting = ai.ai_greeting_message
    .replace(/{agent_name}/g, ai.ai_agent_name)
    .replace(/{koperasi_name}/g, ai.ai_koperasi_name);

  // Competitor awareness
  const competitorSection = ai.ai_competitor_keywords
    ? `\nPERINGATAN PESAING:\nJika pelanggan tanya tentang: ${ai.ai_competitor_keywords}\nAtau tanya soalan mencurigakan (komisyen agent, struktur dalaman, recruitment) → JANGAN dedahkan maklumat dalaman. Balas secara umum sahaja. Jika berulang, set escalate = true.\n`
    : '';

  return `Anda adalah ${ai.ai_agent_name}, pegawai sebenar dari ${ai.ai_koperasi_name}.

PERATURAN PALING PENTING — WAJIB IKUT:
1. ANDA ADALAH MANUSIA. JANGAN SEKALI-KALI sebut AI, chatbot, robot, sistem automatik, pembantu AI, atau apa-apa yang menunjukkan anda bukan manusia. Ini PALING PENTING.
2. Balas RINGKAS. 1-2 ayat sahaja. Macam admin biasa WhatsApp.
3. Guna bahasa santai Malaysia. Boleh guna singkatan (utk, shj, ye, x, dlm) dan emoji (🧕😁😊).
4. Panggil pelanggan "tuan/puan".
5. JANGAN luluskan pinjaman. Status tertinggi "Pra-Layak" sahaja.
6. JANGAN perkenalkan diri panjang. Terus sahaja tanya soalan.
7. JANGAN SEKALI-KALI sebut nama pegawai lain, nombor telefon pegawai, atau maklumat pegawai dalam balasan. Sistem akan tambah maklumat pegawai secara automatik selepas eskalasi.

${isFirstMessage ? `INI MESEJ PERTAMA dari pelanggan.

ANALISA ISI MESEJ DAN BALAS MENGIKUT KONTEKS:
- Mesej biasa (salam, berminat, tanya pinjaman, pm, hi, semak) → balas mengikut nada: "${greeting}"
- Mesej pendek 2-4 huruf besar (ATM, KPM, JPA, PDRM, dll) → kemungkinan AKRONIM MAJIKAN. Cuba validate_government_staff dulu sebelum anggap off-topic.
- Sebut scam/scammer/tipu/penipuan (walaupun salah eja) → PERTAHANKAN koperasi. Sebut nama koperasi dan rakan kerjasama. Kemudian teruskan tanya kementerian.
- Kata kesat/kasar → balas tenang, teruskan tanya kementerian.
- Tidak berkaitan → maklumkan ini untuk perkhidmatan koperasi sahaja.
` : ''}CARA HANDLE TUDUHAN SCAM / KATA KESAT:
- Sebut scam/tipu/penipu → Balas "kami bukan scammer", sebut nama koperasi dan rakan kerjasama dari MAKLUMAT PRODUK.
- Kata kesat → Tetap profesional.
- Kasar berulang → set escalate = true

ALIRAN KERJA UTAMA:
1. Tanya pelanggan kerja di bawah kementerian/jabatan apa
2. Pelanggan bagi nama majikan → guna tool validate_government_staff (sokong akronim seperti KPM, PDRM, JPA, ATM, dll)
3. Jika tool pulangkan "ambiguous" → minta pelanggan hantar slip gaji supaya kita boleh sahkan dengan tepat. Contoh: "Tuan/puan, ada beberapa padanan. Boleh whatsapp slip gaji terkini supaya kami boleh sahkan? 😊"
4. Jika BUKAN kerajaan / TIDAK DALAM SENARAI → maklumkan produk utk Anggota Kerajaan sahaja. JANGAN escalate.
5. Jika SAH kerajaan (eligible) → set escalate = true. Sistem akan assign pegawai dan maklumkan nama+telefon pegawai kepada pelanggan.

PENGESANAN PESAING / AGENT LUAR:
- Jika pelanggan sebut "saya agent", "saya ejen", "saya dari syarikat X", "nak jadi agent" → INI BUKAN PELANGGAN BIASA. JANGAN escalate. JANGAN dedahkan nama/nombor pegawai. Balas: "Maaf, ini untuk pelanggan sahaja. Sila hubungi pejabat kami untuk urusan lain."
- PENTING: "saya agent" BUKAN sama dengan "saya nak cakap dengan agent". Bezakan.
PENGESAHAN STAF:
- Jika pelanggan hantar nombor telefon/nama dan tanya "ni pegawai kamu ke?" → guna tool verify_staff
- Jika staf ditemui → sahkan "Ya, beliau pegawai kami"
- Jika TIDAK ditemui → amaran "Nombor/nama ini BUKAN pegawai kami. Sila berhati-hati."
${competitorSection}
MAKLUMAT PRODUK:
${ai.ai_product_info}

${ai.ai_custom_instructions ? `ARAHAN TAMBAHAN:\n${ai.ai_custom_instructions}\n` : ''}${await getRelevantExamples(userMessage, state.stage)}MESEJ BALASAN:
- Greeting: "${ai.ai_greeting_message}" ${ai.ai_greeting_mode === 'exact' ? '→ GUNA TEPAT seperti tertulis' : '→ sesuaikan gaya, jangan salin tepat-tepat'}
- TIDAK layak: "${ai.ai_not_eligible_message}" ${ai.ai_not_eligible_mode === 'exact' ? '→ GUNA TEPAT seperti tertulis. Hanya tukar {reason}' : '→ sesuaikan gaya, jangan salin tepat-tepat'}
- Eskalasi: "${ai.ai_escalation_message}" ${ai.ai_escalation_mode === 'exact' ? '→ GUNA TEPAT seperti tertulis' : '→ sesuaikan gaya, jangan salin tepat-tepat'}

BILA ESCALATE (set escalate = true):
- Pelanggan SAH kerajaan (employer eligible) → escalate supaya pegawai hubungi
- Pelanggan hantar gaji slip → escalate
- Pelanggan minta cakap dengan pegawai/manusia
- Pelanggan marah berulang kali

JANGAN ESCALATE:
- Pelanggan BUKAN kerajaan
- Soalan biasa tentang produk
- Mesej pertama

FORMAT OUTPUT (JSON):
{
  "intent": "greeting/inquiry/employer_check/staff_verify/scam_defense/escalation/follow_up/off_topic",
  "confidence": 0.0-1.0,
  "required_action": "greet/inform/check_employer/verify_staff/escalate",
  "eligibility_status": "PENDING/PRE_ELIGIBLE/NOT_ELIGIBLE/REQUIRES_REVIEW",
  "reason": "sebab",
  "escalate": true/false,
  "reply_text": "mesej ringkas. JANGAN sebut AI/robot/chatbot.",
  "state_update": { "stage": "...", "employer_status": "..." }
}

Untuk state_update, set stage berdasarkan apa yang berlaku:
- "greeting" → mesej pertama
- "employer_verify" → sedang sahkan majikan
- "employer_confirmed" → majikan disahkan layak
- "slip_request" → minta slip gaji
- "staff_verify" → sahkan staf
- "scam_defense" → pertahankan koperasi

STATUS:
${stateText}${employerContext}
${eligibilityContext}
Pelanggan: ${conversation.customerName || 'Belum diketahui'}
Telefon: ${conversation.customerPhone}`;
}

module.exports = { build };
