// =====================================================================
// app.js — หน้าเว็บทั้งหมด (หน้าเดียว)
//   1) เฉลย + คะแนนเต็ม (บันทึกไว้ใน localStorage ของเบราว์เซอร์)
//   2) อัปโหลดรูปหลายรูป -> ตรวจทีละรูปด้วย cv-pipeline.js
//   3) ตารางผล Part 1 / Part 2 / รวม + ดูภาพตรวจและแก้คำตอบ + ส่งออกคะแนน (Excel / CSV / PDF / JSON)
// =====================================================================
import { readSheet, drawOverlay, getModelStatus } from './cv-pipeline.js';
import { CONFIG } from './config.js';
import { gradeSheet, normPart1, normPart2, PART1_COUNT, PART2_COUNT, GRADE_MODES } from './scoring.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (x) => (Number.isFinite(x) ? (Math.round(x * 100) / 100).toString() : '—');

// ---------------------------------------------------------------------
// 1) เฉลย — แยกได้สูงสุด 3 ชุด (ตามวง "ชุดกระดาษคำถาม" 1/2/3 บนกระดาษ)
//    cfg = { count: 1..3, active: ชุดที่กำลังแก้, mode: โหมดการตรวจ (ดู GRADE_MODES),
//            sets: {1: {part1, part2, w1, w2, tol}, 2: ..., 3: ...} }
// ---------------------------------------------------------------------
const KEY_STORE = 'visiongrade_key';
const MAX_SETS = 3;
const emptySet = (w1 = 60, w2 = 20, tol = 0) => ({ part1: {}, part2: {}, w1, w2, tol });
let cfg = loadKey();
const key = () => cfg.sets[cfg.active];          // เฉลยชุดที่กำลังแก้อยู่

function loadKey() {
  let k = null;
  try { k = JSON.parse(localStorage.getItem(KEY_STORE)); } catch {}
  const c = { count: 1, active: 1, mode: 'auto', sets: {} };
  if (k && k.sets) Object.assign(c, k);
  else if (k && k.part1) c.sets[1] = k;          // รูปแบบเก่า (มีเฉลยชุดเดียว)
  for (let i = 1; i <= MAX_SETS; i++) c.sets[i] ||= emptySet(c.sets[1]?.w1, c.sets[1]?.w2, c.sets[1]?.tol);
  c.count = Math.min(MAX_SETS, Math.max(1, Number(c.count) || 1));
  c.active = Math.min(c.count, Math.max(1, Number(c.active) || 1));
  if (!(c.mode in GRADE_MODES)) c.mode = 'auto';
  return c;
}
function saveKey() {
  try { localStorage.setItem(KEY_STORE, JSON.stringify(cfg)); } catch {}
  renderKeySummary();
  regradeAll();
}

const countKey = (k) => ({ n1: Object.values(k.part1).filter(Boolean).length, n2: Object.values(k.part2).filter((v) => normPart2(v)).length });

function renderSets() {
  $('#set-count').value = cfg.count;
  $('#set-tabs').innerHTML = cfg.count > 1
    ? Array.from({ length: cfg.count }, (_, i) => {
      const n = i + 1, { n1, n2 } = countKey(cfg.sets[n]);
      return `<button class="tab ${n === cfg.active ? 'on' : ''}" data-set="${n}">ชุดที่ ${n}<small>(${n1 + n2} ข้อ)</small></button>`;
    }).join('')
    : '';
  $('#set-hint').textContent = cfg.count > 1
    ? `กำลังแก้เฉลยชุดที่ ${cfg.active} — ระบบตรวจแต่ละแผ่นตามวง "ชุดกระดาษคำถาม" ที่นักเรียนฝน`
    : 'ใช้เฉลยเดียวกันทุกแผ่น';
}

function renderKeyForm() {
  const k = key();
  $('#w1').value = k.w1; $('#w2').value = k.w2; $('#tol').value = k.tol;
  $('#grade-mode').value = cfg.mode;
  renderSets(); renderKeyGrid(); renderKey2(); renderKeySummary();
}

function renderKeyGrid() {
  const k = key();
  // เรียงเหมือนกระดาษ: คอลัมน์ละ 15 ข้อ (1-15, 16-30, 31-45, 46-60)
  let html = '';
  for (let col = 0; col < 4; col++) {
    html += '<div>';
    for (let q = col * 15 + 1; q <= col * 15 + 15; q++) {
      html += `<div class="krow"><span class="q">${q}</span>` +
        [1, 2, 3, 4, 5].map((o) => `<button class="opt ${k.part1[q] === String(o) ? 'on' : ''}" data-q="${q}" data-o="${o}">${o}</button>`).join('') +
        '</div>';
    }
    html += '</div>';
  }
  $('#keygrid').innerHTML = html;
  $('#quick').value = Array.from({ length: PART1_COUNT }, (_, i) => k.part1[i + 1] || '-').join('').replace(/-+$/, '');
}

function renderKey2() {
  const k = key();
  $('#key2').innerHTML = Array.from({ length: PART2_COUNT }, (_, i) =>
    `<label>${i + 1})<input data-q2="${i + 1}" value="${esc(k.part2[i + 1] || '')}" inputmode="decimal" placeholder="—"></label>`).join('');
}

function renderKeySummary() {
  const k = key(), { n1, n2 } = countKey(k);
  $('#key-summary').textContent = `${cfg.count > 1 ? `ชุดที่ ${cfg.active}: ` : ''}มีเฉลย Part 1: ${n1}/60 ข้อ • Part 2: ${n2}/10 ข้อ • คะแนนเต็มรวม ${fmt((n1 ? +k.w1 : 0) + (n2 ? +k.w2 : 0))} (บันทึกอัตโนมัติ)`;
  if (cfg.count > 1) renderSets();
}

function initKey() {
  renderKeyForm();

  $('#set-count').addEventListener('change', (e) => {
    cfg.count = Number(e.target.value);
    if (cfg.active > cfg.count) cfg.active = 1;
    renderKeyForm(); saveKey();
  });
  $('#set-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-set]'); if (!b) return;
    cfg.active = Number(b.dataset.set);
    renderKeyForm();
    try { localStorage.setItem(KEY_STORE, JSON.stringify(cfg)); } catch {}
  });

  $('#keygrid').addEventListener('click', (e) => {
    const b = e.target.closest('.opt'); if (!b) return;
    const k = key(), q = b.dataset.q;
    k.part1[q] = k.part1[q] === b.dataset.o ? '' : b.dataset.o;   // คลิกซ้ำ = ยกเลิก
    if (!k.part1[q]) delete k.part1[q];
    renderKeyGrid(); saveKey();
  });
  $('#quick').addEventListener('input', (e) => {
    const k = key();
    const s = e.target.value.replace(/[^1-5\-_. 0]/g, '');
    k.part1 = {};
    [...s.replace(/\s/g, '')].slice(0, PART1_COUNT).forEach((c, i) => { if (/[1-5]/.test(c)) k.part1[i + 1] = c; });
    const pos = e.target.selectionStart;
    renderKeyGrid(); e.target.value = s; e.target.setSelectionRange(pos, pos);
    saveKey();
  });
  $('#key2').addEventListener('input', (e) => {
    const q = e.target.dataset.q2; if (!q) return;
    const k = key(), v = e.target.value.trim();
    e.target.style.borderColor = v && normPart2(v) === null ? 'var(--bad)' : '';
    if (v) k.part2[q] = v; else delete k.part2[q];
    saveKey();
  });
  for (const id of ['w1', 'w2', 'tol']) $('#' + id).addEventListener('input', (e) => { key()[id] = Number(e.target.value) || 0; saveKey(); });
  $('#grade-mode').addEventListener('change', (e) => { cfg.mode = e.target.value in GRADE_MODES ? e.target.value : 'auto'; saveKey(); });

  $('#key-clear').addEventListener('click', () => {
    if (!confirm(cfg.count > 1 ? `ล้างเฉลยชุดที่ ${cfg.active}?` : 'ล้างเฉลยทั้งหมด?')) return;
    const k = key(); k.part1 = {}; k.part2 = {};
    renderKeyForm(); saveKey();
  });

  // อ่านเฉลยจากรูปกระดาษเฉลย (ครูฝนเฉลยลงกระดาษคำตอบ 1 แผ่น)
  // ถ้ามีหลายชุดและกระดาษเฉลยฝนวง "ชุดกระดาษคำถาม" ไว้ จะใส่ลงชุดนั้นให้อัตโนมัติ
  $('#key-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const label = e.target.parentElement, old = label.firstChild.textContent;
    label.firstChild.textContent = 'กำลังอ่านเฉลย…';
    try {
      const { result } = await readSheet(f);
      const b = result.header.booklet_no;
      if (cfg.count > 1 && b >= 1 && b <= cfg.count) cfg.active = b;
      const k = key();
      k.part1 = {}; k.part2 = {};
      for (const [q, a] of Object.entries(result.answers.part1)) if (a && !Array.isArray(a)) k.part1[q] = String(a);
      for (const [q, a] of Object.entries(result.answers.part2)) if (a && normPart2(a) !== null) k.part2[q] = a;
      renderKeyForm(); saveKey();
      const multi = Object.values(result.answers.part1).filter(Array.isArray).length;
      alert(`${cfg.count > 1 ? `ใส่ลงเฉลยชุดที่ ${cfg.active}${b ? '' : ' (กระดาษเฉลยไม่ได้ฝนชุด — ใส่ลงชุดที่เปิดอยู่)'}\n` : ''}` +
        `อ่านเฉลยได้ Part 1: ${Object.keys(k.part1).length} ข้อ, Part 2: ${Object.keys(k.part2).length} ข้อ` +
        (multi ? `\nมี ${multi} ข้อที่ฝนเกิน 1 วง (ไม่ได้ใส่ให้)` : '') +
        (result.engine.digit === 'none' ? '\nยังไม่มีโมเดลอ่านตัวเลข — กรอก Part 2 เอง' : '') + '\nกรุณาตรวจทานก่อนใช้');
    } catch (err) {
      alert('อ่านเฉลยไม่สำเร็จ: ' + err.message);
    } finally { label.firstChild.textContent = old; }
  });
}

// ---------------------------------------------------------------------
// 2) อัปโหลด + ตรวจทีละรูป
// ---------------------------------------------------------------------
const sheets = [];      // {id, name, file, status, error, result, answers, studentId, subject, school, booklet, grade, img}
let running = false, nextId = 1;

function addFiles(files) {
  const imgs = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|bmp)$/i.test(f.name));
  if (!imgs.length) return;
  for (const f of imgs) sheets.push({ id: nextId++, name: f.name, file: f, status: 'wait' });
  renderTable();
  processQueue();
}

async function processQueue() {
  if (running) return;
  running = true;
  $('#progress').hidden = false;
  const t0 = performance.now();
  let doneHere = 0;
  for (let s; (s = sheets.find((x) => x.status === 'wait'));) {
    s.status = 'run'; renderTable(); updateProgress(t0, doneHere);
    try {
      const { result, warpedCanvas } = await readSheet(s.file);
      s.result = result;
      s.answers = structuredClone(result.answers);       // สำเนาที่ครูแก้ได้
      s.studentId = result.header.student_id;
      s.subject = result.header.subject_code;
      s.school = result.header.school_code;
      s.booklet = result.header.booklet_no;               // ชุดที่นักเรียนฝน (null = ไม่ได้ฝน/ฝนหลายวง)
      s.img = await new Promise((r) => warpedCanvas.toBlob((b) => r(URL.createObjectURL(b)), 'image/jpeg', 0.85));
      s.status = 'done';
      grade(s);
    } catch (err) {
      console.error(s.name, err);
      s.status = 'error'; s.error = err.message || String(err);
    }
    s.file = null;                                          // คืนหน่วยความจำ
    doneHere++;
    renderTable(); updateProgress(t0, doneHere);
  }
  running = false;
}

function updateProgress(t0, doneHere) {
  const total = sheets.length, done = sheets.filter((s) => s.status === 'done' || s.status === 'error').length;
  $('#bar').style.width = (total ? (done / total) * 100 : 0) + '%';
  const left = total - done;
  const per = doneHere ? (performance.now() - t0) / doneHere / 1000 : 0;
  $('#progress-text').textContent = left
    ? `กำลังตรวจ ${done + 1}/${total}${per ? ` • เหลือประมาณ ${Math.ceil(per * left)} วินาที` : ' • ครั้งแรกต้องโหลด OpenCV สักครู่'}`
    : `ตรวจเสร็จ ${total} รูป`;
}

// ชุดที่ใช้ตรวจแผ่นนี้: มีชุดเดียว = ชุด 1 เสมอ, หลายชุด = ตามที่ฝน (ฝนไม่ชัด = ยังไม่รู้ -> ใช้ชุด 1 และเตือน)
const bookletOf = (s) => (cfg.count === 1 ? 1 : s.booklet >= 1 && s.booklet <= cfg.count ? s.booklet : null);
function grade(s) {
  if (s.status !== 'done') return;
  s.usedSet = bookletOf(s) || 1;
  s.grade = gradeSheet(s.answers, cfg.sets[s.usedSet], s.mode || cfg.mode);   // s.mode = ครูเลือกโหมดเฉพาะแผ่นนี้
}
function regradeAll() { sheets.forEach(grade); renderTable(); }

// จุดที่ต้องให้ครูดู (ไม่นับข้อความแจ้งว่ายังไม่มีโมเดล)
// มีชุดเดียว = ไม่ต้องเตือนเรื่องวงชุดกระดาษคำถาม
// โหมด auto ข้ามข้อฝนเพราะพบรอยฝนแค่ 1–2 ข้อ -> เตือนให้ครูดูด้วย
const reviewItems = (s) => [
  ...(s.result?.review || []).filter((r) => r.type !== 'model' && !(r.type === 'qset' && (cfg.count === 1 || s.bookletSet))),
  ...(s.grade?.sectionNote ? [{ type: 'section', item: s.grade.sectionNote }] : []),
];

// ---------------------------------------------------------------------
// 3) ตารางผล + สถิติ + ส่งออกคะแนน
// ---------------------------------------------------------------------
function renderTable() {
  const tb = $('#rows');
  if (!sheets.length) {
    tb.innerHTML = '<tr><td colspan="11" class="empty">ยังไม่มีผล — ใส่เฉลยแล้วอัปโหลดรูปในข้อ 2</td></tr>';
  } else {
    tb.innerHTML = sheets.map((s, i) => {
      const g = s.grade;
      let st;
      if (s.status === 'wait') st = '<span class="badge b-wait">รอคิว</span>';
      else if (s.status === 'run') st = '<span class="badge b-wait">กำลังตรวจ…</span>';
      else if (s.status === 'error') st = `<span class="badge b-bad" title="${esc(s.error)}">ตรวจไม่ได้</span> <small class="muted">${esc(s.error)}</small>`;
      else {
        const n = reviewItems(s).length;
        st = n ? `<span class="badge b-warn">ควรตรวจ ${n} จุด</span>` : '<span class="badge b-ok">เรียบร้อย</span>';
        if (!bookletOf(s)) st = '<span class="badge b-bad">ไม่รู้ชุด (ใช้ชุด 1)</span> ' + st;
      }
      const dash = s.status === 'done' ? '—' : '';
      return `<tr>
        <td>${i + 1}</td>
        <td class="file" title="${esc(s.name)}">${esc(s.name)}</td>
        <td class="mono">${esc(s.studentId || dash)}</td>
        <td class="mono">${esc(s.subject || dash)}</td>
        <td class="mono">${esc(s.school || dash)}</td>
        <td>${s.status === 'done' ? (bookletOf(s) ? (cfg.count > 1 ? bookletOf(s) : '1') : '<b style="color:var(--bad)">?</b>') : ''}</td>
        <td class="num">${!g ? '' : g.p1Graded ? `${fmt(g.p1)} <small class="muted">(${g.p1Correct}/${g.p1Count})</small>` : '<small class="muted">ไม่ได้ทำ</small>'}</td>
        <td class="num">${!g ? '' : g.p2Graded ? `${fmt(g.p2)} <small class="muted">(${g.p2Correct}/${g.p2Count})</small>` : '<small class="muted">ไม่ได้ทำ</small>'}</td>
        <td class="num">${g ? `<b>${fmt(g.total)}</b> <small class="muted">/ ${fmt(g.full)}</small>` : ''}</td>
        <td>${st}</td>
        <td>${s.status === 'done' ? `<button class="btn btn-light btn-sm" data-view="${s.id}">ดู / แก้</button>` : ''}
            <button class="btn btn-light btn-sm" data-del="${s.id}" title="ลบ">✕</button></td></tr>`;
    }).join('');
  }
  const done = sheets.filter((s) => s.grade);
  $('#export-btn').disabled = !done.length;
  $('#clear').disabled = !sheets.length || running;
  // คะแนนเต็มแต่ละแผ่นอาจไม่เท่ากัน (ตรวจเฉพาะส่วนที่ทำ) -> สถิติรวมใช้ร้อยละ
  const pct = done.map((s) => pctOf(s.grade));
  const g1 = done.filter((s) => s.grade.p1Graded), g2 = done.filter((s) => s.grade.p2Graded);
  const avg = (arr, f) => fmt(arr.reduce((a, s) => a + f(s), 0) / arr.length);
  const stat = (v, t) => `<div class="stat"><b>${v}</b><span>${t}</span></div>`;
  $('#stats').innerHTML = done.length
    ? stat(done.length, 'แผ่นที่ตรวจแล้ว') + stat(fmt(pct.reduce((a, b) => a + b, 0) / pct.length) + '%', 'ค่าเฉลี่ย')
      + stat(fmt(Math.max(...pct)) + '%', 'สูงสุด') + stat(fmt(Math.min(...pct)) + '%', 'ต่ำสุด')
      + (g1.length ? stat(avg(g1, (s) => s.grade.p1), `เฉลี่ย Part 1 (${g1.length} แผ่น)`) : '')
      + (g2.length ? stat(avg(g2, (s) => s.grade.p2), `เฉลี่ย Part 2 (${g2.length} แผ่น)`) : '')
    : '';
}

const pctOf = (g) => (g.full ? (100 * g.total) / g.full : 0);
const gradedText = (g) => [g.p1Graded && 'Part 1', g.p2Graded && 'Part 2'].filter(Boolean).join(' + ');

// ---- ส่งออกคะแนน: ทุกรูปแบบใช้ข้อมูลชุดเดียวกันจาก exportRows() ----
const SUMMARY_HEAD = ['ลำดับ', 'ไฟล์', 'รหัสนักเรียน', 'รหัสวิชา', 'รหัสสถานศึกษา', 'ชุดข้อสอบ', 'Part 1', 'Part 2', 'รวม', 'คะแนนเต็ม', 'ร้อยละ', 'ส่วนที่ตรวจ', 'จุดที่ควรตรวจ'];
const ID_COLS = [2, 3, 4];   // คอลัมน์รหัส (ต้องเก็บเป็นข้อความ ไม่ให้เลข 0 ข้างหน้าหาย)
const today = () => new Date().toISOString().slice(0, 10);
const pctX = (g) => (g.full ? (100 * g.total) / g.full : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : '');

function exportRows() {
  return sheets.filter((s) => s.grade).map((s, i) => {
    const g = s.grade;
    return {
      s, g,
      summary: [i + 1, s.name, s.studentId || '', s.subject || '', s.school || '', bookletOf(s) ?? `? (ใช้ชุด ${s.usedSet})`,
        g.p1Graded ? g.p1 : '', g.p2Graded ? g.p2 : '', g.total, g.full, g.full ? r2(pctX(g)) : '',
        [g.p1Graded && 'Part 1', g.p2Graded && 'Part 2'].filter(Boolean).join(' + '), reviewItems(s).length],
      p1: Array.from({ length: PART1_COUNT }, (_, q) => normPart1(s.answers.part1[q + 1])),
      p2: Array.from({ length: PART2_COUNT }, (_, q) => s.answers.part2[q + 1] ?? ''),
    };
  });
}
const qHead = () => [...Array.from({ length: PART1_COUNT }, (_, q) => 'ข้อ ' + (q + 1)), ...Array.from({ length: PART2_COUNT }, (_, q) => 'P2 ข้อ ' + (q + 1))];

function saveFile(data, type, ext) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  a.download = `visiongrade_${today()}.${ext}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function downloadCSV() {
  const lines = [[...SUMMARY_HEAD, ...qHead()], ...exportRows().map((r) => [...r.summary, ...r.p1, ...r.p2])];
  // ใส่ ="..." ให้รหัสที่ขึ้นต้นด้วย 0 ไม่หายเมื่อเปิดใน Excel
  const cell = (v, j, i) => i > 0 && ID_COLS.includes(j) && v ? `="${v}"` : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  saveFile('﻿' + lines.map((r, i) => r.map((v, j) => cell(v, j, i)).join(',')).join('\r\n'), 'text/csv;charset=utf-8', 'csv');
}

function downloadJSON() {
  const out = {
    app: 'VisionGrade', template: 'Template No. 4', exported_at: new Date().toISOString(),
    grade_mode: cfg.mode, exam_sets: cfg.count,
    answer_keys: Object.fromEntries(Array.from({ length: cfg.count }, (_, i) => [i + 1, cfg.sets[i + 1]])),
    sheets: exportRows().map(({ s, g }) => ({
      file: s.name, student_id: s.studentId || '', subject_code: s.subject || '', school_code: s.school || '',
      booklet: bookletOf(s), graded_with_set: s.usedSet,
      score: { part1: g.p1Graded ? g.p1 : null, part2: g.p2Graded ? g.p2 : null, total: g.total, full: g.full, percent: g.full ? r2(pctX(g)) : null,
        part1_correct: g.p1Correct, part1_count: g.p1Count, part2_correct: g.p2Correct, part2_count: g.p2Count },
      answers: s.answers, review: reviewItems(s).map((r) => r.item ?? r.type),
    })),
  };
  saveFile(JSON.stringify(out, null, 2), 'application/json', 'json');
}

let xlsxLib = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return (xlsxLib ||= new Promise((ok, bad) => {
    const sc = document.createElement('script');
    sc.src = CONFIG.LIBS.xlsx; sc.onload = () => ok(window.XLSX);
    sc.onerror = () => { xlsxLib = null; bad(new Error('โหลดไลบรารี Excel ไม่ได้ (ต้องต่ออินเทอร์เน็ต)')); };
    document.head.appendChild(sc);
  }));
}

async function downloadXLSX() {
  const XLSX = await loadXLSX();
  const rows = exportRows();
  const wb = XLSX.utils.book_new();
  const sheet = (aoa, widths) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = widths.map((w) => ({ wch: w })); return ws; };
  // แผ่นที่ 1: คะแนน (รหัสเป็นข้อความอยู่แล้ว เลข 0 ข้างหน้าไม่หาย)
  XLSX.utils.book_append_sheet(wb, sheet([SUMMARY_HEAD, ...rows.map((r) => r.summary)], [6, 22, 16, 14, 14, 10, 8, 8, 8, 10, 8, 16, 12]), 'คะแนน');
  // แผ่นที่ 2: คำตอบรายข้อ
  XLSX.utils.book_append_sheet(wb, sheet([['ลำดับ', 'รหัสนักเรียน', 'ชุด', ...qHead()], ...rows.map((r) => [r.summary[0], r.summary[2], r.summary[5], ...r.p1, ...r.p2])],
    [6, 16, 6, ...Array(PART1_COUNT + PART2_COUNT).fill(6)]), 'คำตอบรายข้อ');
  // แผ่นที่ 3: เฉลยแต่ละชุด
  const keyRows = [['ชุด', 'คะแนนเต็ม Part 1', 'คะแนนเต็ม Part 2', 'Part 2 ยอมคลาด ±', ...qHead()]];
  for (let n = 1; n <= cfg.count; n++) {
    const k = cfg.sets[n];
    keyRows.push([n, k.w1, k.w2, k.tol,
      ...Array.from({ length: PART1_COUNT }, (_, q) => normPart1(k.part1[q + 1]) || ''),
      ...Array.from({ length: PART2_COUNT }, (_, q) => k.part2[q + 1] ?? '')]);
  }
  XLSX.utils.book_append_sheet(wb, sheet(keyRows, [6, 14, 14, 14, ...Array(PART1_COUNT + PART2_COUNT).fill(6)]), 'เฉลย');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveFile(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), null, 'xlsx');
}

// PDF: สร้างหน้ารายงานแล้วเปิดหน้าต่างพิมพ์ของเบราว์เซอร์ -> เลือก "บันทึกเป็น PDF" (ภาษาไทยแสดงถูกต้อง)
function printReport() {
  const rows = exportRows();
  const tot = rows.map((r) => pctX(r.g)).filter(Number.isFinite);
  const avg = tot.length ? tot.reduce((a, b) => a + b, 0) / tot.length : NaN;
  const sd = tot.length ? Math.sqrt(tot.reduce((a, b) => a + (b - avg) ** 2, 0) / tot.length) : NaN;
  const pass = tot.filter((x) => x >= 50).length;
  const uniq = (i) => [...new Set(rows.map((r) => r.summary[i]).filter(Boolean))].join(', ') || '—';
  const td = (v, c = '') => `<td${c ? ` class="${c}"` : ''}>${esc(v === '' ? '—' : v)}</td>`;
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>รายงานคะแนน ${today()}</title>
<style>
@page { size: A4; margin: 14mm 12mm; }
body { font-family: 'Prompt', 'Sarabun', 'Tahoma', sans-serif; color: #0f172a; font-size: 12px; margin: 0; }
h1 { font-size: 18px; margin: 0 0 4px; } .muted { color: #64748b; }
.meta { display: flex; gap: 18px; flex-wrap: wrap; margin: 8px 0 12px; }
.stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-bottom: 12px; }
.stats div { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; } .stats b { display: block; font-size: 16px; }
table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; }
th { background: #f1f5f9; } .num { text-align: right; } .mono { font-family: Consolas, monospace; }
tr { break-inside: avoid; } thead { display: table-header-group; }
</style></head><body>
<h1>รายงานคะแนน — VisionGrade</h1>
<div class="muted">กระดาษคำตอบ Template No. 4 • พิมพ์เมื่อ ${esc(new Date().toLocaleString('th-TH'))}</div>
<div class="meta"><span>รหัสวิชา: <b>${esc(uniq(3))}</b></span><span>รหัสสถานศึกษา: <b>${esc(uniq(4))}</b></span><span>จำนวนชุดข้อสอบ: <b>${cfg.count}</b></span></div>
<div class="stats">
<div><b>${rows.length}</b>จำนวนแผ่น</div><div><b>${fmt(avg)}%</b>ค่าเฉลี่ย</div><div><b>${fmt(sd)}</b>ส่วนเบี่ยงเบนมาตรฐาน</div>
<div><b>${tot.length ? fmt(Math.max(...tot)) : '—'}%</b>สูงสุด</div><div><b>${tot.length ? fmt(Math.min(...tot)) : '—'}%</b>ต่ำสุด</div><div><b>${pass}</b>ได้ 50% ขึ้นไป</div>
</div>
<table><thead><tr><th>#</th><th>รหัสนักเรียน</th><th>รหัสวิชา</th><th>ชุด</th><th class="num">Part 1</th><th class="num">Part 2</th><th class="num">รวม</th><th class="num">เต็ม</th><th class="num">ร้อยละ</th><th>หมายเหตุ</th></tr></thead><tbody>
${rows.map((r) => { const m = r.summary; return `<tr>${td(m[0])}${td(m[2], 'mono')}${td(m[3], 'mono')}${td(m[5])}${td(m[6], 'num')}${td(m[7], 'num')}<td class="num"><b>${esc(m[8])}</b></td>${td(m[9], 'num')}${td(m[10], 'num')}${td(m[12] ? `ควรตรวจ ${m[12]} จุด` : '')}</tr>`; }).join('')}
</tbody></table></body></html>`;
  // พิมพ์ผ่าน iframe ที่ซ่อนอยู่ (ไม่โดนตัวบล็อกป๊อปอัป)
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(fr);
  fr.contentDocument.open(); fr.contentDocument.write(html); fr.contentDocument.close();
  setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 60000); }, 300);
}

const EXPORTERS = { xlsx: downloadXLSX, csv: downloadCSV, pdf: printReport, json: downloadJSON };
function initExport() {
  const btn = $('#export-btn'), menu = $('#export-menu');
  const close = () => { menu.hidden = true; };
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', (e) => { if (!e.target.closest('#export')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  menu.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fmt]'); if (!b) return;
    close();
    const old = btn.textContent; btn.disabled = true; btn.textContent = 'กำลังสร้างไฟล์…';
    try { await EXPORTERS[b.dataset.fmt](); }
    catch (err) { console.error(err); alert('ส่งออกไม่สำเร็จ: ' + err.message); }
    finally { btn.textContent = old; btn.disabled = !sheets.some((s) => s.grade); }
  });
}

// ---------------------------------------------------------------------
// 4) หน้าต่างดูผลรายแผ่น (ภาพ + กรอบเขียว/แดง + แก้คำตอบ)
// ---------------------------------------------------------------------
let viewing = null;
const imgCache = new Map();

async function openViewer(id) {
  viewing = sheets.find((s) => s.id === id);
  if (!viewing) return;
  if (!$('#viewer').open) $('#viewer').showModal();
  renderViewer();
}

async function drawSheet() {
  const s = viewing;
  let img = imgCache.get(s.img);
  if (!img) {
    img = new Image(); img.src = s.img; await img.decode();
    imgCache.set(s.img, img);
  }
  if (s !== viewing) return;
  const c = $('#sheet');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  drawOverlay(ctx, 1, { answers: s.answers, details: s.grade.details, review: s.result.review });
}

function renderViewer() {
  const s = viewing, g = s.grade;
  const idx = sheets.filter((x) => x.status === 'done').indexOf(s);
  $('#v-title').textContent = `${s.name}`;
  $('#v-id').value = s.studentId || '';
  $('#v-subject').value = s.subject || '';
  $('#v-school').value = s.school || '';
  const b = bookletOf(s);
  $('#v-booklet').innerHTML = (b ? '' : `<option value="" selected>? ไม่รู้</option>`) +
    Array.from({ length: cfg.count }, (_, i) => `<option value="${i + 1}" ${b === i + 1 ? 'selected' : ''}>ชุด ${i + 1}</option>`).join('');
  $('#v-booklet').disabled = cfg.count === 1;
  $('#v-mode').innerHTML = `<option value="">ตามที่ตั้งไว้ (${esc(GRADE_MODES[cfg.mode])})</option>` +
    Object.entries(GRADE_MODES).map(([m, label]) => `<option value="${m}" ${s.mode === m ? 'selected' : ''}>${esc(label)}</option>`).join('');
  const box = (name, graded, pts, ok, n) => graded
    ? `<div><span>${name}</span><b>${fmt(pts)}</b><span>ถูก ${ok}/${n}</span></div>`
    : `<div><span>${name}</span><b>—</b><span>ไม่ได้ทำ</span></div>`;
  $('#v-scores').innerHTML =
    box('Part 1', g.p1Graded, g.p1, g.p1Correct, g.p1Count) +
    box('Part 2', g.p2Graded, g.p2, g.p2Correct, g.p2Count) +
    `<div><span>รวม</span><b>${fmt(g.total)} / ${fmt(g.full)}</b><span>${cfg.count > 1 ? `เฉลยชุด ${s.usedSet} • ` : ''}แผ่นที่ ${idx + 1}</span></div>`;

  const rv = reviewItems(s).map(reviewText).filter(Boolean);
  if (!b) rv.unshift(`ไม่รู้ว่าเป็นชุดไหน (ไม่ได้ฝนหรือฝนหลายวง) — ตอนนี้ใช้เฉลยชุด 1 เลือกชุดที่ถูกต้องด้านบน`);
  const engineNote = (s.result.review || []).find((r) => r.type === 'model');
  if (engineNote) rv.push(engineNote.item);
  $('#v-review').innerHTML = rv.length ? `<div class="review"><b>ควรตรวจด้วยตา (${rv.length})</b><ul>${rv.slice(0, 12).map((t) => `<li>${esc(t)}</li>`).join('')}${rv.length > 12 ? `<li>และอีก ${rv.length - 12} จุด</li>` : ''}</ul></div>` : '';

  const det = Object.fromEntries(g.details.map((d) => [d.part_type + ':' + d.question_no, d]));
  const cls = (d) => (!d ? '' : d.is_correct ? 'c-ok' : d.student_answer ? 'c-bad' : 'c-warn');
  $('#v-p1').innerHTML = Array.from({ length: PART1_COUNT }, (_, i) => {
    const q = i + 1, d = det['part1_mcq:' + q], a = normPart1(s.answers.part1[q]);
    const opts = ['', '1', '2', '3', '4', '5'];
    if (a.includes(',')) opts.push(a);
    return `<label class="${cls(d)}"><span>${q}</span><select data-p1="${q}">${opts.map((o) =>
      `<option value="${o}" ${o === a ? 'selected' : ''}>${o === '' ? '—' : o.includes(',') ? o + ' (หลายวง)' : o}</option>`).join('')}</select>${d && !d.is_correct ? `<i>→${esc(d.correct_answer)}</i>` : ''}</label>`;
  }).join('');
  $('#v-p2').innerHTML = Array.from({ length: PART2_COUNT }, (_, i) => {
    const q = i + 1, d = det['part2_numeric:' + q];
    return `<label class="${cls(d)}"><span>${q})</span><input data-p2="${q}" value="${esc(s.answers.part2[q] ?? '')}" inputmode="decimal">${d && !d.is_correct ? `<i>→${esc(d.correct_answer)}</i>` : ''}</label>`;
  }).join('');
  const al = s.result.align || {};
  $('#v-info').textContent = `ปรับระนาบ: ${al.cornerSource === 'yolo' ? 'YOLO' : al.cornerSource || '-'}${al.yoloRejected ? ' (YOLO หามุมพลาด ใช้ OpenCV แทน)' : ''} • timing marks ${al.marksPass2 ?? '-'}/38 • โมเดล: วงกลม ${s.result.engine.bubble} / ตัวเลข ${s.result.engine.digit} • ${s.result.timeMs} ms`;
  $('#v-prev').disabled = idx <= 0;
  $('#v-next').disabled = idx >= sheets.filter((x) => x.status === 'done').length - 1;
  drawSheet();
}

function reviewText(r) {
  const F = { student_id: 'รหัสนักเรียน', subject_code: 'รหัสวิชา', school_code: 'รหัสสถานศึกษา' };
  switch (r.type) {
    case 'bubble': return r.part === 'part1' ? `ข้อ ${r.q} ตัวเลือก ${r.opt}: ฝนไม่ชัด (${Math.round(r.p * 100)}%)` : null;
    case 'multi': return `ข้อ ${r.q}: ฝนหลายวง (${r.chosen.join(', ')})`;
    case 'digit': return `${r.part === 'part2' ? `Part 2 ข้อ ${r.q}` : F[r.part]} ช่องที่ ${r.idx + 1}: อ่านได้ "${r.pred}" ไม่มั่นใจ${r.alt ? ` (อาจเป็น ${r.alt})` : ''}`;
    case 'id_length': return `${F[r.part]} อ่านได้ ${r.got} หลัก (ควรเป็น ${r.want})`;
    case 'qset': case 'page': return `${r.item}: ${r.chosen ? 'ฝนหลายวง' : 'ไม่ได้ฝน'}`;
    default: return r.item || null;
  }
}

function initViewer() {
  const dlg = $('#viewer');
  $('#v-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  const step = (d) => {
    const done = sheets.filter((x) => x.status === 'done');
    const n = done[done.indexOf(viewing) + d];
    if (n) openViewer(n.id);
  };
  $('#v-prev').addEventListener('click', () => step(-1));
  $('#v-next').addEventListener('click', () => step(1));
  dlg.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select')) return;
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  $('#v-id').addEventListener('input', (e) => { viewing.studentId = e.target.value.trim(); renderTable(); });
  $('#v-subject').addEventListener('input', (e) => { viewing.subject = e.target.value.trim(); renderTable(); });
  $('#v-school').addEventListener('input', (e) => { viewing.school = e.target.value.trim(); renderTable(); });
  // ครูเลือกชุดเอง -> ตรวจใหม่ด้วยเฉลยชุดนั้น
  $('#v-booklet').addEventListener('change', (e) => {
    if (!e.target.value) return;
    viewing.booklet = Number(e.target.value); viewing.bookletSet = true;
    grade(viewing); renderTable(); renderViewer();
  });
  // ครูเลือกโหมดตรวจเฉพาะแผ่นนี้ ("" = ใช้โหมดที่ตั้งไว้ในข้อ 1)
  $('#v-mode').addEventListener('change', (e) => {
    viewing.mode = e.target.value || null;
    grade(viewing); renderTable(); renderViewer();
  });
  // แก้คำตอบ -> คิดคะแนนใหม่ทันที
  const changed = () => { grade(viewing); renderTable(); renderViewer(); };
  $('#v-p1').addEventListener('change', (e) => {
    const q = e.target.dataset.p1; if (!q) return;
    viewing.answers.part1[q] = e.target.value.includes(',') ? e.target.value.split(',').map(Number) : e.target.value ? Number(e.target.value) : null;
    changed();
  });
  $('#v-p2').addEventListener('change', (e) => {
    const q = e.target.dataset.p2; if (!q) return;
    viewing.answers.part2[q] = e.target.value.trim();
    changed();
  });
}

// ---------------------------------------------------------------------
// เริ่มทำงาน
// ---------------------------------------------------------------------
function initUpload() {
  const drop = $('#drop');
  $('#files').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });

  $('#rows').addEventListener('click', (e) => {
    const v = e.target.closest('[data-view]'); if (v) return openViewer(Number(v.dataset.view));
    const d = e.target.closest('[data-del]');
    if (d) {
      const i = sheets.findIndex((s) => s.id === Number(d.dataset.del));
      if (i >= 0 && sheets[i].status !== 'run') { if (sheets[i].img) URL.revokeObjectURL(sheets[i].img); sheets.splice(i, 1); renderTable(); }
    }
  });
  initExport();
  $('#clear').addEventListener('click', () => {
    if (!confirm('ล้างผลทั้งหมด?')) return;
    sheets.splice(0).forEach((s) => s.img && URL.revokeObjectURL(s.img));
    imgCache.clear(); $('#progress').hidden = true; renderTable();
  });
}

async function showModelStatus() {
  const el = $('#model');
  try {
    const st = await getModelStatus();
    const b = st.bubble?.state === 'ready', d = st.digit?.state === 'ready';
    el.className = 'pill ' + (b && d ? 'ok' : 'warn');
    const y = st.yolo?.state === 'ready';
    el.textContent = (b && d ? 'โมเดลพร้อม (ONNX)' : b || d ? `มีโมเดล${b ? 'วงกลม' : 'ตัวเลข'}อย่างเดียว` : 'ยังไม่มีโมเดล — ใช้โหมดวัดหมึก') + (y ? ' + YOLO' : '');
    el.title = `bubble: ${st.bubble?.message || st.bubble?.state}\ndigit: ${st.digit?.message || st.digit?.state}\nyolo: ${st.yolo?.message || st.yolo?.state}`;
  } catch (e) {
    el.textContent = 'ตรวจสอบโมเดลไม่ได้'; el.title = e.message;
  }
}

initKey();
initUpload();
initViewer();
renderTable();
showModelStatus();
window.addEventListener('beforeunload', (e) => { if (sheets.some((s) => s.grade)) { e.preventDefault(); e.returnValue = ''; } });
