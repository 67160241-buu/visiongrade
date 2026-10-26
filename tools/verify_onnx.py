"""
ตรวจไฟล์ ONNX ก่อนเอาขึ้นเว็บ
    python tools/verify_onnx.py public/models/bubble.onnx --kind bubble --crops outputs/crops/bubble
    python tools/verify_onnx.py public/models/digit.onnx  --kind digit  --crops outputs/crops/digit

สิ่งที่เช็ก
  1) ชื่อ input/output ต้องเป็น image / logits และ input shape [N,1,32,32]
  2) batch แบบ dynamic หรือไม่ (เว็บรองรับทั้งสองแบบ แต่ dynamic เร็วกว่ามาก)
  3) จำนวนคลาส (bubble=2, digit=11)
  4) ถ้าให้ --crops (โฟลเดอร์ที่แยกคลาสเป็นโฟลเดอร์ย่อย เช่น filled/ empty/ หรือ 0/ ... 9/ blank/)
     จะคำนวณความแม่นยำด้วย preprocessing เดียวกับเว็บ (1 - pixel/255, 32x32) — ควรใกล้เคียงค่าตอนเทรน
     ถ้าต่ำมาก แปลว่า preprocessing ไม่ตรง หรือ export ผิดไฟล์
  5) (ไม่บังคับ) --pt ไฟล์ .pt เดิม เพื่อเทียบว่า ONNX ให้ผลเท่ากับ PyTorch (ต้องมี models_def.py)
ต้องติดตั้ง: pip install onnxruntime numpy opencv-python
"""
import argparse
import sys
from pathlib import Path

import numpy as np

CLASSES = {"bubble": ["empty", "filled"], "digit": [str(i) for i in range(10)] + ["blank"]}


def load_crops(folder: Path, names, size=32, limit=400):
    import cv2
    xs, ys = [], []
    for ci, c in enumerate(names):
        d = folder / c
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.png"))[:limit]:
            g = cv2.imread(str(f), cv2.IMREAD_GRAYSCALE)
            if g is None:
                continue
            if g.shape != (size, size):
                g = cv2.resize(g, (size, size), interpolation=cv2.INTER_AREA)
            xs.append(1.0 - g.astype(np.float32) / 255.0)
            ys.append(ci)
    if not xs:
        return None, None
    return np.stack(xs)[:, None], np.array(ys)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("onnx")
    ap.add_argument("--kind", choices=list(CLASSES), required=True)
    ap.add_argument("--crops", help="โฟลเดอร์ครอปที่แยกคลาสแล้ว")
    ap.add_argument("--pt", help="ไฟล์ .pt เพื่อเทียบผล (ต้องมี models_def.py ที่มี make_model)")
    a = ap.parse_args()

    import onnxruntime as ort
    sess = ort.InferenceSession(a.onnx, providers=["CPUExecutionProvider"])
    i0, o0 = sess.get_inputs()[0], sess.get_outputs()[0]
    print(f"input : {i0.name} {i0.shape} {i0.type}")
    print(f"output: {o0.name} {o0.shape} {o0.type}")
    ok = True
    if i0.name != "image" or o0.name != "logits":
        print("  ! ชื่อ input/output ไม่ใช่ image/logits — เว็บยังใช้ได้ (อ่านชื่อแรกอัตโนมัติ) แต่ควรแก้ models.json ให้ตรง")
    if list(i0.shape[1:]) != [1, 32, 32]:
        print("  ✗ input ต้องเป็น [N,1,32,32]"); ok = False
    dynamic = not isinstance(i0.shape[0], int)
    print("batch :", "dynamic ✓" if dynamic else "ตายตัว = 1 (เว็บจะวนทีละภาพ ช้ากว่า — export ใหม่ด้วย dynamic_axes)")

    n = 8 if dynamic else 1
    out = sess.run(None, {i0.name: np.zeros((n, 1, 32, 32), np.float32)})[0]
    C = out.shape[1]
    print(f"classes: {C} (ต้องเป็น {len(CLASSES[a.kind])})", "✓" if C == len(CLASSES[a.kind]) else "✗")
    ok &= C == len(CLASSES[a.kind])

    def run(x):
        if dynamic:
            return sess.run(None, {i0.name: x})[0]
        return np.concatenate([sess.run(None, {i0.name: x[i:i + 1]})[0] for i in range(len(x))])

    if a.crops:
        x, y = load_crops(Path(a.crops), CLASSES[a.kind])
        if x is None:
            print("ไม่พบครอปในโฟลเดอร์ย่อย", CLASSES[a.kind])
        else:
            pred = run(x).argmax(1)
            acc = (pred == y).mean()
            print(f"accuracy บนครอป {len(y)} รูป: {acc * 100:.2f}%")
            for ci, c in enumerate(CLASSES[a.kind]):
                m = y == ci
                if m.any():
                    print(f"   {c:>6}: {(pred[m] == ci).mean() * 100:6.2f}%  (n={m.sum()})")
            if acc < 0.9:
                print("  ! ต่ำกว่าที่ควร — เช็ก preprocessing (1 - pixel/255) และว่า export ไฟล์ที่ถูกต้อง")

            if a.pt:
                import torch
                sys.path[:0] = [str(Path(__file__).resolve().parent.parent), str(Path(__file__).resolve().parent)]
                from models_def import make_model
                net = make_model(a.kind); net.load_state_dict(torch.load(a.pt, map_location="cpu")); net.eval()
                with torch.no_grad():
                    ref = net(torch.from_numpy(x[:64])).numpy()
                diff = np.abs(ref - run(x[:64])).max()
                print(f"max |PyTorch - ONNX| = {diff:.2e}", "✓" if diff < 1e-3 else "✗ ต่างกันมาก")
    print("ผลรวม:", "พร้อมใช้ ✓" if ok else "ยังไม่ผ่าน ✗")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
