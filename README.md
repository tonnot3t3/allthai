# ออลไทย — 2 เว็บที่เชื่อมกัน

**เว็บจริง** · เกม https://tonnot3t3.github.io/allthai/ · ทีมงาน https://tonnot3t3.github.io/allthai/admin/
ฐานข้อมูล Supabase โปรเจกต์ `allthai` (Singapore) · ค่าเชื่อมต่ออยู่ใน `config/site.json` (publishable key เปิดเผยได้ ห้ามใส่ secret key)
อัปเดตเว็บ: แก้โค้ดหรือข้อมูล แล้วรัน `bash scripts/deploy_pages.sh`

| เว็บ | ใครใช้ | ทำอะไร |
|---|---|---|
| **เว็บเล่นเกม** (`dist/play`) | ผู้เล่นทั่วไป ไม่ต้องล็อกอิน | เล่นรายวัน / ไม่จำกัด · จัดอันดับ · **แชร์ประสบการณ์: ส่งภาพเข้าคิวรอตรวจ** |
| **เว็บใส่ข้อมูล** (`dist/admin`) | ทีมงาน (ล็อกอิน + อีเมลอยู่ในตาราง `admins`) | ตรวจภาพผู้เล่น · เขียน ตรวจ และเผยแพร่คำถาม · แก้ป้ายจังหวัด · สำรองข้อมูล |

ทั้งสองเว็บใช้ฐานข้อมูลเดียวกันบน **Supabase** (Postgres + Storage + Auth) และเป็นเว็บสถิตย์ที่ขึ้น **Vercel** แยกกันได้

```
ผู้เล่น ─► เว็บเล่นเกม ──ส่งภาพ──► bucket "submissions" (ส่วนตัว) + ตาราง submissions [pending]
              ▲                                         │
              │ อ่านเฉพาะคำถาม "เผยแพร่"                 ▼
              └──────── ตาราง questions ◄──── เว็บใส่ข้อมูล: ผ่าน → คัดลอกภาพไป "question-images" (สาธารณะ)
                                                   → สร้างคำถาม → กด "ฉันตรวจครบแล้ว" → เผยแพร่
```

## กติกาที่ระบบบังคับ

- **ภาพผู้เล่นไม่ขึ้นเกมเอง** ต้องผ่าน 4 ขั้น: ทีมกดผ่าน → ใช้ในคำถาม → คำถามผ่านการตรวจ → เผยแพร่
- **ห้ามเผยแพร่ข้อที่ยังไม่ตรวจ** (กฎจาก handoff) บังคับ 2 ชั้น: ปุ่มในเว็บใส่ข้อมูล และ check constraint ในฐานข้อมูล
- แก้เนื้อหาหลังกดตรวจแล้ว = ต้องกดตรวจใหม่ ข้อที่เผยแพร่อยู่จะบันทึกไม่ได้จนกว่าจะตรวจใหม่หรือเปลี่ยนเป็นร่าง
- ข้อที่เผยแพร่วันนี้เข้ารอบ **รายวันตั้งแต่พรุ่งนี้** (ชุดของวันนี้ไม่เปลี่ยนกลางวัน) เวลาเผยแพร่ใช้นาฬิกาเซิร์ฟเวอร์ · โหมดไม่จำกัดเห็นทันที
- ผู้เล่นอ่านคิวภาพ ข้อมูลติดต่อ หรือคำถามที่เป็นร่างไม่ได้ (Row Level Security)
- เบราว์เซอร์ย่อภาพเหลือด้านยาว ≤ 1600 px และแปลงเป็น JPEG ก่อนส่ง ข้อมูล EXIF/GPS จึงหายไป
- กันสแปม: รับภาพรวมไม่เกิน 300 ภาพต่อ 24 ชั่วโมง ไฟล์ JPEG ≤ 3 MB (ปรับได้ใน `schema.sql`)
- ภาพในคำถาม: CC0 / Public domain / CC BY / CC BY-SA หรือภาพผู้เล่นที่ยินยอม · ภาพ NC/ND ใช้ไม่ได้ (เว็บใส่ข้อมูลเตือนและไม่ให้เผยแพร่)

## ลองทันทีโดยไม่มีเซิร์ฟเวอร์ (โหมดสาธิต)

ปล่อย `config.js` ว่าง = โหมดสาธิต ข้อมูลและภาพเก็บใน localStorage/IndexedDB ของเบราว์เซอร์ที่เปิด

```bash
cd dist && python3 -m http.server 8000
# เว็บเล่นเกม  http://localhost:8000/play/
# เว็บใส่ข้อมูล http://localhost:8000/admin/   (ที่อยู่เดียวกัน → เห็นข้อมูลชุดเดียวกัน)
# หรือ        http://localhost:8000/preview/  (2 เว็บในหน้าเดียว มีแถบสลับด้านบน)
```

ลองตามลำดับ: ส่งภาพในเว็บเล่นเกม → กดผ่านในเว็บใส่ข้อมูล → "สร้างคำถามจากภาพนี้" → กรอกให้ครบ → "ฉันตรวจครบแล้ว" → เผยแพร่ → กลับไปเล่นโหมดไม่จำกัด

## ติดตั้งใช้งานจริง

**1. สร้างโปรเจกต์ Supabase** ที่ supabase.com (เลือก region ใกล้ไทย เช่น Singapore)

**2. สร้างตาราง** เปิด SQL Editor แล้วรันทีละไฟล์
- `supabase/schema.sql` — ตาราง สิทธิ์ (RLS) bucket เก็บภาพ (รันซ้ำได้)
- `supabase/seed.sql` — ป้าย 77 จังหวัด + คำถาม 12 ข้อ (เข้ามาเป็น **ร่าง**)

**3. สร้างบัญชีทีมงาน**
- Authentication → Users → Add user → Create new user (อีเมล + รหัสผ่าน, ติ๊ก Auto Confirm)
- รันใน SQL Editor: `insert into public.admins (email) values ('อีเมลทีมงาน') on conflict do nothing;`
- ปิดการสมัครเอง (Authentication → ตั้งค่า Sign up) เพื่อไม่ให้มีบัญชีแปลกปลอม (ถึงสมัครได้ก็ไม่มีสิทธิ์ ถ้าไม่อยู่ในตาราง admins)

**4. ใส่ค่าเชื่อมต่อ** ใน `dist/play/config.js` และ `dist/admin/config.js`
```js
supabaseUrl: 'https://xxxx.supabase.co',     // Project URL (ปุ่ม Connect หรือ Project Settings)
supabaseKey: 'sb_publishable_...',           // Project Settings → API Keys → Publishable key
playUrl: 'https://allthai-play.vercel.app',  // เฉพาะ admin: ปุ่มเปิดเว็บเล่นเกม
shareUrl: ''                                 // เฉพาะ play: ลิงก์ท้ายข้อความแชร์ (ว่าง = ใช้ที่อยู่หน้าเว็บ)
```
ใช้ **publishable key** เท่านั้น (anon key แบบเดิมยังใช้ได้ แต่ Supabase จะเลิกใช้) **ห้ามใส่ secret / service_role key** ในเว็บ — เว็บจะไม่ยอมเชื่อมต่อถ้าเจอ

**5. ขึ้น Vercel เป็น 2 โปรเจกต์**
```bash
npx vercel deploy dist/play --prod     # ตั้งชื่อเช่น allthai-play
npx vercel deploy dist/admin --prod    # ตั้งชื่อเช่น allthai-admin
```
หรือ push ขึ้น GitHub แล้ว Import 2 ครั้ง ตั้ง Root Directory = `dist/play` และ `dist/admin` (Framework: Other, ไม่มี build command)
เว็บใส่ข้อมูลส่ง header `noindex` และห้ามฝังใน iframe แล้ว (`vercel.json`) ความปลอดภัยจริงอยู่ที่ RLS: เปิดหน้าได้ก็ทำอะไรไม่ได้ถ้าไม่ได้อยู่ในตาราง admins

**6. เปิดเกม** เว็บใส่ข้อมูล → ล็อกอิน → แท็บคำถาม → ตรวจแต่ละข้อกับแหล่งที่มา → "ฉันตรวจครบแล้ว" → เผยแพร่ ให้ได้อย่างน้อยหมวดละ 1 ข้อ (ระหว่างนี้เกมขึ้นข้อความ "ยังไม่มีคำถามที่เผยแพร่" แต่ส่งภาพได้)

## งานประจำของทีม

- **ตรวจภาพ** (แท็บภาพจากผู้เล่น): เช็ก 4 ข้อบนหน้าจอ → ผ่าน / ไม่ผ่าน (ใส่เหตุผลได้) · มีปุ่มค้นภาพย้อนกลับ (Google Lens) ช่วยดูว่าภาพมาจากเว็บอื่นไหม · ข้อมูลติดต่อเป็นข้อมูลส่วนบุคคล ลบรายการที่ไม่ใช้แล้ว
- **สร้างคำถาม**: เบาะแส 3 การ์ด จากกว้างไปชัด + ป้ายเบาะแส → จังหวัดที่คล้าย (500/250) → ข้อมูลจริง + แหล่งที่มาที่มีลิงก์ → ตรวจ → เผยแพร่
- **เป้า**: หมวดละ 7 ข้อ = รายวันไม่ซ้ำ 1 สัปดาห์ · 30 ข้อ = 1 เดือน (ดูหลอดและตารางชุดรายวัน 7 วันข้างหน้าในแท็บคำถาม) · ล็อกข้อให้ออกวันพิเศษได้ด้วยช่อง "วันที่กำหนด"
- **ป้ายจังหวัด**: ตรวจกับแหล่งที่ระบุในแท็บจังหวัด แล้วติ๊ก "ตรวจแล้ว" (มีผลกับคะแนนส่วน A)
- **สำรองข้อมูล**: แท็บระบบ → ดาวน์โหลดคำถาม/จังหวัดเป็น JSON (รูปแบบเดียวกับ `data/`)

## โครงสร้าง

```
dist/play/              เว็บเล่นเกม: index.html, config.js, vendor/, data/, img/, vercel.json
dist/admin/             เว็บใส่ข้อมูล: index.html, config.js, vendor/, data/, img/, vercel.json
dist/pages/             GitHub Pages: เกมที่ราก + เว็บใส่ข้อมูลที่ /admin/ + sitemap.xml, ไอคอน, ภาพแชร์
dist/preview/           2 เว็บในหน้าเดียว (#admin) โหมดสาธิตเท่านั้น
config/site.json        ที่อยู่เว็บ + Supabase URL/publishable key + รหัสยืนยัน Google Search Console
src/shared/scoring.js   สูตรคะแนน ชุดรายวัน อันดับ (ใช้ร่วมกับเทสต์ Node)
src/shared/backend.js   ชั้นข้อมูลเดียวของทั้ง 2 เว็บ: Supabase หรือโหมดสาธิต
src/play/               เกม + หน้าแชร์ประสบการณ์
src/admin/              เว็บใส่ข้อมูล
supabase/schema.sql     ตาราง สิทธิ์ trigger bucket
supabase/seed.sql       ข้อมูลตั้งต้น (สร้างจาก data/ ทุกครั้งที่ build)
data/ img/              12 คำถาม + 77 จังหวัด + แผนที่ + ภาพ Wikimedia Commons
scripts/build.py        build ทุกอย่าง (Python 3 ไม่มี dependency)
scripts/deploy_pages.sh build แล้วส่ง dist/pages ขึ้น branch gh-pages
assets/                 favicon, ไอคอน, ภาพแชร์ลิงก์ (og-image.png)
scripts/data-pipeline/  สคริปต์สร้าง map.json / provinces.json ครั้งแรก (อ้างอิง)
test/                   scoring.test.js · rls_test.py
vendor/                 supabase-js 2.118.0 (MIT) โหลดเฉพาะตอนมี config
```

## แก้โค้ดแล้ว build / ทดสอบ

```bash
python3 scripts/build.py --share-url https://allthai-play.vercel.app   # → dist/* และ supabase/seed.sql
node test/scoring.test.js                                              # ALL TESTS PASSED
PGHOST=/tmp PGPORT=5432 python3 test/rls_test.py                       # ทดสอบสิทธิ์กับ Postgres ในเครื่อง (ห้ามชี้ไป Supabase จริง)
```
ถ้ามี `config/play.config.js` / `config/admin.config.js` (คัดลอกจาก `dist/*/config.js` ที่ใส่ค่าแล้ว) build จะใช้ไฟล์นั้น ค่าจริงจึงไม่หายตอน build ใหม่

## ข้อมูลคำถาม (คอลัมน์ `data` ในตาราง questions = รูปแบบเดียวกับ data/questions.json)

- `cards[0]` ภาพหลัก: `src`, `source` (commons / player / other), `credit`, `license`, `license_url`, `source_url`, `focus` (จุดโฟกัสภาพ), `submission_id` (ถ้ามาจากภาพผู้เล่น)
- `cards[1..3]` เบาะแสข้อความ: `text`, `tag_hint` = region / dialect / religion_culture / terrain / main_occupation หรือ null
- `similar` + `similar_reasons` = คะแนนส่วน B (500 คล้ายมาก · 250 คล้ายบ้าง)
- `reveal.image`, `reveal.facts` (ตามหมวด), `reveal.reasoning`, `reveal.sources` = `[{title, url}]`
- `status` = draft / published / archived · `verified_by`, `verified_at` · `published_at` (เซิร์ฟเวอร์ใส่ให้) · `schedule_date` · `note` (หมายเหตุภายใน)

## สูตรคะแนน (src/shared/scoring.js)

- ถูก 1000 · ผิด A + B (สูงสุด 900) · หมดเวลา 0 · คูณ 1.0 / 0.8 / 0.6 / 0.4 ตามจำนวนการ์ดที่เปิด
- ส่วน A ป้ายละ 80: ภาค (ภาคติดกัน 40) · ภาษาถิ่น · ศาสนา · ภูมิประเทศ (มีค่าร่วม) · อาชีพหลัก (อันดับ 1 ตรงกัน)
- รายวัน: หมวดละ 1 ข้อ หมุนตามวันที่เวลาไทย · โหมดไม่จำกัดสุ่มจากข้อที่เผยแพร่ ยกเว้นชุดของวันนี้

## ให้ Google ค้นเจอ

1. Google Search Console → เพิ่มพร็อพเพอร์ตี้แบบ **URL prefix** = `https://tonnot3t3.github.io/allthai/`
2. เลือกยืนยันด้วย **HTML tag** คัดลอกค่า `content="..."` ใส่ใน `config/site.json` ช่อง `googleSiteVerification` แล้ว `bash scripts/deploy_pages.sh` จากนั้นกด Verify
3. Sitemaps → ส่ง `sitemap.xml` · URL Inspection → Request indexing หน้าแรก
- หน้า `/admin/` ใส่ noindex ไว้แล้ว Google จะไม่เก็บ
- robots.txt ของ GitHub Pages แบบโปรเจกต์ต้องอยู่ที่ `tonnot3t3.github.io/robots.txt` (repo อื่น) จึงไม่ได้ใส่ ไม่จำเป็นต่อการค้นเจอ

## ยังไม่ได้ทำ / ต้องรู้ก่อนเปิดจริง

- **อันดับรวมทุกคน** ยังคิดคะแนนในเครื่องผู้เล่น ต้องย้ายการคิดคะแนนไปเซิร์ฟเวอร์ (เช่น Supabase Edge Function) ก่อนเปิดอันดับจริง และคำตอบของข้อที่เผยแพร่อ่านได้จาก API สาธารณะ
- **ข้อความยินยอมการใช้ภาพ** (`allthai-nonexclusive-v1`: ไม่ผูกขาด รวมเชิงพาณิชย์ ครอปได้ ใส่เครดิต) และ **นโยบายความเป็นส่วนตัว** สำหรับช่องติดต่อ (PDPA) ควรให้ผู้รู้กฎหมายดูก่อนเปิดรับภาพจริง
- ข้อมูลทั้ง 12 ข้อและป้าย 77 จังหวัดยังเป็นร่าง ต้องตรวจก่อนเผยแพร่
- เว็บบน `tonnot3t3.github.io` ทุก repo ใช้ origin เดียวกัน (localStorage ร่วมกัน รวมถึงการล็อกอินของเว็บใส่ข้อมูล) อย่าเอาโค้ดที่ไม่ไว้ใจขึ้น Pages ในบัญชีเดียวกัน หรือย้ายไปโดเมนของตัวเองเมื่อพร้อม

## สัญญาอนุญาต

- **แผนที่จังหวัด**: © OpenStreetMap contributors ผ่าน geoBoundaries — ODbL 1.0 · `data/map.json` ต้องเผยแพร่ภายใต้ ODbL
- **ประเทศเพื่อนบ้าน**: Natural Earth (public domain)
- **ภาพ Wikimedia Commons**: เครดิตใต้ภาพทุกภาพ · ภาพ CC BY-SA ที่ย่อ/แปลงไฟล์ยังเป็น CC BY-SA
- **ภาพผู้เล่น**: ใช้ตามที่ผู้ส่งยินยอม แสดง "ภาพ: ชื่อผู้ส่ง · ภาพจากผู้เล่นออลไทย"
- **ฟอนต์**: IBM Plex Sans Thai, Mitr — SIL OFL ผ่าน Google Fonts · **supabase-js**: MIT (`vendor/supabase-js.LICENSE`)
