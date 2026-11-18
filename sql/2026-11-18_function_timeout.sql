-- =====================================================================
-- 2026-11-18_function_timeout.sql
-- Quant Dashboard (ETF) · ทางเลือก ฉ — ติด statement_timeout ไว้กับฟังก์ชัน
-- =====================================================================
--
-- ปัญหาที่แก้
--   สเตป `Build fact sheets` ใน GitHub Actions ล้มด้วย SQLSTATE 57014
--   (canceling statement due to statement timeout) ที่ราววินาทีที่ 9
--   เพราะ session ที่เข้ามาทาง PostgREST ถือค่า statement_timeout = 8s
--   ของ login role `authenticator` มาด้วย และ `SET ROLE` ไม่ล้างค่านั้น
--   ส่วนงานสร้างแผ่น fact ใช้เวลาจริง 15-20 วินาที
--
-- วิธีแก้
--   Postgres ใช้ค่าที่ติดกับฟังก์ชันตลอดช่วงที่ฟังก์ชันนั้นรัน แล้วคืนค่าเดิม
--   ให้อัตโนมัติเมื่อฟังก์ชันจบ · ไฟล์นี้จึงยกเพดานเฉพาะสองฟังก์ชันที่สร้างแผ่น
--   ไม่แตะ role ไหนเลย
--
--   ผลที่ "ไม่" เปลี่ยน: anon ยังถูกจำกัด 3s · authenticated ยังถูกจำกัด 8s ·
--   RPC อื่นทุกตัวยังถูกจำกัด 8s · เนื้อฟังก์ชันทั้ง 275 บรรทัดไม่ถูกแก้ ·
--   ด่านตรวจ หน้าเว็บ workflow โค้ด Python เทสต์ RLS pg_cron ไม่ถูกแตะ
--
-- ทำไม 60 วินาที
--   เอกสาร Supabase ระบุว่า 60s คือค่าสูงสุดที่ตั้งได้สำหรับงานที่เรียกผ่าน
--   client · งานจริงอยู่ที่ 15-20 วินาที จึงเหลือที่ว่างราวสามเท่าเผื่อ B2b-2/B2b-3
--   ปรับค่าได้ด้วยการแก้เลขในไฟล์นี้แล้วรันซ้ำ ไม่ต้องแก้อะไรอื่น
--
-- ความปลอดภัยของไฟล์นี้ — ตรวจซ้ำได้ด้วยคำสั่งเหล่านี้
--   คำสั่งต้องตัดบรรทัดคอมเมนต์ออกก่อนนับ ไม่อย่างนั้นจะนับข้อความในหัวไฟล์นี้เอง
--   ตั้งค่า:  f=2026-11-18_function_timeout.sql
--
--   grep -vE '^[[:space:]]*--' "$f" | grep -ciE 'revoke|drop '                       -> 0
--   grep -vE '^[[:space:]]*--' "$f" | grep -ciE '\b(delete|update|insert|truncate)\b' -> 0
--   grep -vE '^[[:space:]]*--' "$f" | grep -ciE '\bcreate\b'                          -> 0
--   grep -vE '^[[:space:]]*--' "$f" | grep -c  'alter function'                       -> 2
--   grep -vE '^[[:space:]]*--' "$f" | grep -vE '^[[:space:]]*$' | wc -l               -> 44
--   (วัดเมื่อ 2026-11-18 · 44 บรรทัดนั้นคือ ด่านกันพลาด 1 บล็อก + alter 2 บรรทัด
--    + ด่านตรวจ 1 บล็อก + select 1 ชุด เท่านั้น · ทั้ง SQL และ plpgsql ถือ --
--    เป็นคอมเมนต์ จึงตัดออกได้โดยไม่เปลี่ยนพฤติกรรม · ไฟล์นี้ใช้คอมเมนต์แบบ
--    บรรทัดเดียวอย่างเดียว ไม่มีคอมเมนต์แบบบล็อก จึงไม่มีกรณีตัดคอมเมนต์พลาด)
--
--   ไฟล์นี้ไม่สร้าง ไม่ลบ และไม่แก้ข้อมูลแถวใดเลย · เปลี่ยนเฉพาะ pg_proc.proconfig
--   ของสองฟังก์ชัน · รันซ้ำได้ทั้งไฟล์ ผลลัพธ์เหมือนเดิมทุกครั้ง (idempotent)
--
-- การซ้อมก่อนส่ง (รันเมื่อ 2026-11-18 บนฐานข้อมูลจริง ครอบด้วย begin...rollback
-- ทุกครั้ง · ฐานข้อมูลจริงยังไม่ถูกเปลี่ยนจนกว่าจะรันไฟล์นี้ใน SQL Editor)
--
--   - รันเนื้อไฟล์ทั้งหมดผ่าน แล้วบังคับ rollback · ตรวจหลัง rollback ค่ากลับเป็น
--     [search_path=public, pg_temp] ทั้งสองฟังก์ชัน
--   - ค่าที่ Postgres เก็บจริงคือข้อความ `statement_timeout=60s` (ไม่ถูกแปลงหน่วย)
--     จึงเทียบด้วย = any(proconfig) ได้ตรงตัว
--   - สร้างแผ่นใหม่ด้วยค่านี้: 20.14 วินาที · created=t ·
--     ขนาดแผ่นก่อน 70152 ไบต์ หลัง 70152 ไบต์ · ไม่มีกลุ่มไหนเนื้อหาเปลี่ยน
--
--   ด่านทั้งสองพิสูจน์แล้วว่า "แดงได้" (ไม่ใช่ด่านที่เขียวตลอด):
--     - ด่านกันพลาด (ข้อ 0): ชื่อถูก -> นับได้ 2 ไม่ raise ·
--       ป้อนชื่อผิด ('catch_up_daily_facts_XX', 'build_daily_facts(text,boolean)')
--       -> นับได้ 0 และ raise ข้อความ 'หยุด: หาฟังก์ชันได้ 0 ตัว ...'
--     - ด่านตรวจ (ข้อ 2): รันบนสถานะก่อนตั้งค่า -> raise 'ด่านตรวจไม่ผ่าน:
--       ตั้งค่าได้ 0 ตัว (ต้องได้ 2)' · รันหลังตั้งค่า -> นับได้ 2 ไม่ raise
--     - select ข้อ 3: รันก่อนตั้งค่า -> 'FAIL' ทั้งสองแถว ·
--       รันหลังตั้งค่า -> 'ok' ทั้งสองแถว
--
--   บันทึกข้อผิดพลาดที่เจอตอนซ้อม (เพื่อไม่ให้รอบหน้าเขียนซ้ำ):
--     ฉบับแรกของด่านกันพลาดเทียบ signature ด้วย
--     pg_get_function_identity_arguments() ซึ่งคืน 'p_days integer' (มีชื่อ
--     พารามิเตอร์ติดมา) ไม่ใช่ 'integer' จึงนับได้ 0 ทั้งที่ฟังก์ชันมีอยู่จริง
--     — ฉบับนี้ประกอบ signature จาก proargtypes + format_type() แทน
--
-- ⚠️ ข้อควรระวังที่สำคัญที่สุด
--   `create or replace function` จะล้างค่านี้หายไปเงียบ ๆ
--   ไฟล์ใด ๆ ในอนาคตที่ replace สองฟังก์ชันนี้ (B2b-2 จะ replace แน่)
--   ต้องมีบรรทัด `set statement_timeout = '60s'` อยู่ในนิยามฟังก์ชัน
--   หรือรันไฟล์นี้ซ้ำหลังจากนั้น
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0) กันพลาด: ยืนยันว่าฟังก์ชันทั้งสองมีอยู่จริงก่อนแก้
-- ---------------------------------------------------------------------
do $$
declare n int;
begin
  -- ค้นจากแคตาล็อกด้วยชื่อ + ชนิดพารามิเตอร์ ไม่ใช้ 'ชื่อ'::regprocedure
  -- เพื่อให้นับได้ 0/1/2 (ถ้าใช้ cast จะ error ว่า "function does not exist"
  -- แทนข้อความภาษาไทยข้างล่างนี้)
  -- หมายเหตุ: ห้ามใช้ pg_get_function_identity_arguments เทียบ เพราะมันคืน
  -- ชื่อพารามิเตอร์มาด้วย ('p_days integer' ไม่ใช่ 'integer')
  select count(*) into n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname::text || '(' ||
        coalesce((select string_agg(format_type(t, null), ',' order by ord)
                  from unnest(p.proargtypes) with ordinality as u(t, ord)), '') || ')'
        in ('catch_up_daily_facts(integer)', 'build_daily_facts(date,boolean)');

  if n <> 2 then
    raise exception
      'หยุด: หาฟังก์ชันได้ % ตัว (ต้องได้ 2) — ชื่อหรือ signature อาจเปลี่ยนไป ห้ามรันต่อ', n;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 1) ติดค่า statement_timeout ไว้กับฟังก์ชัน
--    ค่าเดิม search_path=public, pg_temp ยังอยู่ครบ (คำสั่ง set เพิ่มทีละตัว)
-- ---------------------------------------------------------------------
alter function public.catch_up_daily_facts(integer)    set statement_timeout = '60s';
alter function public.build_daily_facts(date, boolean) set statement_timeout = '60s';


-- ---------------------------------------------------------------------
-- 2) ด่านตรวจแบบเครื่องตรวจ: ถ้าไม่ครบสองตัว ให้ล้มทั้งไฟล์
--    (พิสูจน์แล้วว่าแดงได้ — ดูหัวข้อ "การซ้อมก่อนส่ง" ด้านบน)
-- ---------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n
  from pg_proc p
  where p.oid in ('public.catch_up_daily_facts(integer)'::regprocedure,
                  'public.build_daily_facts(date, boolean)'::regprocedure)
    and 'statement_timeout=60s' = any(p.proconfig);

  if n <> 2 then
    raise exception 'ด่านตรวจไม่ผ่าน: ตั้งค่าได้ % ตัว (ต้องได้ 2)', n;
  end if;

  raise notice 'ด่านตรวจผ่าน: ตั้ง statement_timeout=60s ครบทั้ง 2 ฟังก์ชัน';
end $$;


-- ---------------------------------------------------------------------
-- 3) ตารางผลลัพธ์ให้อ่านด้วยตา (statement สุดท้าย — SQL Editor จะแสดงอันนี้)
--    ต้องได้ 2 แถว คอลัมน์ "ผล" เป็น ok ทั้งคู่
-- ---------------------------------------------------------------------
select
  p.oid::regprocedure::text                                        as "ฟังก์ชัน",
  coalesce(array_to_string(p.proconfig, ' · '), '(ไม่มีค่าติดไว้)') as "ค่าที่ติดกับฟังก์ชัน",
  case when 'statement_timeout=60s' = any(p.proconfig)
       then 'ok'
       else 'FAIL - ไม่มี statement_timeout=60s'
  end                                                              as "ผล"
from pg_proc p
where p.oid in (
  'public.catch_up_daily_facts(integer)'::regprocedure,
  'public.build_daily_facts(date, boolean)'::regprocedure
)
order by 1;


-- =====================================================================
-- คำสั่งตรวจหลังรัน
-- =====================================================================
--
-- (ก) ตรวจว่าค่ายังอยู่ (รันได้ทุกเมื่อ ใช้เป็นคำสั่งตรวจประจำของรอบถัดไป)
--
--   select
--     p.oid::regprocedure::text as fn,
--     coalesce(array_to_string(p.proconfig, ' | '), '(null)') as proconfig,
--     case when 'statement_timeout=60s' = any(p.proconfig) then 'ok' else 'FAIL' end as result
--   from pg_proc p
--   where p.oid in ('public.catch_up_daily_facts(integer)'::regprocedure,
--                   'public.build_daily_facts(date, boolean)'::regprocedure)
--   order by 1;
--
--   คาดหวัง: 2 แถว · result = ok ทั้งคู่
--
--
-- (ข) ตรวจว่า role ไม่ถูกแตะ (ต้องไม่มีอะไรเปลี่ยนจากเดิม)
--
--   select rolname, rolconfig
--   from pg_roles
--   where rolname in ('authenticator','anon','authenticated','service_role')
--   order by rolname;
--
--   คาดหวัง: authenticator มี statement_timeout=8s · anon มี 3s ·
--            authenticated มี 8s · ไฟล์นี้ไม่เปลี่ยนค่าเหล่านี้
--
--
-- (ค) ตรวจของจริง — พรุ่งนี้ (19 พ.ย.) หลัง workflow รอบประจำวันเดิน
--
--   1. GitHub Actions → workflow `daily-fetch` → สเตป `Build fact sheets` ต้องเขียว
--   2. แผ่น fact ต้องเกิดในรอบเดียวกับที่ราคาลง:
--
--      select f.trade_date, f.generated_at, f.facts_version
--      from public.daily_facts f
--      order by f.trade_date desc
--      limit 3;
--
--      select source, status, finished_at
--      from public.fetch_log
--      order by finished_at desc
--      limit 5;
--
--      คาดหวัง: generated_at ของแถวล่าสุด อยู่ในช่วงเวลาเดียวกับ finished_at
--               ของรอบดึงราคาล่าสุด (ห่างกันไม่เกินไม่กี่นาที)
--
--   3. ถ้ายังแดงด้วย 57014 แปลว่า PostgREST ไม่เคารพค่าที่ติดกับฟังก์ชัน
--      → ถอยไปทางเลือก จ. (ย้ายการสร้างแผ่นไปเส้นทางที่ไม่ผ่าน PostgREST)
--
--
-- (ง) วิธีถอนการเปลี่ยนแปลงนี้ (ถ้าต้องการกลับไปสถานะเดิมเป๊ะ)
--
--   alter function public.catch_up_daily_facts(integer)    reset statement_timeout;
--   alter function public.build_daily_facts(date, boolean) reset statement_timeout;
--
--   แล้วรันคำสั่ง (ก) อีกครั้ง · คาดหวัง: proconfig เหลือ
--   `search_path=public, pg_temp` และ result = FAIL ทั้งสองแถว
--
-- =====================================================================
