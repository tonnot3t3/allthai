# data-pipeline (อ้างอิง)

สคริปต์ที่ใช้สร้าง `data/map.json` และ `data/provinces.json` ครั้งแรก เก็บไว้เผื่อต้องสร้างใหม่
ข้อมูลประจำวัน (คำถาม ป้ายจังหวัด) ให้แก้ในเว็บใส่ข้อมูลแทน

| ไฟล์ | ทำอะไร |
|---|---|
| `provinces_master.tsv` | รายชื่อ 77 จังหวัด: ISO, id, ชื่อไทย/อังกฤษ, ภาค 6 ภาค |
| `build_map.mjs` | geoBoundaries ADM1 (OSM, ODbL) ย่อด้วย mapshaper 10% + Natural Earth (เพื่อนบ้าน) → `data/map.json` (path SVG, จุดวางชื่อ, จังหวัดติดกัน) · ต้องมี `prov_10%.geojson`, `neighbors.geojson` ในโฟลเดอร์ที่รัน และ `npm i d3-geo polylabel` |
| `adj.mjs` | ตรวจจังหวัดที่มีพรมแดนติดกันจาก topology |
| `build_profiles.py` | สร้างป้ายจังหวัดร่าง (ภาค ภาษาถิ่น ศาสนา ภูมิประเทศ อาชีพ) → `data/provinces.json` **เขียนทับไฟล์เดิม** |

หลังสร้างใหม่ ถ้าใช้ Supabase แล้ว ให้นำเข้าผ่านเว็บใส่ข้อมูล (แท็บระบบ) หรือ `python3 scripts/build.py` เพื่อสร้าง `supabase/seed.sql` ใหม่
