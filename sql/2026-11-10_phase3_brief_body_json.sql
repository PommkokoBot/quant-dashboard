-- Phase 3 (รอบ B) -- ที่เก็บบทสรุปแบบมีโครงสร้าง
--
-- daily_brief เดิมมีแต่ body_th ซึ่งเป็นข้อความแบน · รอบ C ต้องแสดงตัวเลขกับ
-- การตีความคนละแบบบนหน้า /brief/ และด่านตรวจทำงานรายประโยค ไม่ใช่รายเอกสาร
-- ถ้าเก็บแต่ข้อความแบนตั้งแต่วันนี้ โครงที่ AI คืนมาจะกู้กลับไม่ได้เลย
--
-- รูปของ body_json:
--   {"sections":[{"heading":"...","sentences":[{"text":"...","facts":["pair.qqq_spy.spread"]}]}]}
--
-- ไม่ใช่ตารางใหม่ จึงไม่ต้องเปิด RLS เพิ่ม -- daily_brief เปิดอยู่แล้วและ
-- policy เดิม (anon เห็นเฉพาะ status='published') ครอบคอลัมน์ใหม่ให้เองทั้งหมด

alter table public.daily_brief
  add column if not exists body_json jsonb;

comment on column public.daily_brief.body_json is
  'โครงที่โมเดลคืนมา: sections[].sentences[] โดยแต่ละประโยคอ้าง fact id ที่มีจริงในแผ่นของวันนั้น · body_th คือข้อความที่ประกอบจากโครงนี้ ไม่ใช่แหล่งข้อมูลหลัก';
