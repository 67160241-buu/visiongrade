// =====================================================================
// scoring.js — คิดคะแนนแยก Part
//
//   key = { part1: {"1": "3", ...}, part2: {"1": "12.5", ...}, w1: 60, w2: 20, tol: 0 }
//     w1 / w2 = คะแนนเต็มของ Part 1 / Part 2
//     ข้อที่ไม่มีเฉลย = ไม่นำมาคิด
//   คะแนนต่อข้อ = คะแนนเต็มของ Part ÷ จำนวนข้อที่มีเฉลยใน Part นั้น
//     เช่น Part 1 มีเฉลย 60 ข้อ เต็ม 60 -> ข้อละ 1, Part 2 มีเฉลย 10 ข้อ เต็ม 20 -> ข้อละ 2
// =====================================================================
export const PART1_COUNT = 60;
export const PART2_COUNT = 10;

/** โหมดการตรวจ: auto = ตรวจเฉพาะส่วนที่นักเรียนทำ (ฝนอย่างเดียว / เขียนอย่างเดียว / ทั้งคู่) */
export const GRADE_MODES = {
  auto: 'อัตโนมัติ (ตรวจเฉพาะส่วนที่ทำ)',
  all: 'ตรวจทุกส่วน',
  part1: 'เฉพาะ Part 1 ข้อฝน',
  part2: 'เฉพาะ Part 2 ข้อเขียน',
};
/** โหมด auto: ถือว่าทำส่วนนั้นเมื่อฝนอย่างน้อย 3 ข้อ / เขียนตัวเลขอย่างน้อย 1 ข้อ (กันรอยเปื้อน 1–2 วง) */
export const SECTION_MIN = { part1: 3, part2: 1 };

const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

/** คำตอบ Part 1 เป็นข้อความ: 3 -> "3", [2,4] -> "2,4" (ฝนหลายวง), null -> "" */
export function normPart1(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v)) return v.map(Number).filter((x) => x >= 1 && x <= 5).sort().join(',');
  const s = String(v).trim();
  return /^[1-5](,[1-5])*$/.test(s) ? s.split(',').map(Number).sort().join(',') : '';
}

/** คำตอบ Part 2 เป็นตัวเลขมาตรฐาน: "012.50" -> "12.5", ".5" -> "0.5"; ว่าง -> ""; อ่านไม่ได้ (เช่นมี ?) -> null */
export function normPart2(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim().replace(/\s+/g, '');
  if (s === '' || s === '-') return '';
  if (!/^-?\d*\.?\d*$/.test(s) || !/\d/.test(s)) return null;
  return String(Number(s));
}

/**
 * ตรวจ 1 แผ่น
 * @param answers  {part1: {"1": 3 | [2,4] | null}, part2: {"1": "12.5"}}  (จาก cv-pipeline)
 * @param key      เฉลย + คะแนนเต็ม (ดูด้านบน)
 * @param mode     'auto' | 'all' | 'part1' | 'part2' (ดู GRADE_MODES)
 * @returns {p1, p2, total, full, p1Graded, p2Graded, sectionNote, p1Correct, p1Count, p2Correct, p2Count, details[]}
 */
export function gradeSheet(answers, key, mode = 'auto') {
  if (!(mode in GRADE_MODES)) mode = 'auto';
  let k1 = Object.entries(key.part1 || {}).filter(([, v]) => normPart1(v));
  let k2 = Object.entries(key.part2 || {}).filter(([, v]) => normPart2(v));

  // ส่วนที่นักเรียนทำจริง (คำตอบ Part 2 ที่อ่านไม่ได้ เช่นมี ? ก็นับว่าทำ)
  const n1 = Object.values(answers.part1 || {}).filter((v) => normPart1(v) !== '').length;
  const n2 = Object.values(answers.part2 || {})
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '' && normPart2(v) !== '').length;
  let use1 = k1.length > 0, use2 = k2.length > 0;
  if (mode === 'part1') use2 = false;
  else if (mode === 'part2') use1 = false;
  else if (mode === 'auto') {
    const d1 = use1 && n1 >= SECTION_MIN.part1, d2 = use2 && n2 >= SECTION_MIN.part2;
    if (d1 || d2) { use1 = d1; use2 = d2; }      // ไม่ได้ทำทั้งสองส่วน (กระดาษเปล่า) -> ตรวจทั้งคู่ ได้ 0
  }
  const sectionNote = mode === 'auto' && k1.length > 0 && !use1 && n1 > 0
    ? `ไม่ได้ตรวจข้อฝน: พบรอยฝนแค่ ${n1} ข้อ (ต้อง ${SECTION_MIN.part1} ข้อขึ้นไป) — ดูว่าเป็นรอยเปื้อนหรือนักเรียนทำจริง`
    : '';

  const pt1 = k1.length ? Number(key.w1 || 0) / k1.length : 0;
  const pt2 = k2.length ? Number(key.w2 || 0) / k2.length : 0;
  if (!use1) k1 = [];
  if (!use2) k2 = [];
  const tol = Math.max(Number(key.tol || 0), 1e-9);
  const details = [];
  let c1 = 0, c2 = 0;

  for (const [q, kv] of k1) {
    const stu = normPart1(answers.part1?.[q]);
    const ok = stu !== '' && !stu.includes(',') && stu === normPart1(kv);   // ฝนหลายวง = ผิด
    c1 += ok;
    details.push({ part_type: 'part1_mcq', question_no: Number(q), student_answer: stu, correct_answer: normPart1(kv), is_correct: ok ? 1 : 0 });
  }
  for (const [q, kv] of k2) {
    const stu = normPart2(answers.part2?.[q]);
    const ok = stu !== '' && stu !== null && Math.abs(Number(stu) - Number(normPart2(kv))) <= tol;
    c2 += ok;
    details.push({ part_type: 'part2_numeric', question_no: Number(q), student_answer: stu ?? String(answers.part2?.[q] ?? ''),
      correct_answer: normPart2(kv), is_correct: ok ? 1 : 0 });
  }
  const p1 = round2(c1 * pt1), p2 = round2(c2 * pt2);
  const full = round2((use1 ? Number(key.w1 || 0) : 0) + (use2 ? Number(key.w2 || 0) : 0));
  return { p1, p2, total: round2(p1 + p2), full, p1Graded: use1, p2Graded: use2, sectionNote,
    p1Correct: c1, p1Count: k1.length, p2Correct: c2, p2Count: k2.length, details };
}
