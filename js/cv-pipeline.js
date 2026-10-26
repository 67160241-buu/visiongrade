// =====================================================================
// cv-pipeline.js — หัวใจของระบบตรวจ (ทำงานในเบราว์เซอร์ทั้งหมด)
//
//  รูปถ่าย/สแกน ─► [1] หา Fiducial Markers (สี่เหลี่ยมดำมุมล่างซ้าย/ขวา + กล่อง "4")
//               ─► [2] Perspective Warp ให้ตรงระนาบ template (1240 x 1754 px)
//               ─► [3] Refine ด้วย Timing Tracks (ขีดซ้าย 15 + แท่งล่าง 20) -> Homography
//               ─► [4] ตัดภาพ ROI (Crop) ทุกวงกลม/ทุกช่องตัวเลข เป็น 32x32
//               ─► [5] runInference() ส่งเข้าโมเดล ONNX (ONNX Runtime Web)
//               ─► [6] แปลง Output ของโมเดลเป็นคำตอบ (Part 1, Part 2, รหัสต่าง ๆ)
//
//  ขั้นตอน/ค่าคงที่ทั้งหมดตรงกับ notebook omr_v2 (align, crops_from, Reader.read)
//  เพื่อให้โมเดลที่ train จาก notebook ใช้ในเว็บได้ทันทีโดยไม่ต้อง train ใหม่
// =====================================================================
import { CONFIG } from './config.js';

// ---------------------------------------------------------------------
// พิกัดสัดส่วนสัมพัทธ์ (Normalized 0..1) ของ Template No. 4
// x = pixel_x / ความกว้าง template, y = pixel_y / ความสูง template
// วัดจาก template4_1.jpg (2480 x 3508) ด้วย notebook -> layout.json
// ---------------------------------------------------------------------
// <TEMPLATE4-DATA>  (สร้างอัตโนมัติจาก layout.json ของ notebook — อย่าแก้ด้วยมือ)
export const TEMPLATE4 = {
  code: 'TEMPLATE_4', name: 'กระดาษคำตอบหลายตัวเลือก (Template No. 4)',
  refWidth: 2480, refHeight: 3508,            // ขนาดภาพ template ต้นฉบับ (A4 @300dpi)
  // จุด Alignment: สี่เหลี่ยมทึบดำ มุมล่างซ้าย (BL) / ล่างขวา (BR) + กล่องเลข "4" มุมขวาบน (TR)
  markers: { BL: [0.07177, 0.94997], BR: [0.93024, 0.94997], TR: [0.93004, 0.05003], size: 0.06062 },
  // Timing tracks: ขีดดำด้านซ้าย 15 ขีด (แถวข้อ 1-15) และแท่งดำด้านล่าง 20 แท่ง (คอลัมน์ตัวเลือก)
  timingLeft: [[0.05403, 0.2671], [0.05403, 0.29418], [0.05403, 0.32127], [0.05403, 0.34835], [0.05403, 0.37657], [0.05403, 0.41078], [0.05403, 0.43786], [0.05403, 0.46494], [0.05403, 0.49202], [0.05403, 0.52024], [0.05403, 0.55359], [0.05403, 0.58067], [0.05403, 0.60775], [0.05403, 0.63483], [0.05403, 0.66306]],
  timingBottom: [[0.11573, 0.68643], [0.15323, 0.68643], [0.18952, 0.68643], [0.22702, 0.68672], [0.26371, 0.68643], [0.32903, 0.68643], [0.36613, 0.68643], [0.40363, 0.68643], [0.44032, 0.68643], [0.47702, 0.68643], [0.54113, 0.68615], [0.57863, 0.68615], [0.61613, 0.68615], [0.65323, 0.68643], [0.68952, 0.68615], [0.75403, 0.68643], [0.79153, 0.68643], [0.82823, 0.68643], [0.86573, 0.68672], [0.90161, 0.68643]],
  bubbleRadius: 0.01391, smallBubbleRadius: 0.01048,   // รัศมีวงกลม (สัดส่วนของความกว้าง)
  // ส่วนหัว: ชุดกระดาษคำถาม (1,2,3) และ หน้ากระดาษคำตอบ (1,2) — จุดศูนย์กลางวงกลม
  qset: [[0.10161, 0.20582], [0.13468, 0.2061], [0.16734, 0.20582]],
  page: [[0.28387, 0.20525], [0.31613, 0.20553]],
  // ช่องตาราง [x0,y0,x1,y1] ของรหัสประจำตัว / รหัสวิชา / รหัสสถานศึกษา (บนกระดาษพิมพ์ไว้ 14 ช่องต่อแถว)
  idFields: {
    student_id: [[0.40645, 0.09464, 0.44087, 0.12058], [0.44087, 0.09464, 0.47529, 0.12058], [0.47529, 0.09464, 0.50971, 0.12058], [0.50971, 0.09464, 0.54412, 0.12058], [0.54412, 0.09464, 0.57854, 0.12058], [0.57854, 0.09464, 0.61296, 0.12058], [0.61296, 0.09464, 0.64738, 0.12058], [0.64738, 0.09464, 0.6818, 0.12058], [0.6818, 0.09464, 0.71622, 0.12058], [0.71622, 0.09464, 0.75063, 0.12058], [0.75063, 0.09464, 0.78505, 0.12058], [0.78505, 0.09464, 0.81947, 0.12058], [0.81947, 0.09464, 0.85389, 0.12058], [0.85389, 0.09464, 0.88831, 0.12058]],
    subject_code: [[0.40645, 0.15251, 0.44087, 0.17845], [0.44087, 0.15251, 0.47529, 0.17845], [0.47529, 0.15251, 0.50971, 0.17845], [0.50971, 0.15251, 0.54412, 0.17845], [0.54412, 0.15251, 0.57854, 0.17845], [0.57854, 0.15251, 0.61296, 0.17845], [0.61296, 0.15251, 0.64738, 0.17845], [0.64738, 0.15251, 0.6818, 0.17845], [0.6818, 0.15251, 0.71622, 0.17845], [0.71622, 0.15251, 0.75063, 0.17845], [0.75063, 0.15251, 0.78505, 0.17845], [0.78505, 0.15251, 0.81947, 0.17845], [0.81947, 0.15251, 0.85389, 0.17845], [0.85389, 0.15251, 0.88831, 0.17845]],
    school_code: [[0.40645, 0.2118, 0.44087, 0.23774], [0.44087, 0.2118, 0.47529, 0.23774], [0.47529, 0.2118, 0.50971, 0.23774], [0.50971, 0.2118, 0.54412, 0.23774], [0.54412, 0.2118, 0.57854, 0.23774], [0.57854, 0.2118, 0.61296, 0.23774], [0.61296, 0.2118, 0.64738, 0.23774], [0.64738, 0.2118, 0.6818, 0.23774], [0.6818, 0.2118, 0.71622, 0.23774], [0.71622, 0.2118, 0.75063, 0.23774], [0.75063, 0.2118, 0.78505, 0.23774], [0.78505, 0.2118, 0.81947, 0.23774], [0.81947, 0.2118, 0.85389, 0.23774], [0.85389, 0.2118, 0.88831, 0.23774]],
  },
  // Part 1: ข้อ 1-60, ข้อละ 5 วง (ตัวเลือก 1..5) — จุดศูนย์กลาง [x,y]
  part1: {
    1: [[0.11472, 0.26782], [0.15181, 0.26782], [0.18891, 0.26782], [0.22641, 0.26782], [0.2631, 0.26782]],
    2: [[0.11472, 0.29461], [0.15181, 0.29461], [0.18891, 0.29461], [0.22641, 0.29461], [0.2631, 0.29461]],
    3: [[0.11472, 0.32198], [0.15181, 0.32198], [0.18891, 0.32198], [0.22641, 0.32198], [0.2631, 0.32198]],
    4: [[0.11472, 0.34877], [0.15181, 0.34877], [0.18891, 0.34877], [0.22641, 0.34877], [0.2631, 0.34877]],
    5: [[0.11472, 0.37643], [0.15181, 0.37643], [0.18891, 0.37643], [0.22641, 0.37643], [0.2631, 0.37643]],
    6: [[0.11431, 0.4112], [0.15141, 0.4112], [0.18851, 0.4112], [0.22601, 0.4112], [0.2627, 0.4112]],
    7: [[0.11431, 0.438], [0.15141, 0.438], [0.18851, 0.438], [0.22601, 0.438], [0.2627, 0.438]],
    8: [[0.11472, 0.46536], [0.15181, 0.46536], [0.18891, 0.46536], [0.22641, 0.46536], [0.2631, 0.46536]],
    9: [[0.11472, 0.49245], [0.15181, 0.49245], [0.18891, 0.49245], [0.22641, 0.49245], [0.2631, 0.49245]],
    10: [[0.11431, 0.5201], [0.15141, 0.5201], [0.18851, 0.5201], [0.22601, 0.5201], [0.2627, 0.5201]],
    11: [[0.11472, 0.55459], [0.15181, 0.55459], [0.18891, 0.55459], [0.22641, 0.55459], [0.2631, 0.55459]],
    12: [[0.11472, 0.58139], [0.15181, 0.58139], [0.18891, 0.58139], [0.22641, 0.58139], [0.2631, 0.58139]],
    13: [[0.11472, 0.60904], [0.15181, 0.60904], [0.18891, 0.60904], [0.22641, 0.60904], [0.2631, 0.60904]],
    14: [[0.11472, 0.63583], [0.15181, 0.63583], [0.18891, 0.63583], [0.22641, 0.63583], [0.2631, 0.63583]],
    15: [[0.11472, 0.66348], [0.15181, 0.66348], [0.18891, 0.66348], [0.22641, 0.66348], [0.2631, 0.66348]],
    16: [[0.32802, 0.26753], [0.36512, 0.26753], [0.40222, 0.26753], [0.43972, 0.26753], [0.47641, 0.26753]],
    17: [[0.32802, 0.29433], [0.36512, 0.29433], [0.40222, 0.29433], [0.43972, 0.29433], [0.47641, 0.29433]],
    18: [[0.32802, 0.32198], [0.36512, 0.32198], [0.40222, 0.32198], [0.43972, 0.32198], [0.47641, 0.32198]],
    19: [[0.32802, 0.34877], [0.36512, 0.34877], [0.40222, 0.34877], [0.43972, 0.34877], [0.47641, 0.34877]],
    20: [[0.32802, 0.37643], [0.36512, 0.37643], [0.40222, 0.37643], [0.43972, 0.37643], [0.47641, 0.37643]],
    21: [[0.32762, 0.41092], [0.36472, 0.41092], [0.40181, 0.41092], [0.43972, 0.41092], [0.47641, 0.41092]],
    22: [[0.32762, 0.438], [0.36472, 0.438], [0.40181, 0.438], [0.43972, 0.438], [0.47641, 0.438]],
    23: [[0.32802, 0.46536], [0.36512, 0.46536], [0.40222, 0.46536], [0.43972, 0.46536], [0.47641, 0.46536]],
    24: [[0.32802, 0.49216], [0.36512, 0.49216], [0.40222, 0.49216], [0.43972, 0.49216], [0.47641, 0.49216]],
    25: [[0.32762, 0.51981], [0.36472, 0.51981], [0.40181, 0.51981], [0.43972, 0.51981], [0.47641, 0.51981]],
    26: [[0.32802, 0.55459], [0.36512, 0.55459], [0.40222, 0.55459], [0.43972, 0.55459], [0.47641, 0.55459]],
    27: [[0.32802, 0.58139], [0.36512, 0.58139], [0.40222, 0.58139], [0.43972, 0.58139], [0.47641, 0.58139]],
    28: [[0.32802, 0.60904], [0.36512, 0.60904], [0.40222, 0.60904], [0.44012, 0.60904], [0.47681, 0.60904]],
    29: [[0.32802, 0.63583], [0.36512, 0.63583], [0.40222, 0.63583], [0.44012, 0.63583], [0.47681, 0.63583]],
    30: [[0.32802, 0.66348], [0.36512, 0.66348], [0.40222, 0.66348], [0.43972, 0.66348], [0.47641, 0.66348]],
    31: [[0.54052, 0.26753], [0.57762, 0.26753], [0.61472, 0.26753], [0.65222, 0.26753], [0.68891, 0.26753]],
    32: [[0.54052, 0.29433], [0.57762, 0.29433], [0.61472, 0.29433], [0.65222, 0.29433], [0.68891, 0.29433]],
    33: [[0.54052, 0.32198], [0.57762, 0.32198], [0.61472, 0.32198], [0.65222, 0.32198], [0.68891, 0.32198]],
    34: [[0.54052, 0.34877], [0.57762, 0.34877], [0.61472, 0.34877], [0.65222, 0.34877], [0.68891, 0.34877]],
    35: [[0.54052, 0.37643], [0.57762, 0.37643], [0.61472, 0.37643], [0.65222, 0.37643], [0.68891, 0.37643]],
    36: [[0.54012, 0.41092], [0.57722, 0.41092], [0.61431, 0.41092], [0.65222, 0.41092], [0.68891, 0.41092]],
    37: [[0.54012, 0.438], [0.57722, 0.438], [0.61431, 0.438], [0.65222, 0.438], [0.68891, 0.438]],
    38: [[0.54052, 0.46536], [0.57762, 0.46536], [0.61472, 0.46536], [0.65222, 0.46536], [0.68891, 0.46536]],
    39: [[0.54052, 0.49216], [0.57762, 0.49216], [0.61472, 0.49216], [0.65222, 0.49216], [0.68891, 0.49216]],
    40: [[0.54012, 0.51981], [0.57722, 0.51981], [0.61431, 0.51981], [0.65222, 0.51981], [0.68891, 0.51981]],
    41: [[0.54052, 0.55459], [0.57762, 0.55459], [0.61472, 0.55459], [0.65222, 0.55459], [0.68891, 0.55459]],
    42: [[0.54052, 0.58139], [0.57762, 0.58139], [0.61472, 0.58139], [0.65222, 0.58139], [0.68891, 0.58139]],
    43: [[0.54052, 0.60904], [0.57762, 0.60904], [0.61472, 0.60904], [0.65262, 0.60904], [0.68931, 0.60904]],
    44: [[0.54052, 0.63583], [0.57762, 0.63583], [0.61472, 0.63583], [0.65262, 0.63583], [0.68931, 0.63583]],
    45: [[0.54052, 0.66348], [0.57762, 0.66348], [0.61472, 0.66348], [0.65222, 0.66348], [0.68891, 0.66348]],
    46: [[0.75302, 0.26753], [0.79012, 0.26753], [0.82722, 0.26753], [0.86472, 0.26753], [0.90141, 0.26753]],
    47: [[0.75302, 0.29433], [0.79012, 0.29433], [0.82722, 0.29433], [0.86472, 0.29433], [0.90141, 0.29433]],
    48: [[0.75302, 0.32198], [0.79012, 0.32198], [0.82722, 0.32198], [0.86472, 0.32198], [0.90141, 0.32198]],
    49: [[0.75302, 0.34877], [0.79012, 0.34877], [0.82722, 0.34877], [0.86472, 0.34877], [0.90141, 0.34877]],
    50: [[0.75302, 0.37643], [0.79012, 0.37643], [0.82722, 0.37643], [0.86472, 0.37643], [0.90141, 0.37643]],
    51: [[0.75262, 0.41092], [0.78972, 0.41092], [0.82681, 0.41092], [0.86472, 0.41092], [0.90141, 0.41092]],
    52: [[0.75262, 0.438], [0.78972, 0.438], [0.82681, 0.438], [0.86472, 0.438], [0.90141, 0.438]],
    53: [[0.75302, 0.46536], [0.79012, 0.46536], [0.82722, 0.46536], [0.86472, 0.46536], [0.90141, 0.46536]],
    54: [[0.75302, 0.49216], [0.79012, 0.49216], [0.82722, 0.49216], [0.86472, 0.49216], [0.90141, 0.49216]],
    55: [[0.75262, 0.51981], [0.78972, 0.51981], [0.82681, 0.51981], [0.86472, 0.51981], [0.90141, 0.51981]],
    56: [[0.75302, 0.55459], [0.79012, 0.55459], [0.82722, 0.55459], [0.86472, 0.55459], [0.90141, 0.55459]],
    57: [[0.75302, 0.58139], [0.79012, 0.58139], [0.82722, 0.58139], [0.86472, 0.58139], [0.90141, 0.58139]],
    58: [[0.75302, 0.60904], [0.79012, 0.60904], [0.82722, 0.60904], [0.86512, 0.60904], [0.90181, 0.60904]],
    59: [[0.75302, 0.63583], [0.79012, 0.63583], [0.82722, 0.63583], [0.86512, 0.63583], [0.90181, 0.63583]],
    60: [[0.75302, 0.66348], [0.79012, 0.66348], [0.82722, 0.66348], [0.86472, 0.66348], [0.90141, 0.66348]],
  },
  // Part 2: ข้อ 1-10, ข้อละ 10 ช่อง [x0,y0,x1,y1]; ช่อง index 6 (ช่องที่ 7 สีเทา) คือจุดทศนิยม
  decimalIndex: 6,
  part2: {
    1: [[0.12177, 0.71066, 0.15617, 0.7366], [0.15617, 0.71066, 0.19056, 0.7366], [0.19056, 0.71066, 0.22496, 0.7366], [0.22496, 0.71066, 0.25935, 0.7366], [0.25935, 0.71066, 0.29375, 0.7366], [0.29375, 0.71066, 0.32815, 0.7366], [0.32815, 0.71066, 0.36254, 0.7366], [0.36254, 0.71066, 0.39694, 0.7366], [0.39694, 0.71066, 0.43133, 0.7366], [0.43133, 0.71066, 0.46573, 0.7366]],
    2: [[0.12218, 0.75399, 0.15657, 0.77993], [0.15657, 0.75399, 0.19097, 0.77993], [0.19097, 0.75399, 0.22536, 0.77993], [0.22536, 0.75399, 0.25976, 0.77993], [0.25976, 0.75399, 0.29415, 0.77993], [0.29415, 0.75399, 0.32855, 0.77993], [0.32855, 0.75399, 0.36294, 0.77993], [0.36294, 0.75399, 0.39734, 0.77993], [0.39734, 0.75399, 0.43173, 0.77993], [0.43173, 0.75399, 0.46613, 0.77993]],
    3: [[0.12339, 0.79875, 0.15778, 0.82469], [0.15778, 0.79875, 0.19218, 0.82469], [0.19218, 0.79875, 0.22657, 0.82469], [0.22657, 0.79875, 0.26097, 0.82469], [0.26097, 0.79875, 0.29536, 0.82469], [0.29536, 0.79875, 0.32976, 0.82469], [0.32976, 0.79875, 0.36415, 0.82469], [0.36415, 0.79875, 0.39855, 0.82469], [0.39855, 0.79875, 0.43294, 0.82469], [0.43294, 0.79875, 0.46734, 0.82469]],
    4: [[0.12298, 0.8435, 0.15738, 0.86944], [0.15738, 0.8435, 0.19177, 0.86944], [0.19177, 0.8435, 0.22617, 0.86944], [0.22617, 0.8435, 0.26056, 0.86944], [0.26056, 0.8435, 0.29496, 0.86944], [0.29496, 0.8435, 0.32935, 0.86944], [0.32935, 0.8435, 0.36375, 0.86944], [0.36375, 0.8435, 0.39815, 0.86944], [0.39815, 0.8435, 0.43254, 0.86944], [0.43254, 0.8435, 0.46694, 0.86944]],
    5: [[0.12298, 0.8874, 0.15738, 0.91334], [0.15738, 0.8874, 0.19177, 0.91334], [0.19177, 0.8874, 0.22617, 0.91334], [0.22617, 0.8874, 0.26056, 0.91334], [0.26056, 0.8874, 0.29496, 0.91334], [0.29496, 0.8874, 0.32935, 0.91334], [0.32935, 0.8874, 0.36375, 0.91334], [0.36375, 0.8874, 0.39815, 0.91334], [0.39815, 0.8874, 0.43254, 0.91334], [0.43254, 0.8874, 0.46694, 0.91334]],
    6: [[0.55565, 0.71066, 0.59004, 0.7366], [0.59004, 0.71066, 0.62444, 0.7366], [0.62444, 0.71066, 0.65883, 0.7366], [0.65883, 0.71066, 0.69323, 0.7366], [0.69323, 0.71066, 0.72762, 0.7366], [0.72762, 0.71066, 0.76202, 0.7366], [0.76202, 0.71066, 0.79641, 0.7366], [0.79641, 0.71066, 0.83081, 0.7366], [0.83081, 0.71066, 0.8652, 0.7366], [0.8652, 0.71066, 0.8996, 0.7366]],
    7: [[0.55605, 0.75399, 0.59044, 0.77993], [0.59044, 0.75399, 0.62484, 0.77993], [0.62484, 0.75399, 0.65923, 0.77993], [0.65923, 0.75399, 0.69363, 0.77993], [0.69363, 0.75399, 0.72802, 0.77993], [0.72802, 0.75399, 0.76242, 0.77993], [0.76242, 0.75399, 0.79681, 0.77993], [0.79681, 0.75399, 0.83121, 0.77993], [0.83121, 0.75399, 0.8656, 0.77993], [0.8656, 0.75399, 0.9, 0.77993]],
    8: [[0.55726, 0.79875, 0.59165, 0.82469], [0.59165, 0.79875, 0.62605, 0.82469], [0.62605, 0.79875, 0.66044, 0.82469], [0.66044, 0.79875, 0.69484, 0.82469], [0.69484, 0.79875, 0.72923, 0.82469], [0.72923, 0.79875, 0.76363, 0.82469], [0.76363, 0.79875, 0.79802, 0.82469], [0.79802, 0.79875, 0.83242, 0.82469], [0.83242, 0.79875, 0.86681, 0.82469], [0.86681, 0.79875, 0.90121, 0.82469]],
    9: [[0.55685, 0.8435, 0.59125, 0.86944], [0.59125, 0.8435, 0.62565, 0.86944], [0.62565, 0.8435, 0.66004, 0.86944], [0.66004, 0.8435, 0.69444, 0.86944], [0.69444, 0.8435, 0.72883, 0.86944], [0.72883, 0.8435, 0.76323, 0.86944], [0.76323, 0.8435, 0.79762, 0.86944], [0.79762, 0.8435, 0.83202, 0.86944], [0.83202, 0.8435, 0.86641, 0.86944], [0.86641, 0.8435, 0.90081, 0.86944]],
    10: [[0.55685, 0.8874, 0.59125, 0.91334], [0.59125, 0.8874, 0.62565, 0.91334], [0.62565, 0.8874, 0.66004, 0.91334], [0.66004, 0.8874, 0.69444, 0.91334], [0.69444, 0.8874, 0.72883, 0.91334], [0.72883, 0.8874, 0.76323, 0.91334], [0.76323, 0.8874, 0.79762, 0.91334], [0.79762, 0.8874, 0.83202, 0.91334], [0.83202, 0.8874, 0.86641, 0.91334], [0.86641, 0.8874, 0.90081, 0.91334]],
  },
  // โซน ROI รวม (Normalized Bounding Boxes) ใช้ตัดภาพ/แสดงผล/ปรับเทียบในหน้า Admin
  zones: {
    marker_BL: [0.04147, 0.92854, 0.10208, 0.9714],
    marker_BR: [0.89993, 0.92854, 0.96055, 0.9714],
    marker_TR: [0.89973, 0.0286, 0.96035, 0.07146],
    student_id: [0.40484, 0.0935, 0.88992, 0.12172],
    subject_code: [0.40484, 0.15137, 0.88992, 0.17959],
    school_code: [0.40484, 0.21066, 0.88992, 0.23888],
    qset: [0.08548, 0.19441, 0.18347, 0.2175],
    page: [0.26774, 0.19384, 0.33226, 0.21693],
    part1: [0.09395, 0.25314, 0.92218, 0.67788],
    part1_col1: [0.09556, 0.25456, 0.28185, 0.67674],
    part1_col2: [0.30887, 0.25428, 0.49556, 0.67674],
    part1_col3: [0.52137, 0.25428, 0.70806, 0.67674],
    part1_col4: [0.73387, 0.25428, 0.92056, 0.67674],
    part2: [0.11855, 0.70838, 0.90444, 0.91562],
    timing_left: [0.03871, 0.26197, 0.06935, 0.66819],
    timing_bottom: [0.10847, 0.67531, 0.90887, 0.69755],
  },
};
// </TEMPLATE4-DATA>

export const MODEL_CLASSES = {
  bubble: ['empty', 'filled'],
  digit: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'blank'],
};
const BLANK = 10;              // index ของคลาส "ช่องว่าง" ในโมเดลตัวเลข
const DIGIT_CH = [...'0123456789', '_'];

export class AlignError extends Error {}

// =====================================================================
// 0) Layout / Calibration (หน้า Admin ปรับได้)
// =====================================================================
let LAYOUT = TEMPLATE4;
let CALIB = { dx: 0, dy: 0, sx: 1, sy: 1 };
let GEOM = null;

export function setTemplateLayout(layout) { LAYOUT = layout || TEMPLATE4; GEOM = null; }
export function getTemplateLayout() { return LAYOUT; }
export function setCalibration(c) { CALIB = { dx: 0, dy: 0, sx: 1, sy: 1, ...(c || {}) }; GEOM = null; }
export function getCalibration() { return { ...CALIB }; }

/** แปลง layout.json (pixel) จาก notebook ให้เป็นรูปแบบ normalized แบบ TEMPLATE4 */
export function layoutFromPixelJson(L) {
  const W = L.width, H = L.height;
  const pt = (p) => [p[0] / W, p[1] / H];
  const bx = (b) => [b[0] / W, b[1] / H, b[2] / W, b[3] / H];
  const part1 = {}; for (const q of Object.keys(L.questions)) part1[q] = L.questions[q].map(pt);
  const part2 = {}; for (const q of Object.keys(L.numeric)) part2[q] = L.numeric[q].map(bx);
  const idFields = {}; for (const k of Object.keys(L.id_fields)) idFields[k] = L.id_fields[k].map(bx);
  return {
    ...TEMPLATE4, refWidth: W, refHeight: H,
    markers: { BL: pt(L.squares.BL), BR: pt(L.squares.BR), TR: pt(L.squares.TR), size: L.squares.size / W },
    timingLeft: L.timing_left.map(pt), timingBottom: L.timing_bottom.map(pt),
    bubbleRadius: L.bubble_radius / W, smallBubbleRadius: L.small_bubble_radius / W,
    qset: L.qset.map(pt), page: L.page.map(pt), idFields, part1, part2, decimalIndex: L.decimal_index,
  };
}

export function outSize() {
  return { W: Math.round(LAYOUT.refWidth * CONFIG.WARP_SCALE), H: Math.round(LAYOUT.refHeight * CONFIG.WARP_SCALE) };
}

// calibration ใช้กับ ROI เท่านั้น (ไม่ใช้กับ marker/timing ที่ใช้ปรับระนาบ)
const calX = (x) => (x - 0.5) * CALIB.sx + 0.5 + CALIB.dx;
const calY = (y) => (y - 0.5) * CALIB.sy + 0.5 + CALIB.dy;

/** พิกัด pixel บนภาพที่ปรับระนาบแล้ว (W x H) ของทุก ROI */
export function getGeometry() {
  if (GEOM) return GEOM;
  const { W, H } = outSize();
  const P = ([x, y]) => [calX(x) * W, calY(y) * H];
  const Bx = ([x0, y0, x1, y1]) => [calX(x0) * W, calY(y0) * H, calX(x1) * W, calY(y1) * H];
  const raw = ([x, y]) => [x * W, y * H];
  const bubbles = [];
  const half = LAYOUT.bubbleRadius * W * 1.3 * CALIB.sx;
  const halfS = LAYOUT.smallBubbleRadius * W * 1.3 * CALIB.sx;
  const qs = Object.keys(LAYOUT.part1).map(Number).sort((a, b) => a - b);
  for (const q of qs) {
    LAYOUT.part1[q].forEach((p, k) => { const [x, y] = P(p); bubbles.push({ kind: 'mc', q, opt: k + 1, x, y, half }); });
  }
  LAYOUT.qset.forEach((p, k) => { const [x, y] = P(p); bubbles.push({ kind: 'qset', q: null, opt: k + 1, x, y, half: halfS }); });
  LAYOUT.page.forEach((p, k) => { const [x, y] = P(p); bubbles.push({ kind: 'page', q: null, opt: k + 1, x, y, half: halfS }); });

  const cells = [];
  const addCell = (kind, field, idx, b) => {
    const box = Bx(b);
    cells.push({ kind, field, idx, box, x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2,
      half: Math.max(box[2] - box[0], box[3] - box[1]) / 2 * 0.95 });
  };
  for (const f of Object.keys(LAYOUT.idFields)) LAYOUT.idFields[f].forEach((b, i) => addCell('id', f, i, b));
  const nq = Object.keys(LAYOUT.part2).map(Number).sort((a, b) => a - b);
  for (const q of nq) LAYOUT.part2[q].forEach((b, i) => { if (i !== LAYOUT.decimalIndex) addCell('num', q, i, b); });

  const zones = {}; for (const [k, b] of Object.entries(LAYOUT.zones || {})) zones[k] = Bx(b);
  const part2Rows = {}; for (const q of nq) {
    const bs = LAYOUT.part2[q].map(Bx);
    part2Rows[q] = [bs[0][0], Math.min(...bs.map((b) => b[1])), bs[bs.length - 1][2], Math.max(...bs.map((b) => b[3]))];
  }
  GEOM = {
    W, H, bubbles, cells, zones, part2Rows,
    anchors: {
      TR: raw(LAYOUT.markers.TR), BL: raw(LAYOUT.markers.BL), BR: raw(LAYOUT.markers.BR),
      size: LAYOUT.markers.size * W,
      timingLeft: LAYOUT.timingLeft.map(raw), timingBottom: LAYOUT.timingBottom.map(raw),
    },
  };
  return GEOM;
}

// =====================================================================
// 1) โหลดไลบรารี (OpenCV.js / ONNX Runtime Web) แบบ lazy
// =====================================================================
const _scripts = {};
export function loadScript(url) {
  if (!_scripts[url]) {
    _scripts[url] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = () => resolve(); s.onerror = () => { delete _scripts[url]; reject(new Error('โหลดไม่สำเร็จ: ' + url)); };
      document.head.appendChild(s);
    });
  }
  return _scripts[url];
}

let _cvPromise = null;
/** โหลด OpenCV.js แล้วคืน cv (ห่อใน object เพราะ cv มี .then ทำให้ await วนไม่จบ) */
export function loadOpenCV() {
  if (_cvPromise) return _cvPromise;
  _cvPromise = (async () => {
    if (!(window.cv && window.cv.Mat)) {
      await loadScript(CONFIG.LIBS.opencv);
      await new Promise((resolve, reject) => {
        const t0 = Date.now();
        const tick = () => {
          const c = window.cv;
          if (c && c.Mat) return resolve();
          if (c instanceof Promise && !c.__vg) { c.__vg = 1; c.then((m) => { if (m && typeof m.then === 'function') delete m.then; window.cv = m; }); }
          if (Date.now() - t0 > 90000) return reject(new Error('OpenCV.js โหลดไม่สำเร็จ (หมดเวลา)'));
          setTimeout(tick, 50);
        };
        tick();
      });
    }
    if (typeof window.cv.then === 'function') delete window.cv.then;
    return { cv: window.cv };
  })();
  _cvPromise.catch(() => { _cvPromise = null; });
  return _cvPromise;
}

let _ortPromise = null;
export function loadORT() {
  if (_ortPromise) return _ortPromise;
  _ortPromise = (async () => {
    if (!window.ort) await loadScript(CONFIG.LIBS.ort);
    window.ort.env.wasm.wasmPaths = CONFIG.LIBS.ortWasmBase;
    if (!self.crossOriginIsolated) window.ort.env.wasm.numThreads = 1;   // Pages ปกติไม่มี COOP/COEP
    return window.ort;
  })();
  _ortPromise.catch(() => { _ortPromise = null; });
  return _ortPromise;
}

// =====================================================================
// 2) โหลดโมเดล (ONNX) ตาม public/models/models.json
// =====================================================================
const DEFAULT_MANIFEST = {
  models: {
    bubble: { file: 'bubble.onnx', enabled: true, input: 'image', output: 'logits', size: 32, classes: MODEL_CLASSES.bubble },
    digit: { file: 'digit.onnx', enabled: true, input: 'image', output: 'logits', size: 32, classes: MODEL_CLASSES.digit },
    yolo: { file: 'yolo.onnx', enabled: false, imgsz: 1024, conf: 0.25, classes: ['marker', 'student_id', 'subject_code', 'school_code', 'qset', 'page', 'mc_block', 'numeric_row'] },
  },
};
let _manifest = null;
const _sessions = {};      // kind -> InferenceSession | null
const _modelStatus = {};   // kind -> {state:'ready'|'missing'|'disabled'|'error', message}

export async function loadModelManifest() {
  if (_manifest) return _manifest;
  try {
    const r = await fetch(CONFIG.MODEL_MANIFEST, { cache: 'no-cache' });
    const j = r.ok && (r.headers.get('content-type') || '').includes('json') ? await r.json() : null;
    _manifest = j && j.models ? { models: { ...DEFAULT_MANIFEST.models, ...j.models } } : DEFAULT_MANIFEST;
  } catch { _manifest = DEFAULT_MANIFEST; }
  return _manifest;
}

async function getSession(kind) {
  if (kind in _sessions) return _sessions[kind];
  const man = await loadModelManifest();
  const m = man.models[kind];
  if (!m || !m.enabled) { _modelStatus[kind] = { state: 'disabled' }; return (_sessions[kind] = null); }
  try {
    const url = new URL(m.file, new URL(CONFIG.MODEL_MANIFEST, location.href)).href;
    const r = await fetch(url);
    const buf = r.ok ? await r.arrayBuffer() : null;
    // Cloudflare Pages อาจตอบหน้า HTML แทนไฟล์ที่ไม่มี -> ตรวจว่าไม่ใช่ HTML
    const head = buf ? new TextDecoder().decode(new Uint8Array(buf.slice(0, 64))).trimStart().toLowerCase() : '';
    if (!buf || buf.byteLength < 100 || head.startsWith('<!doctype') || head.startsWith('<html')) {
      _modelStatus[kind] = { state: 'missing', message: `ไม่พบไฟล์ ${m.file} ใน public/models/` };
      return (_sessions[kind] = null);
    }
    const ort = await loadORT();
    const sess = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    sess._vg = m;
    _modelStatus[kind] = { state: 'ready', message: `${m.file} (${(buf.byteLength / 1024).toFixed(0)} KB) inputs=${sess.inputNames} outputs=${sess.outputNames}` };
    return (_sessions[kind] = sess);
  } catch (e) {
    console.error('[model]', kind, e);
    _modelStatus[kind] = { state: 'error', message: String(e.message || e) };
    return (_sessions[kind] = null);
  }
}

/** สถานะโมเดลทั้งหมด (แสดงในหน้าเว็บ) */
export async function getModelStatus() {
  await Promise.all(['bubble', 'digit', 'yolo'].map(getSession));
  return { mode: 'browser', bubble: _modelStatus.bubble, digit: _modelStatus.digit, yolo: _modelStatus.yolo };
}

/** ล้าง cache โมเดล (ใช้หลังวางไฟล์ใหม่) */
export function resetModels() { for (const k of Object.keys(_sessions)) delete _sessions[k]; _manifest = null; }

// =====================================================================
// 3) จุดเชื่อมต่อโมเดล: runInference(croppedImage)
// =====================================================================
/**
 * ส่งภาพที่ตัดแล้ว (ROI) เข้าโมเดล แล้วคืน "ความน่าจะเป็นของแต่ละคลาส"
 *
 * @param croppedImage  ภาพที่ตัดแล้ว รับได้ 3 แบบ
 *        (ก) CropBatch  {data: Float32Array(N*S*S), n: N, size: S}  ← ที่ pipeline ใช้ (เร็วสุด ส่งทีเดียวทั้งใบ)
 *        (ข) ImageData / HTMLCanvasElement ขนาดใดก็ได้ (จะถูกย่อเป็น S x S และแปลงเป็นขาวดำ)
 *        (ค) Array ของ (ข)
 * @param kind  'bubble' (วงกลม 2 คลาส: empty/filled) | 'digit' (ตัวเลข 11 คลาส: 0-9, blank)
 * @returns Array<Float32Array>  probs[i][c] = ความน่าจะเป็นที่ภาพที่ i เป็นคลาส c
 *          หรือ null ถ้ายังไม่มีโมเดล (pipeline จะใช้วิธี image processing แทนสำหรับวงกลม)
 *
 * ขั้นตอนการแปลง Output ของโมเดลเป็นคำตอบ:
 *   1) เตรียม Tensor รูปร่าง [N, 1, 32, 32] ชนิด float32
 *      ค่า pixel = 1 - (ความสว่าง / 255)  → หมึกดำ = ค่าใกล้ 1, กระดาษขาว = ค่าใกล้ 0
 *      (ต้องตรงกับ to_tensor() ตอน train ใน notebook มิฉะนั้นโมเดลจะทายผิดทั้งหมด)
 *   2) session.run({image: tensor}) → ได้ "logits" รูปร่าง [N, C]  (C = 2 หรือ 11)
 *   3) softmax(logits) ต่อแถว → ความน่าจะเป็นรวมกันได้ 1
 *   4) แปลงเป็นคำตอบ (ทำใน decodeResults ด้านล่าง)
 *      - bubble: p_filled = probs[i][1]; ถ้า > 0.5 ถือว่าฝน
 *          • ข้อหนึ่งมี 5 วง → วงที่ p_filled > 0.5 คือคำตอบ (1..5)
 *          • ไม่มีวงไหนฝน = ไม่ตอบ (null), ฝนเกิน 1 วง = ตอบหลายข้อ (ผิด/ให้ครูตรวจ)
 *          • 0.2 < p_filled < 0.8 = ไม่แน่ใจ → ส่งเข้า "รายการต้องตรวจทาน"
 *      - digit: d = argmax(probs[i]); d = 0..9 คือเลขนั้น, d = 10 คือช่องว่าง
 *          • รหัส 13/11/10 หลัก = เอาเลขทุกช่องที่ไม่ว่างมาต่อกันซ้ายไปขวา
 *          • Part 2: ช่อง 1-6 = จำนวนเต็ม, ช่องที่ 7 = จุดทศนิยม (ไม่ต้องทาย), ช่อง 8-10 = ทศนิยม
 *            เช่น [_,_,_,_,1,2, . ,5,_,_] → "12.5"
 *          • ความมั่นใจ max(probs) < 0.7 → ส่งให้ครูตรวจ พร้อมตัวเลือกที่ 2
 */
export async function runInference(croppedImage, kind = 'bubble') {
  const batch = toCropBatch(croppedImage);
  if (!batch.n) return [];
  const C = MODEL_CLASSES[kind].length;

  // ---- รันโมเดลด้วย ONNX Runtime Web ในเบราว์เซอร์ ----
  const sess = await getSession(kind);
  if (!sess) return null;
  const ort = window.ort;
  const S = batch.size;
  const inName = sess.inputNames[0];
  const outName = sess.outputNames[0];

  const runChunk = async (start, count) => {
    // ขั้นที่ 1: Float32 tensor [count, 1, S, S]
    const t = new ort.Tensor('float32', batch.data.subarray(start * S * S, (start + count) * S * S), [count, 1, S, S]);
    // ขั้นที่ 2: รันโมเดล -> logits [count, C]
    const out = await sess.run({ [inName]: t });
    return out[outName].data;
  };
  let logits;
  try {
    logits = await runChunk(0, batch.n);                 // โมเดล export แบบ dynamic batch -> ส่งทีเดียว
  } catch (e) {
    logits = new Float32Array(batch.n * C);             // โมเดล batch=1 ตายตัว -> วนทีละภาพ
    for (let i = 0; i < batch.n; i++) logits.set(await runChunk(i, 1), i * C);
  }
  // ขั้นที่ 3: softmax ต่อแถว
  const probs = [];
  for (let i = 0; i < batch.n; i++) probs.push(softmax(logits.subarray(i * C, (i + 1) * C)));
  return probs;
}

function softmax(v) {
  let m = -Infinity; for (const x of v) m = Math.max(m, x);
  const e = Float32Array.from(v, (x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}


/** แปลงภาพแบบต่าง ๆ ให้เป็น CropBatch (S x S, ค่า 1 - pixel/255) */
export function toCropBatch(img, size = CONFIG.CROP_SIZE) {
  if (img && img.data instanceof Float32Array && typeof img.n === 'number') return img;
  const list = Array.isArray(img) ? img : [img];
  const data = new Float32Array(list.length * size * size);
  const cnv = document.createElement('canvas'); cnv.width = cnv.height = size;
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  list.forEach((im, n) => {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
    if (im instanceof ImageData) { const c2 = document.createElement('canvas'); c2.width = im.width; c2.height = im.height; c2.getContext('2d').putImageData(im, 0, 0); im = c2; }
    ctx.drawImage(im, 0, 0, size, size);
    const px = ctx.getImageData(0, 0, size, size).data;
    for (let k = 0; k < size * size; k++) {
      const g = 0.299 * px[k * 4] + 0.587 * px[k * 4 + 1] + 0.114 * px[k * 4 + 2];
      data[n * size * size + k] = 1 - g / 255;
    }
  });
  return { data, n: list.length, size };
}

// =====================================================================
// 4) Image Registration: หา Marker + Perspective Warp + Timing Tracks
// =====================================================================
const mm = (A, B) => {                       // คูณเมทริกซ์ 3x3 (array 9 ตัว row-major)
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return C;
};
const applyH = (H, [x, y]) => { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** ภาพ binary: pixel ที่ "มืดกว่ากระดาษรอบ ๆ มาก" (ทนต่อเงา/แสงไม่เท่ากัน) */
function darkMask(cv, gray, blurK, paperK, absThr, relThr) {
  const blur = new cv.Mat(); cv.GaussianBlur(gray, blur, new cv.Size(blurK, blurK), 0);
  const paper = new cv.Mat();
  const ker = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(paperK, paperK));
  cv.dilate(blur, paper, ker);
  const b = new cv.Mat(gray.rows, gray.cols, cv.CV_8UC1);
  const bd = b.data, pd = paper.data, gd = blur.data;
  for (let i = 0; i < bd.length; i++) { const d = pd[i] - gd[i]; bd[i] = d > absThr && d > relThr * pd[i] ? 255 : 0; }
  blur.delete(); paper.delete(); ker.delete();
  return b;
}

/** หา "สี่เหลี่ยมทึบดำ" ที่เป็นผู้สมัคร marker  → [{area, x, y}] (พิกัดภาพเต็ม) */
function squareCandidates(cv, gray) {
  const h = gray.rows, w = gray.cols;
  const scale = Math.min(1600 / Math.max(h, w), 1);
  const small = new cv.Mat();
  if (scale < 1) cv.resize(gray, small, new cv.Size(Math.round(w * scale), Math.round(h * scale)), 0, 0, cv.INTER_AREA);
  else gray.copyTo(small);
  const k = Math.floor(Math.max(small.rows, small.cols) / 12) | 1;
  const b = darkMask(cv, small, 5, k, 40, 0.4);
  const ker3 = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.morphologyEx(b, b, cv.MORPH_CLOSE, ker3);
  const contours = new cv.MatVector(), hier = new cv.Mat();
  cv.findContours(b, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
  const areaMin = small.rows * small.cols * 0.0006;
  const out = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const a = cv.contourArea(c);
    if (a >= areaMin) {
      const rr = cv.minAreaRect(c);
      const rw = rr.size.width, rh = rr.size.height;
      if (Math.min(rw, rh) / Math.max(rw, rh) >= 0.7 && a / (rw * rh + 1e-6) >= 0.8) {
        const hull = new cv.Mat(); cv.convexHull(c, hull, false, true);
        const solid = a / (cv.contourArea(hull) + 1e-6); hull.delete();
        if (solid >= 0.9) {
          const r = cv.boundingRect(c);
          const mask = cv.Mat.zeros(r.height, r.width, cv.CV_8UC1);
          cv.drawContours(mask, contours, i, new cv.Scalar(255), -1, cv.LINE_8, hier, 0, new cv.Point(-r.x, -r.y));
          const roi = b.roi(r);
          const fill = cv.mean(roi, mask)[0];
          roi.delete(); mask.delete();
          if (fill >= 0.6 * 255) out.push({ area: a / (scale * scale), x: rr.center.x / scale, y: rr.center.y / scale });
        }
      }
    }
    c.delete();
  }
  small.delete(); b.delete(); ker3.delete(); contours.delete(); hier.delete();
  return out.sort((p, q) => q.area - p.area).slice(0, 8);
}

function templateRatio() {     // |TR-BR| / |BR-BL| ใน template (≈ 1.48)
  const A = getGeometry().anchors;
  return dist(A.TR, A.BR) / dist(A.BR, A.BL);
}

/** เลือก 3 สี่เหลี่ยมที่เป็นมุมฉาก (TR, BL, BR) — ถ้าไม่ได้ ใช้แค่ 2 มุมล่าง แล้วคำนวณมุมขวาบน */
function pickCorners(cands) {
  const R = templateRatio();
  let best = null;
  for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) for (let k = j + 1; k < cands.length; k++) {
    const tri = [cands[i], cands[j], cands[k]];
    const areas = tri.map((t) => t.area);
    if (Math.max(...areas) / Math.min(...areas) > 1.8) continue;
    const P = tri.map((t) => [t.x, t.y]);
    for (let v = 0; v < 3; v++) {
      const a = [P[(v + 1) % 3][0] - P[v][0], P[(v + 1) % 3][1] - P[v][1]];
      const b = [P[(v + 2) % 3][0] - P[v][0], P[(v + 2) % 3][1] - P[v][1]];
      const na = Math.hypot(...a), nb = Math.hypot(...b);
      const cos = Math.abs(a[0] * b[0] + a[1] * b[1]) / (na * nb + 1e-6);
      const ratio = Math.max(na, nb) / (Math.min(na, nb) + 1e-6);
      if (cos < 0.12 && ratio > R * 0.8 && ratio < R * 1.22) {
        const score = areas.reduce((s, x) => s + x, 0) * (1 - cos);
        if (!best || score > best.score) best = { score, br: P[v], p1: P[(v + 1) % 3], p2: P[(v + 2) % 3] };
      }
    }
  }
  if (best) {
    const { br, p1, p2 } = best;
    const [tr, bl] = dist(p1, br) > dist(p2, br) ? [p1, p2] : [p2, p1];
    return { tr, bl, br, source: 'markers-3 (BL, BR, TR)' };
  }
  // ---- fallback: สี่เหลี่ยมดำ 2 จุดที่มุมล่างซ้าย/ขวา (ตามสเปก) ----
  let pair = null;
  for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
    const a = cands[i], b = cands[j];
    if (Math.max(a.area, b.area) / Math.min(a.area, b.area) > 1.5) continue;
    const vx = b.x - a.x, vy = b.y - a.y;
    if (Math.abs(vy) > 0.4 * Math.abs(vx)) continue;              // ต้องอยู่แนวนอนเดียวกันโดยประมาณ
    const side = Math.sqrt((a.area + b.area) / 2);
    if (Math.hypot(vx, vy) < 8 * side) continue;                    // สองมุมล่างอยู่ห่างกันมาก (~14 เท่าของขนาด marker)
    const score = a.area + b.area;
    if (!pair || score > pair.score) pair = { score, a, b };
  }
  if (!pair) throw new AlignError('หา Fiducial Markers (สี่เหลี่ยมดำมุมล่าง) ไม่พบ — ถ่ายให้เห็นมุมกระดาษครบ ไม่มีเงาบัง');
  const [L, Rt] = pair.a.x < pair.b.x ? [pair.a, pair.b] : [pair.b, pair.a];
  const bl = [L.x, L.y], br = [Rt.x, Rt.y];
  const v = [br[0] - bl[0], br[1] - bl[1]];
  const tr = [br[0] + v[1] * R, br[1] - v[0] * R];                // หมุน 90° ขึ้นด้านบนของกระดาษ
  return { tr, bl, br, source: 'markers-2 (BL, BR)' };
}

/** หา centroid ของ mark ใกล้ตำแหน่งที่คาดไว้ (port จาก _mark_centroid) */
function markCentroid(cv, warped, [ex, ey], win) {
  const x = Math.floor(ex), y = Math.floor(ey);
  const x0 = Math.max(0, x - win), y0 = Math.max(0, y - win);
  const x1 = Math.min(warped.cols, x + win), y1 = Math.min(warped.rows, y + win);
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  const roi = warped.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0));
  const b = new cv.Mat(); cv.threshold(roi, b, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
  const lab = new cv.Mat(), st = new cv.Mat(), ce = new cv.Mat();
  const n = cv.connectedComponentsWithStats(b, lab, st, ce, 8, cv.CV_32S);
  let best = null, bestS = -1;
  for (let i = 1; i < n; i++) {
    const s = st.data32S, o = i * 5;
    const cxx = ce.data64F[i * 2], cyy = ce.data64F[i * 2 + 1];
    const sc = s[o + 4] / (1 + Math.hypot(cxx - (x - x0), cyy - (y - y0)) / win);
    if (sc > bestS) { bestS = sc; best = [s[o] + s[o + 2] / 2 + x0, s[o + 1] + s[o + 3] / 2 + y0]; }
  }
  roi.delete(); b.delete(); lab.delete(); st.delete(); ce.delete();
  return best;
}

function seededRand(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** จับคู่ตำแหน่ง mark ที่หาเจอ t กับ template u ด้วย t = a*u + b (port จาก _match_1d) */
function match1d(t, u, tol) {
  let best = [], bestScore = 0;
  for (let i1 = 0; i1 < t.length; i1++) for (let i2 = i1 + 1; i2 < t.length; i2++)
    for (let j1 = 0; j1 < u.length; j1++) for (let j2 = j1 + 1; j2 < u.length; j2++) {
      const a = (t[i2] - t[i1]) / (u[j2] - u[j1]);
      if (!(a > 0.7 && a < 1.4)) continue;
      const b = t[i1] - a * u[j1];
      const pairs = []; let score = 0;
      for (let j = 0; j < u.length; j++) {
        const pj = a * u[j] + b;
        let k = 0, r = Infinity;
        for (let q = 0; q < t.length; q++) { const d = Math.abs(t[q] - pj); if (d < r) { r = d; k = q; } }
        if (r < tol) { pairs.push([k, j]); score += 1 - r / tol; }
      }
      if (score > bestScore) { best = pairs; bestScore = score; }
    }
  return best;
}

/** หา Timing Tracks (ขีดซ้าย 15 + แท่งล่าง 20) แล้วจับคู่กับ template (port จาก _timing_marks) */
function timingMarks(cv, big, offset) {
  const G = getGeometry();
  const s = CONFIG.WARP_SCALE * LAYOUT.refWidth / 2480;
  const b = darkMask(cv, big, 3, Math.floor(91 * s) | 1, 40, 0.35);
  const lab = new cv.Mat(), st = new cv.Mat(), ce = new cv.Mat();
  const n = cv.connectedComponentsWithStats(b, lab, st, ce, 8, cv.CV_32S);
  const expArea = 60 * 20 * s * s;
  const dashes = [], bars = [];
  const S = st.data32S;
  for (let i = 1; i < n; i++) {
    const [x, y, w, h, a] = [S[i * 5], S[i * 5 + 1], S[i * 5 + 2], S[i * 5 + 3], S[i * 5 + 4]];
    if (!(a > 0.35 * expArea && a < 2.5 * expArea) || a < 0.7 * w * h) continue;
    const c = [x + w / 2, y + h / 2];
    if (w / h > 1.8 && w / h < 5) dashes.push(c); else if (h / w > 1.8 && h / w < 5) bars.push(c);
  }
  b.delete(); lab.delete(); st.delete(); ce.delete();
  const src = [], dst = [];
  const rand = seededRand(0);
  for (const [found0, tmpl0, axis] of [[dashes, G.anchors.timingLeft, 1], [bars, G.anchors.timingBottom, 0]]) {
    const tmpl = tmpl0.map((p) => [p[0] + offset, p[1] + offset]);
    const other = 1 - axis;
    const ax = tmpl.map((p) => p[axis]);
    const span = Math.max(...ax) - Math.min(...ax);
    const lo = Math.min(...ax) - 0.25 * span, hi = Math.max(...ax) + 0.25 * span;
    const found = found0.filter((f) => f[axis] > lo && f[axis] < hi && Math.abs(f[other] - tmpl[0][other]) < 0.3 * span);
    if (found.length < 6) continue;
    let bestIn = null, bestCnt = -1;
    for (let it = 0; it < 200; it++) {           // RANSAC เส้นตรงของแถว mark
      const i1 = Math.floor(rand() * found.length); let i2 = Math.floor(rand() * found.length);
      if (i1 === i2) continue;
      const d = found[i2][axis] - found[i1][axis];
      if (Math.abs(d) < 1e-3) continue;
      const p = (found[i2][other] - found[i1][other]) / d, q = found[i1][other] - p * found[i1][axis];
      const inl = found.map((f) => Math.abs(f[other] - (p * f[axis] + q)) < 8 * s);
      const cnt = inl.filter(Boolean).length;
      if (cnt > bestCnt) { bestCnt = cnt; bestIn = inl; }
    }
    if (!bestIn) continue;
    const sel = found.filter((_, i) => bestIn[i]).sort((p, q) => p[axis] - q[axis]);
    const diffs = ax.slice(1).map((v, i) => v - ax[i]).sort((p, q) => p - q);
    const spacing = diffs[Math.floor(diffs.length / 2)];
    const pairs = match1d(sel.map((p) => p[axis]), ax, 0.3 * spacing);
    if (pairs.length < 0.6 * tmpl.length) continue;
    for (const [i, j] of pairs) { src.push(sel[i]); dst.push([tmpl[j][0] - offset, tmpl[j][1] - offset]); }
  }
  return { src, dst };
}

function findH(cv, src, dst, thr) {
  const a = cv.matFromArray(src.length, 1, cv.CV_32FC2, src.flat());
  const b = cv.matFromArray(dst.length, 1, cv.CV_32FC2, dst.flat());
  const H = cv.findHomography(a, b, cv.RANSAC, thr);
  const out = H && !H.empty() ? Array.from(H.data64F) : null;
  a.delete(); b.delete(); if (H) H.delete();
  return out;
}

function warpWith(cv, src, H, W, Hh, border) {
  const M = cv.matFromArray(3, 3, cv.CV_64F, H);
  const dst = new cv.Mat();
  cv.warpPerspective(src, dst, M, new cv.Size(W, Hh), cv.INTER_LINEAR, cv.BORDER_CONSTANT, border);
  M.delete();
  return dst;
}

/**
 * ปรับระนาบภาพ (Image Registration)
 * @param cv  OpenCV.js
 * @param rgba  cv.Mat CV_8UC4 ของรูปต้นฉบับ
 * @param markers  (ไม่บังคับ) จุดศูนย์กลาง marker 3 จุดจาก YOLO
 * @returns {gray, color, H, info}  gray/color = cv.Mat ขนาด W x H ของ template (ต้อง delete เอง)
 */
export function alignSheet(cv, rgba, markers = null) {
  const G = getGeometry();
  const { W, H: Hh } = G;
  let gray = new cv.Mat(); cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  let color = rgba;
  let c;
  let source;
  if (markers && markers.length === 3) {
    c = cornersFromPoints(markers); source = 'yolo';
  } else {
    c = pickCorners(squareCandidates(cv, gray)); source = c.source;
  }
  // ย่อภาพต้นฉบับให้ใกล้ขนาดผลลัพธ์ก่อน warp (ลด aliasing ของภาพมือถือความละเอียดสูง)
  const f = dist(G.anchors.BL, G.anchors.BR) / dist(c.bl, c.br);
  let ownColor = false;
  if (f < 0.85) {
    const sz = new cv.Size(Math.round(gray.cols * f), Math.round(gray.rows * f));
    const g2 = new cv.Mat(); cv.resize(gray, g2, sz, 0, 0, cv.INTER_AREA); gray.delete(); gray = g2;
    const c2 = new cv.Mat(); cv.resize(rgba, c2, sz, 0, 0, cv.INTER_AREA); color = c2; ownColor = true;
    c = { ...c, tr: c.tr.map((v) => v * f), bl: c.bl.map((v) => v * f), br: c.br.map((v) => v * f) };
  }
  const srcTri = cv.matFromArray(3, 1, cv.CV_32FC2, [...c.tr, ...c.bl, ...c.br]);
  const dstTri = cv.matFromArray(3, 1, cv.CV_32FC2, [...G.anchors.TR, ...G.anchors.BL, ...G.anchors.BR]);
  const A = cv.getAffineTransform(srcTri, dstTri);
  let Hm = [...A.data64F, 0, 0, 1];
  srcTri.delete(); dstTri.delete(); A.delete();
  const white = new cv.Scalar(255, 255, 255, 255);

  // ---- รอบที่ 1: timing tracks บนภาพที่เผื่อขอบ ----
  const m = Math.round(0.15 * W);
  const T = [1, 0, m, 0, 1, m, 0, 0, 1];
  const big = warpWith(cv, gray, mm(T, Hm), W + 2 * m, Hh + 2 * m, white);
  const p1 = timingMarks(cv, big, m);
  big.delete();
  const sqDst = [G.anchors.TR, G.anchors.BL, G.anchors.BR];
  let n1 = p1.src.length;
  if (n1 >= 15) {
    const Hr = findH(cv, [...p1.src, ...sqDst.map((p) => [p[0] + m, p[1] + m])], [...p1.dst, ...sqDst], 4.0);
    if (Hr) Hm = mm(Hr, mm(T, Hm));
  }
  // ---- รอบที่ 2: centroid ละเอียดของทุก mark ----
  let warped = warpWith(cv, gray, Hm, W, Hh, white);
  const s = CONFIG.WARP_SCALE * LAYOUT.refWidth / 2480;
  const win = Math.floor(20 * s * 2);
  const src = [], dst = [];
  for (const e of [...G.anchors.timingLeft, ...G.anchors.timingBottom]) {
    const cc = markCentroid(cv, warped, e, win);
    if (cc && dist(cc, e) < win * 0.6) { src.push(cc); dst.push(e); }
  }
  for (const e of sqDst) {
    const cc = markCentroid(cv, warped, e, Math.floor(G.anchors.size * 0.9));
    if (cc) { src.push(cc); dst.push(e); }
  }
  let resid = NaN;
  if (src.length >= 12) {
    const Hr = findH(cv, src, dst, 2.0);
    if (Hr) {
      Hm = mm(Hr, Hm);
      warped.delete(); warped = warpWith(cv, gray, Hm, W, Hh, white);
      const after = src.map((p) => applyH(Hr, p));
      resid = Math.sqrt(after.reduce((acc, p, i) => acc + (p[0] - dst[i][0]) ** 2 + (p[1] - dst[i][1]) ** 2, 0) / after.length);
    }
  }
  if (src.length < 12 && n1 < 15) {
    // ไม่เจอ timing tracks เลย: ยังใช้ผลจาก marker ได้ แต่แจ้งให้ตรวจทาน
  }
  const colorW = warpWith(cv, color, Hm, W, Hh, white);
  gray.delete(); if (ownColor) color.delete();
  return {
    gray: warped, color: colorW, H: Hm,
    info: { cornerSource: source, corners: { tr: c.tr, bl: c.bl, br: c.br }, marksPass1: n1, marksPass2: src.length,
      residualPx: Number.isFinite(resid) ? +resid.toFixed(2) : null, downscale: +Math.min(1, f).toFixed(3) },
  };
}

/** จุด marker 3 จุด (เช่นจาก YOLO) → TR, BL, BR (port จาก corners_from_points) */
export function cornersFromPoints(pts) {
  const P = pts.map((p) => [p[0], p[1]]);
  let bestV = 0, bestCos = Infinity;
  for (let v = 0; v < 3; v++) {
    const a = [P[(v + 1) % 3][0] - P[v][0], P[(v + 1) % 3][1] - P[v][1]];
    const b = [P[(v + 2) % 3][0] - P[v][0], P[(v + 2) % 3][1] - P[v][1]];
    const cos = Math.abs(a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b) + 1e-6);
    if (cos < bestCos) { bestCos = cos; bestV = v; }
  }
  const br = P[bestV], p1 = P[(bestV + 1) % 3], p2 = P[(bestV + 2) % 3];
  const [tr, bl] = dist(p1, br) > dist(p2, br) ? [p1, p2] : [p2, p1];
  return { tr, bl, br, source: 'yolo' };
}

// =====================================================================
// 5) (ทางเลือก) YOLO หา marker — ใช้เมื่อมี public/models/yolo.onnx และเปิด enabled
// =====================================================================
export async function detectMarkersYOLO(canvas) {
  const sess = await getSession('yolo');
  if (!sess) return null;
  const m = sess._vg; const S = m.imgsz || 1024;
  const r = Math.min(S / canvas.width, S / canvas.height);
  const nw = Math.round(canvas.width * r), nh = Math.round(canvas.height * r);
  const px = Math.floor((S - nw) / 2), py = Math.floor((S - nh) / 2);
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'rgb(114,114,114)'; ctx.fillRect(0, 0, S, S);          // letterbox เหมือน ultralytics
  ctx.drawImage(canvas, px, py, nw, nh);
  const d = ctx.getImageData(0, 0, S, S).data;
  const x = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) { x[i] = d[i * 4] / 255; x[S * S + i] = d[i * 4 + 1] / 255; x[2 * S * S + i] = d[i * 4 + 2] / 255; }
  const out = await sess.run({ [sess.inputNames[0]]: new window.ort.Tensor('float32', x, [1, 3, S, S]) });
  const o = out[sess.outputNames[0]];                         // [1, 4+nc, A]  (YOLOv8/11)
  const [, F, A] = o.dims; const D = o.data;
  const mk = Math.max(0, (m.classes || []).indexOf('marker'));
  const boxes = [];
  for (let a = 0; a < A; a++) {
    const conf = D[(4 + mk) * A + a];
    if (conf < (m.conf || 0.25)) continue;
    const cx = (D[a] - px) / r, cy = (D[A + a] - py) / r, w = D[2 * A + a] / r, h = D[3 * A + a] / r;
    boxes.push({ conf, cx, cy, w, h });
  }
  boxes.sort((p, q) => q.conf - p.conf);
  const keep = [];
  for (const b of boxes) {        // NMS แบบง่าย
    if (keep.every((k) => Math.hypot(k.cx - b.cx, k.cy - b.cy) > Math.max(k.w, k.h))) keep.push(b);
    if (keep.length === 3) break;
  }
  return keep.length === 3 ? keep.map((b) => [b.cx, b.cy]) : null;
}

// =====================================================================
// 6) ตัดภาพ ROI (Crop) เป็น 32x32 — ตรงกับ _crop_square / crops_from ใน notebook
// =====================================================================
export function extractCrops(cv, gray, items, size = CONFIG.CROP_SIZE) {
  const pad = 80;
  const padded = new cv.Mat();
  cv.copyMakeBorder(gray, padded, pad, pad, pad, pad, cv.BORDER_CONSTANT, new cv.Scalar(255));
  const data = new Float32Array(items.length * size * size);
  const tmp = new cv.Mat();
  const dsize = new cv.Size(size, size);
  items.forEach((it, n) => {
    let x0 = Math.round(it.x - it.half), y0 = Math.round(it.y - it.half);
    let x1 = Math.round(it.x + it.half), y1 = Math.round(it.y + it.half);
    x0 = Math.max(-pad, x0); y0 = Math.max(-pad, y0);
    x1 = Math.min(gray.cols + pad, Math.max(x0 + 2, x1)); y1 = Math.min(gray.rows + pad, Math.max(y0 + 2, y1));
    const roi = padded.roi(new cv.Rect(x0 + pad, y0 + pad, x1 - x0, y1 - y0));
    cv.resize(roi, tmp, dsize, 0, 0, cv.INTER_AREA);
    roi.delete();
    const off = n * size * size;
    for (let k = 0; k < size * size; k++) data[off + k] = 1 - tmp.data[k] / 255;   // หมึก = ค่าสูง
  });
  padded.delete(); tmp.delete();
  return { data, n: items.length, size };
}

// ---------------------------------------------------------------------
// วิธีสำรองเมื่อยังไม่มีโมเดล (Classical Image Processing)
// วงกลม: วัดความเข้มหมึกในวงใน แล้วใช้ Otsu แยก "ฝน" / "ไม่ฝน" ของทั้งใบ
// ---------------------------------------------------------------------
function inkInDisk(batch, i, rFrac) {
  const S = batch.size, c = (S - 1) / 2, r = (S / 2) / 1.3 * rFrac;
  let s = 0, n = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if ((x - c) ** 2 + (y - c) ** 2 <= r * r) { s += batch.data[i * S * S + y * S + x]; n++; }
  }
  return s / n;
}
function otsu(values) {
  const v = [...values].sort((a, b) => a - b);
  let best = v[0], bestVar = -1;
  for (let i = 1; i < v.length; i++) {
    const a = v.slice(0, i), b = v.slice(i);
    const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
    const bv = a.length * b.length * (ma - mb) ** 2;
    if (bv > bestVar) { bestVar = bv; best = (v[i - 1] + v[i]) / 2; }
  }
  return best;
}
export function classicalBubbleProbs(batch) {
  const ink = Array.from({ length: batch.n }, (_, i) => inkInDisk(batch, i, 0.72));
  // เกณฑ์ปรับตามใบ (Otsu) แต่จำกัดช่วง 0.18-0.235 (จูนจากภาพทดสอบ: ฝนเบาสุด ~0.25, วงว่างที่มีเลขพิมพ์ ~0.14-0.22)
  const thr = Math.min(0.235, Math.max(0.18, otsu(ink)));
  return ink.map((v) => { const p = 1 / (1 + Math.exp(-(v - thr) / 0.02)); return Float32Array.of(1 - p, p); });
}
export function classicalDigitProbs(batch) {
  // ไม่มีโมเดลตัวเลข: บอกได้แค่ว่า "ช่องว่าง" หรือ "มีลายมือ" (อ่านเลขไม่ได้ -> ให้ครูกรอก)
  const S = batch.size;
  return Array.from({ length: batch.n }, (_, i) => {
    let s = 0, n = 0;
    for (let y = Math.floor(S * 0.2); y < S * 0.8; y++) for (let x = Math.floor(S * 0.2); x < S * 0.8; x++) { s += batch.data[i * S * S + y * S + x]; n++; }
    const blank = s / n < 0.08;
    const p = new Float32Array(11);
    if (blank) p[BLANK] = 0.95; else p.fill(1 / 11);
    return p;
  });
}

// =====================================================================
// 7) แปลงความน่าจะเป็น -> คำตอบ (ตรงกับ Reader.read ใน notebook)
// =====================================================================
export function decodeResults(pb, pc, G = getGeometry(), engines = {}) {
  const [lo, hi] = CONFIG.REVIEW_BAND;
  const res = {
    template: LAYOUT.code || 'TEMPLATE_4',
    answers: { part1: {}, part2: {} },
    header: { student_id: '', subject_code: '', school_code: '', booklet_no: null, page_no: null },
    probs: { part1: {}, qset: [], page: [] },
    cells: {},
    review: [],
    engine: engines,
  };
  const fill = {};
  G.bubbles.forEach((b, i) => {
    const p = pb[i][1];
    const key = b.kind === 'mc' ? 'mc:' + b.q : b.kind;
    (fill[key] ||= [])[b.opt - 1] = p;
    if (p > lo && p < hi) res.review.push({ type: 'bubble', part: b.kind === 'mc' ? 'part1' : b.kind, q: b.q, opt: b.opt, p: +p.toFixed(3) });
  });
  const choose = (ps) => {
    const ch = ps.map((p, k) => (p > CONFIG.FILL_THR ? k + 1 : 0)).filter(Boolean);
    return ch.length === 1 ? ch[0] : ch.length ? ch : null;
  };
  for (const q of Object.keys(LAYOUT.part1).map(Number).sort((a, b) => a - b)) {
    const ps = fill['mc:' + q];
    res.answers.part1[q] = choose(ps);
    res.probs.part1[q] = ps.map((p) => +p.toFixed(3));
    if (Array.isArray(res.answers.part1[q])) res.review.push({ type: 'multi', part: 'part1', q, chosen: res.answers.part1[q] });
  }
  for (const name of ['qset', 'page']) {
    const ps = fill[name] || [];
    res.probs[name] = ps.map((p) => +p.toFixed(3));
    const ch = choose(ps);
    res.header[name === 'qset' ? 'booklet_no' : 'page_no'] = Array.isArray(ch) ? null : ch;
    if (ch === null || Array.isArray(ch)) res.review.push({ type: name, item: name === 'qset' ? 'ชุดกระดาษคำถาม' : 'หน้ากระดาษคำตอบ', chosen: ch });
  }
  const cells = {};
  G.cells.forEach((c, i) => {
    const p = pc[i];
    let d = 0; for (let k = 1; k < p.length; k++) if (p[k] > p[d]) d = k;
    let d2 = d === 0 ? 1 : 0; for (let k = 0; k < p.length; k++) if (k !== d && p[k] > p[d2]) d2 = k;
    const conf = p[d];
    const unknown = conf < 0.2;                          // วิธีสำรอง: มีลายมือแต่อ่านไม่ได้
    const ch = unknown ? '?' : DIGIT_CH[d];
    const key = c.kind === 'id' ? c.field : 'num:' + c.field;
    (cells[key] ||= {})[c.idx] = { d: ch, c: +conf.toFixed(3), alt: DIGIT_CH[d2] };
    if (conf < CONFIG.DIGIT_CONF && engines.digit !== 'none') {
      res.review.push({ type: 'digit', part: c.kind === 'id' ? c.field : 'part2', q: c.kind === 'num' ? c.field : null,
        idx: c.idx, pred: ch, conf: +conf.toFixed(3), alt: unknown ? null : DIGIT_CH[d2] });
    }
  });
  res.cells = cells;
  for (const f of Object.keys(LAYOUT.idFields)) {
    const cs = cells[f] || {};
    const s = Object.keys(cs).map(Number).sort((a, b) => a - b).map((i) => cs[i].d).filter((d) => d !== '_').join('');
    res.header[f] = s;
    const want = CONFIG.ID_LENGTHS[f];
    if (want && s.length && s.length !== want) res.review.push({ type: 'id_length', part: f, got: s.length, want });
  }
  const dec = LAYOUT.decimalIndex;
  for (const q of Object.keys(LAYOUT.part2).map(Number).sort((a, b) => a - b)) {
    const cs = cells['num:' + q] || {};
    const n = LAYOUT.part2[q].length;
    let ip = '', fp = '';
    for (let i = 0; i < dec; i++) if (cs[i] && cs[i].d !== '_') ip += cs[i].d;
    for (let i = dec + 1; i < n; i++) if (cs[i] && cs[i].d !== '_') fp += cs[i].d;
    res.answers.part2[q] = (ip || (fp ? '0' : '')) + (fp ? '.' + fp : '');
  }
  return res;
}

// =====================================================================
// 8) ฟังก์ชันหลัก: อ่านกระดาษคำตอบ 1 แผ่น
// =====================================================================
/**
 * @param source  File | Blob | HTMLCanvasElement | HTMLImageElement | ImageBitmap
 * @param opts.onStage(stageName)  callback แสดงความคืบหน้า
 * @returns {result, warpedCanvas}  result = JSON ที่บันทึกลง raw_detections_json
 */
export async function readSheet(source, opts = {}) {
  const stage = opts.onStage || (() => {});
  const t0 = performance.now();
  stage('load');
  const { cv } = await loadOpenCV();
  const canvas = await toCanvas(source);
  stage('detect');
  const yoloPts = await detectMarkersYOLO(canvas).catch(() => null);
  const rgba = cv.imread(canvas);
  let al;
  try {
    try { al = alignSheet(cv, rgba, yoloPts); }
    catch (e) { if (yoloPts) al = alignSheet(cv, rgba, null); else throw e; }
  } finally { rgba.delete(); }
  try {
    stage('crop');
    const G = getGeometry();
    const xb = extractCrops(cv, al.gray, G.bubbles);
    const xc = extractCrops(cv, al.gray, G.cells);
    stage('infer');
    const engines = { align: al.info.cornerSource };
    let pb = await runInference(xb, 'bubble');
    engines.bubble = pb ? 'onnx' : 'classical';
    if (!pb) pb = classicalBubbleProbs(xb);
    let pc = await runInference(xc, 'digit');
    engines.digit = pc ? 'onnx' : 'none';
    if (!pc) pc = classicalDigitProbs(xc);
    stage('decode');
    const result = decodeResults(pb, pc, G, engines);
    result.align = al.info;
    if (al.info.marksPass2 < 20) result.review.push({ type: 'align', item: `เจอ timing marks ${al.info.marksPass2}/38 จุด — ตรวจตำแหน่งกรอบ` });
    if (engines.digit === 'none') result.review.push({ type: 'model', item: 'ยังไม่มีโมเดลอ่านตัวเลข (digit.onnx) — รหัสและ Part 2 ต้องกรอกเอง' });
    const warpedCanvas = document.createElement('canvas');
    cv.imshow(warpedCanvas, al.color);
    result.timeMs = Math.round(performance.now() - t0);
    stage('done');
    return { result, warpedCanvas };
  } finally {
    al.gray.delete(); al.color.delete();
  }
}

/** แปลงไฟล์/รูปเป็น canvas (หมุนตาม EXIF อัตโนมัติ, จำกัดด้านยาวไม่เกิน 4000px) */
export async function toCanvas(src, maxSide = 4000) {
  if (src instanceof HTMLCanvasElement && Math.max(src.width, src.height) <= maxSide) return src;
  let bmp = src;
  if (src instanceof Blob) bmp = await createImageBitmap(src, { imageOrientation: 'from-image' });
  const w = bmp.naturalWidth || bmp.width, h = bmp.naturalHeight || bmp.height;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return c;
}

// =====================================================================
// 9) วาด Visual Overlay บน Canvas (กรอบเขียว = ถูก, แดง = ผิด + เฉลย)
// =====================================================================
export const COLORS = { ok: '#10B981', bad: '#EF4444', warn: '#F97316', info: '#1D4ED8', key: '#0EA5E9' };

/**
 * @param ctx  CanvasRenderingContext2D ที่วาดภาพ warped ไว้แล้ว
 * @param k    สเกล = ความกว้าง canvas / W ของ geometry
 * @param data {answers, details (จาก scoring), header, review, mode: 'grade'|'roi', focus}
 */
export function drawOverlay(ctx, k, data = {}) {
  const G = getGeometry();
  const lw = Math.max(1.5, 2 * k);
  ctx.save();
  ctx.lineWidth = lw;
  const rect = (b, color, fillA = 0.12, dash = null) => {
    ctx.strokeStyle = color; ctx.fillStyle = hexA(color, fillA);
    ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.rect(b[0] * k, b[1] * k, (b[2] - b[0]) * k, (b[3] - b[1]) * k); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
  };
  const circle = (x, y, r, color, fillA = 0.12, dash = null) => {
    ctx.strokeStyle = color; ctx.fillStyle = hexA(color, fillA); ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.arc(x * k, y * k, r * k, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  };
  const label = (x, y, text, color) => {
    ctx.font = `600 ${Math.max(10, 13 * k)}px Inter, Prompt, sans-serif`;
    const w = ctx.measureText(text).width + 8 * k;
    ctx.fillStyle = color; ctx.fillRect(x * k, y * k - 15 * k, w, 16 * k);
    ctx.fillStyle = '#fff'; ctx.fillText(text, x * k + 4 * k, y * k - 3 * k);
  };

  if (data.mode === 'roi') {
    for (const [name, b] of Object.entries(G.zones)) {
      const col = name.startsWith('marker') ? COLORS.bad : name.startsWith('part1') ? COLORS.info : name === 'part2' ? '#7C3AED' : name.startsWith('timing') ? '#64748B' : COLORS.ok;
      if (/^part1_col/.test(name)) continue;
      rect(b, col, 0.06);
      label(b[0], b[1], name, col);
    }
    for (const bb of G.bubbles) circle(bb.x, bb.y, bb.half / 1.3, COLORS.info, 0.0);
    for (const c of G.cells) rect(c.box, '#7C3AED', 0.0);
    ctx.restore();
    return;
  }

  const det = {};                          // 'part1_mcq:5' -> detail
  for (const d of data.details || []) det[d.part_type + ':' + d.question_no] = d;
  const byQ = {};
  for (const b of G.bubbles) if (b.kind === 'mc') (byQ[b.q] ||= [])[b.opt - 1] = b;

  // ---- Part 1 ----
  for (const q of Object.keys(byQ).map(Number)) {
    const bs = byQ[q];
    const d = det['part1_mcq:' + q];
    const ans = data.answers?.part1?.[q];
    const chosen = Array.isArray(ans) ? ans : ans ? [ans] : [];
    const r = bs[0].half / 1.3;
    const row = [bs[0].x - r * 1.35, bs[0].y - r * 1.35, bs[4].x + r * 1.35, bs[0].y + r * 1.35];
    const focus = data.focus && data.focus.part === 'part1' && data.focus.q === q;
    if (!d) { for (const c of chosen) circle(bs[c - 1].x, bs[c - 1].y, r * 1.15, '#94A3B8', 0.1); continue; }
    const col = d.is_correct ? COLORS.ok : chosen.length ? COLORS.bad : COLORS.warn;
    rect(row, col, focus ? 0.22 : 0.08);
    for (const c of chosen) circle(bs[c - 1].x, bs[c - 1].y, r * 1.15, col, 0.25);
    if (!d.is_correct) {
      const kv = Number(d.correct_answer);
      if (kv >= 1 && kv <= 5) circle(bs[kv - 1].x, bs[kv - 1].y, r * 1.25, COLORS.ok, 0.0, [4, 3]);
      label(row[2] - 2, row[1], 'เฉลย ' + d.correct_answer, COLORS.ok);
    }
    if (focus) { ctx.lineWidth = lw * 2; rect(row, COLORS.info, 0); ctx.lineWidth = lw; }
  }
  // ---- Part 2 ----
  for (const [q, b] of Object.entries(G.part2Rows)) {
    const d = det['part2_numeric:' + q];
    const focus = data.focus && data.focus.part === 'part2' && data.focus.q === Number(q);
    if (!d) { rect(b, '#94A3B8', 0.03, [4, 4]); continue; }
    const col = d.is_correct ? COLORS.ok : d.student_answer ? COLORS.bad : COLORS.warn;
    rect(b, col, focus ? 0.2 : 0.08);
    label(b[0], b[1], `อ่านได้: ${d.student_answer || '—'}`, col);
    if (!d.is_correct) label(b[2] - 120 * 1, b[1], 'เฉลย ' + d.correct_answer, COLORS.ok);
    if (focus) { ctx.lineWidth = lw * 2; rect(b, COLORS.info, 0); ctx.lineWidth = lw; }
  }
  // ---- Header ----
  for (const f of ['student_id', 'subject_code', 'school_code']) if (G.zones[f]) rect(G.zones[f], COLORS.info, 0.04);
  // ---- จุดที่ต้องตรวจทาน (ความมั่นใจต่ำ) ----
  for (const rv of data.review || []) {
    if (rv.type === 'digit') {
      const c = G.cells.find((x) => (rv.part === 'part2' ? x.kind === 'num' && x.field === rv.q : x.kind === 'id' && x.field === rv.part) && x.idx === rv.idx);
      if (c) rect(c.box, COLORS.warn, 0.18, [3, 2]);
    } else if (rv.type === 'bubble' && rv.part === 'part1') {
      const b = byQ[rv.q]?.[rv.opt - 1];
      if (b) circle(b.x, b.y, b.half / 1.3 * 1.3, COLORS.warn, 0.0, [3, 2]);
    }
  }
  ctx.restore();
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** ตัดภาพบางส่วนจาก canvas ที่ warped (ใช้ทำ Inspection Lens ในหน้า Review) */
export function cropCanvas(srcCanvas, box, scale = 4, k = 1) {
  const [x0, y0, x1, y1] = box.map((v) => v * k);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((x1 - x0) * scale)); c.height = Math.max(1, Math.round((y1 - y0) * scale));
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = true;
  ctx.drawImage(srcCanvas, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  return c;
}
