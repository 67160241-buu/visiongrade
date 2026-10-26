// =====================================================================
// config.js — ค่าตั้งค่าทั้งหมดอยู่ที่ไฟล์นี้ไฟล์เดียว
// =====================================================================
export const CONFIG = {
  // ไลบรารีจาก CDN (โหลดอัตโนมัติตอนตรวจแผ่นแรก)
  LIBS: {
    opencv: 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js',
    ort: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.js',
    ortWasmBase: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/',
  },

  // รายการโมเดล (วางไฟล์ .onnx ไว้ในโฟลเดอร์ models/ — ดู docs/MODEL_TH.md)
  MODEL_MANIFEST: 'models/models.json',

  WARP_SCALE: 0.5,         // ภาพหลังปรับระนาบ = template x 0.5 = 1240 x 1754 px (ตรงกับ SCALE ใน notebook)
  CROP_SIZE: 32,           // ขนาดภาพที่ป้อนเข้าโมเดล (CROP ใน notebook)
  FILL_THR: 0.5,           // p(ฝน) > ค่านี้ = ฝน
  REVIEW_BAND: [0.2, 0.8], // p(ฝน) อยู่ในช่วงนี้ = ไม่แน่ใจ -> ให้ครูตรวจทาน
  DIGIT_CONF: 0.7,         // ความมั่นใจตัวเลขต่ำกว่านี้ -> ให้ครูตรวจทาน
  ID_LENGTHS: { student_id: 13, subject_code: 11, school_code: 10 },
};
