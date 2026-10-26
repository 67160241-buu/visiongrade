# สอนเอาโมเดลเข้าเว็บ (ทีละขั้น)

เว็บนี้ใช้โมเดลที่คุณเทรนเองใน notebook `omr_v2` ได้เลย โดยไม่ต้องแก้โค้ด มี 4 ขั้น: **export → ตรวจไฟล์ → วางไฟล์ → ทดสอบ**

```
notebook (.pt) ──export──► bubble.onnx / digit.onnx ──วาง──► models/
เบราว์เซอร์: OpenCV.js ปรับภาพให้ตรง + ตัดช่อง 32x32 ──► ONNX Runtime Web ──► คำตอบ ──► คะแนน
```

| ไฟล์ | หน้าที่ | Input → Output | ถ้าไม่มีไฟล์นี้ |
|---|---|---|---|
| `bubble.onnx` | วงนี้ฝนหรือว่าง | `image` [N,1,32,32] → `logits` [N,2] (empty, filled) | วัดปริมาณหมึกแทน (ใช้ได้ แต่พลาดกับรอยลบ/เงา) |
| `digit.onnx` | ช่องนี้เป็นเลขอะไร | `image` [N,1,32,32] → `logits` [N,11] (0–9, blank) | อ่านรหัสนักเรียนและ Part 2 ไม่ได้ ต้องกรอกเอง |

> เว็บเตรียมภาพแบบเดียวกับ `to_tensor()` ใน notebook: ย่อเป็น 32×32, ขาวดำ, ค่า = `1 - ความสว่าง/255`
> (หมึกดำ ≈ 1, กระดาษขาว ≈ 0) ถ้าตอนเทรนคุณเปลี่ยนวิธีนี้ ต้องแก้ `toCropBatch()` / `extractCrops()` ใน `js/cv-pipeline.js` ให้ตรงกัน

---

## ขั้นที่ 1 — Export จาก PyTorch เป็น ONNX

**แบบง่าย:** ใน notebook หัวข้อ **11. Export โมเดล** เปลี่ยน `EXPORT_ONNX = True` แล้วรัน (ต้อง `pip install onnx` ก่อน)
จะได้ `outputs/weights/bubble.onnx` และ `outputs/weights/digit.onnx`

**แบบแนะนำ** (ส่งได้ทีละหลายภาพ เร็วกว่า): วาง cell นี้ต่อท้าย notebook แล้วรัน

```python
import torch
for kind in ('bubble', 'digit'):
    net = load_model(OUT / 'weights' / f'{kind}.pt', kind).cpu().eval()   # load_model มีใน notebook แล้ว
    torch.onnx.export(
        net, torch.zeros(1, 1, 32, 32),                 # ตัวอย่าง input: ภาพขาวดำ 32x32 จำนวน 1 ภาพ
        str(OUT / 'weights' / f'{kind}.onnx'),
        input_names=['image'], output_names=['logits'],
        dynamic_axes={'image': {0: 'batch'}, 'logits': {0: 'batch'}},   # 1 แผ่นมี ~330 วง ส่งทีเดียวได้
        opset_version=17, dynamo=False)
    print('saved', kind)
```

ต้องเรียก `.eval()` ก่อน export ทุกครั้ง ถ้าไม่เรียก Dropout และ BatchNorm จะทำงานผิด

## ขั้นที่ 2 — ตรวจไฟล์ด้วย Python

```bash
pip install onnxruntime numpy opencv-python
python tools/verify_onnx.py outputs/weights/bubble.onnx --kind bubble --crops data/crops/bubble
python tools/verify_onnx.py outputs/weights/digit.onnx  --kind digit  --crops data/crops/digit
```

ผลที่ควรได้:
```
input : image ['batch', 1, 32, 32] tensor(float)
output: logits ['batch', 11] tensor(float)
batch : dynamic ✓
classes: 11 (ต้องเป็น 11) ✓
accuracy บนครอป 4400 รูป: 99.4%      <- ควรใกล้กับค่า val ตอนเทรน
ผลรวม: พร้อมใช้ ✓
```
`--crops` คือโฟลเดอร์ครอปที่แยกคลาสแล้ว (`filled/ empty/` หรือ `0/ … 9/ blank/`) ตามที่ notebook สร้างไว้
ถ้า accuracy ต่ำผิดปกติ แปลว่า preprocessing ไม่ตรงกัน หรือ export ผิดไฟล์

## ขั้นที่ 3 — วางไฟล์

คัดลอก `bubble.onnx` และ `digit.onnx` มาไว้ในโฟลเดอร์ `models/` ของเว็บ (อยู่ข้างไฟล์ `models.json`)
ชื่อไฟล์และลำดับคลาสต้องตรงกับ `models/models.json` ถ้าใช้ notebook เดิม ค่าที่ตั้งไว้ตรงอยู่แล้วไม่ต้องแก้

## ขั้นที่ 4 — ทดสอบ

1. รีเฟรชหน้าเว็บ ป้ายมุมขวาบนต้องเปลี่ยนเป็น **"โมเดลพร้อม (ONNX)"** (เอาเมาส์ชี้ที่ป้ายเพื่อดูรายละเอียดหรือข้อผิดพลาด)
2. อัปโหลดกระดาษ 1 แผ่น แล้วกด **ดู / แก้** บรรทัดล่างสุดต้องเขียนว่า `โมเดล: วงกลม onnx / ตัวเลข onnx`
3. เทียบผลกับกระดาษจริงด้วยตา: กรอบเขียวคือข้อที่ตอบถูก กรอบแดงคือตอบผิด (มีเฉลยแสดงข้าง ๆ) กรอบส้มคือไม่ได้ตอบ

ทดสอบโมเดลตัวเลขตรง ๆ ใน Console (กด F12):
```js
const cvp = await import('./js/cv-pipeline.js');
const c = document.createElement('canvas'); c.width = c.height = 64;
const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
g.fillStyle = '#000'; g.font = 'bold 52px sans-serif'; g.fillText('7', 16, 54);
const [p] = await cvp.runInference(c, 'digit');
console.log('ทาย =', p.indexOf(Math.max(...p)), 'มั่นใจ', Math.max(...p).toFixed(3));
```

---

## Output ของโมเดลกลายเป็นคำตอบอย่างไร

โค้ดอยู่ที่ `runInference()` และ `decodeResults()` ใน `js/cv-pipeline.js` และมีคอมเมนต์ภาษาไทยกำกับทุกขั้น

1. รวมทุกช่องที่ตัดได้เป็น Tensor ขนาด `[N,1,32,32]`
2. ส่งเข้าโมเดล จะได้ `logits` ขนาด `[N,C]`
3. ใช้ softmax แปลงแต่ละแถวเป็นความน่าจะเป็น
4. **วงกลม** ถือว่าฝนเมื่อ `p(filled) > 0.5`
   - 5 วงต่อข้อ วงที่ฝนคือคำตอบ
   - ไม่มีวงที่ฝนเลย = ไม่ตอบ
   - ฝนเกิน 1 วง = ผิด และระบบจะขึ้นเตือนให้ตรวจ
   - ถ้า `0.2 < p < 0.8` ถือว่าไม่แน่ใจ ระบบจะขึ้นเตือนให้ตรวจด้วยตา
5. **ตัวเลข** ใช้ `argmax`
   - คลาส 0–9 คือตัวเลขนั้น คลาส 10 คือช่องว่าง
   - ความมั่นใจต่ำกว่า 0.7 จะขึ้นเตือนให้ตรวจ
   - รหัสต่าง ๆ ได้จากการต่อเลขทุกช่องที่ไม่ว่างจากซ้ายไปขวา
   - Part 2: ช่อง 1–6 เป็นจำนวนเต็ม ช่องเทาคือจุดทศนิยม ช่อง 8–10 เป็นทศนิยม เช่น `[_,_,_,_,1,2,•,5,_,_]` → `12.5`
6. ส่งคำตอบต่อให้ `js/scoring.js` คิดคะแนนแยก Part 1 และ Part 2

ค่าเกณฑ์ทั้งหมดปรับได้ที่ `js/config.js` ได้แก่ `FILL_THR`, `REVIEW_BAND` และ `DIGIT_CONF`

## ปัญหาที่พบบ่อย

| อาการ | วิธีแก้ |
|---|---|
| ป้ายยังขึ้นว่า "ยังไม่มีโมเดล" | ชื่อไฟล์ไม่ตรงกับ `models.json`, วางไฟล์ผิดโฟลเดอร์ หรือเปิดหน้าเว็บด้วยการดับเบิลคลิกไฟล์ (ต้องเปิดผ่าน server ดู README) |
| ขึ้น error เรื่อง dimensions หรือ shape | ตอน export ใช้ขนาดอื่นที่ไม่ใช่ 32×32 หรือใช้ 3 channel ให้ export ใหม่ด้วย `torch.zeros(1,1,32,32)` |
| ทายผิดเกือบทุกช่อง เช่น ฝนทุกวง | preprocessing กลับขาวดำ หรือลืมเรียก `.eval()` ก่อน export |
| ตรวจช้า (หลายวินาทีต่อแผ่น) | export ใหม่โดยใส่ `dynamic_axes` |
| digit แม่นใน notebook แต่ผิดบนกระดาษจริง | เพิ่มข้อมูลเทรนจากกระดาษจริง และแบ่ง validation ตามแผ่น ไม่ใช่ตามครอป |
| Part 2 ที่เป็นเลขติดลบอ่านไม่ได้ | DigitNet มีแค่ 0–9 กับ blank ให้แก้คำตอบเองในหน้าต่าง **ดู / แก้** |
