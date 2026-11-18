-- =====================================================================
-- Quant Dashboard (ETF) — คลังเก็บบทสรุปทุกฉบับ (รอบแข็ง ส่วนที่ 2)
-- วันที่: 17 พ.ย. 2026
--
-- ปัญหาที่ไฟล์นี้แก้
-- --------------------------------------------------------------------
-- `brief.py` เรียก store() ท้ายทุกรอบ ซึ่ง "ถ้าวันข้อมูลนี้มีแถวอยู่แล้ว
-- ให้ update ทับ" · แถวนั้นคือสำเนาเดียวที่มี เขียนทับแล้วหายถาวร
--
-- รอบปกติยิงวันละครั้งและยิงซ้ำด้วย trade_date เดิมจนกว่าจะผ่านด่าน
-- (`should_skip_published()` กันเฉพาะฉบับที่ published แล้ว ฉบับที่ held
-- ไม่ถูกกัน) · หน้าต่างหนึ่งสัปดาห์จึงยิงได้ราว 2-3 ครั้ง และทุกครั้ง
-- ลบครั้งก่อนทิ้ง พร้อม validation_log ของมัน ซึ่งเป็นวัตถุดิบเดียว
-- ที่บอกได้ว่าโมเดลพลาดแบบไหนและด่านไหนเข้มเกินไป
--
-- 17 พ.ย. 2026 เห็นของจริง: รันบนแผ่นเดียวกันสองรอบ รอบแรกถูกกัก
-- รอบสองผ่าน · ถ้าสองรอบนั้นเขียนลงฐาน รอบสองจะลบรอบแรกทิ้ง และจะไม่มี
-- ทางเห็นว่าด่านตัดสินกลับด้านบนเนื้อหาเดียวกัน
--
-- ทางที่เลือก (ทางเลือก ค.)
-- --------------------------------------------------------------------
-- ตารางคลังแยก + trigger ที่ฐานข้อมูล · เหตุผลที่เลือกแบบนี้:
--   * **ลืมไม่ได้** — ต่อให้วันหนึ่งมีสคริปต์อื่นมา update ตารางนี้ หรือมี
--     คนแก้แถวจาก SQL Editor เอง คลังก็ยังได้สำเนา เพราะดักที่ชั้นที่
--     ต่ำกว่าโค้ด · ทางเลือกที่ให้ Python เก็บเองมีจุดที่ลืมได้เสมอ
--   * **ตารางหลักไม่เปลี่ยนรูป** — ยังหนึ่งแถวต่อ trade_date เหมือนเดิม
--     หน้าเว็บ แท็บ Brief RLS และ query ทุกตัวไม่ต้องแตะ
--   * **`brief.py` ไม่ต้องแก้แม้แต่บรรทัดเดียว**
--
-- ไฟล์นี้ทำอะไรบ้าง
-- --------------------------------------------------------------------
--   1. ตาราง  public.daily_brief_revision   (เขียนอย่างเดียว ไม่มีใครลบ)
--   2. index  2 ตัว
--   3. ฟังก์ชัน public.archive_daily_brief()  + trigger บน daily_brief
--   4. RLS: SELECT ให้ authenticated เท่านั้น
--   5. คำสั่งตรวจหลังรัน (ส่วนที่ 6 ท้ายไฟล์)
--
-- คำยืนยันเรื่องความปลอดภัย — ตรวจซ้ำได้ด้วยสองคำสั่งนี้
-- --------------------------------------------------------------------
-- (1) คำสั่งทำลายที่ห้ามมี — ต้องได้ 0 บรรทัด
--     grep -nEi '\b(revoke|truncate|drop[ ]+(table|function|view|policy|index))\b' \
--       2026-11-17_brief_revision.sql | grep -vE ':\s*--'
--
-- (2) ทุกบรรทัดที่มีคำ delete/update/drop และไม่ใช่คอมเมนต์ — ต้องได้ 6 บรรทัด
--     grep -nEi '\b(delete|update|drop)\b' 2026-11-17_brief_revision.sql \
--       | grep -vE ':\s*--'
--     และต้องเป็น 6 บรรทัดนี้เท่านั้น (เลขบรรทัดอาจเลื่อนถ้ามีคนแก้ไฟล์):
--       · check (archived_reason in ('update','delete'))   ← ค่าที่ยอมให้เก็บ
--       · if tg_op = 'UPDATE'                              ← อ่านชนิดเหตุการณ์
--       · if tg_op = 'DELETE' then                         ← อ่านชนิดเหตุการณ์
--       · comment ของฟังก์ชัน (คำว่า update อยู่ในข้อความ)
--       · drop trigger if exists trg_archive_daily_brief   ← ของไฟล์นี้เอง
--       · before update or delete on public.daily_brief    ← นิยามทริกเกอร์
--     ไม่มีคำสั่งใดในไฟล์นี้ที่ลบหรือแก้ข้อมูลที่มีอยู่
--     `drop trigger if exists` จำเป็นเพราะ create trigger ไม่มี `or replace`
--     เป็น trigger ที่ไฟล์นี้สร้างเอง และสร้างคืนทันทีในบรรทัดถัดไป
--
-- ไม่ backfill: คลังเริ่มนับจากการเขียนทับครั้งแรกหลังรันไฟล์นี้
--   สามแถวที่มีอยู่ตอนนี้ยังเป็นของจริงใน daily_brief ไม่ใช่ประวัติ
--   ถ้าคัดลอกเข้าคลังตอนนี้จะได้สำเนาซ้ำที่แยกจากของจริงไม่ออก
--
-- รันซ้ำได้ทั้งไฟล์
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ตารางคลัง
-- ---------------------------------------------------------------------
-- ⛔ ตั้งใจไม่มี foreign key กลับไป daily_brief
--    วันที่ใครลบบทสรุปแถวหนึ่ง จะเหลือสองทางที่แย่ทั้งคู่: ลบไม่ได้
--    หรือ cascade ลบประวัติทิ้งในวินาทีที่มันมีค่าที่สุด
--    (เหตุผลเดียวกับตาราง *_snapshot ของประวัติสมาชิก 17 พ.ย.)

create table if not exists public.daily_brief_revision (
  id              bigint generated always as identity primary key,
  brief_id        bigint      not null,   -- daily_brief.id ของต้นฉบับ (ไม่ใช่ FK)
  trade_date      date        not null,
  publish_date    date,
  body_th         text,
  body_json       jsonb,
  model           text,
  prompt_version  text,
  status          text        not null,   -- สถานะ ณ ตอนที่ถูกเก็บ ไม่ใช่ตอนนี้
  validation_log  jsonb       not null default '[]'::jsonb,
  created_at      timestamptz not null,   -- created_at ของแถวต้นฉบับ
  archived_at     timestamptz not null default now(),
  archived_reason text        not null
                  check (archived_reason in ('update','delete'))
);

comment on table public.daily_brief_revision is
  'สำเนาของ daily_brief ทุกครั้งก่อนถูกเขียนทับหรือลบ · เขียนโดย trigger '
  'trg_archive_daily_brief เท่านั้น ไม่มีโค้ดฝั่ง Python เขียนตารางนี้ '
  '· เขียนอย่างเดียว ไม่มีใครลบ';

comment on column public.daily_brief_revision.status is
  'สถานะของฉบับนั้น ณ ตอนที่ถูกเก็บเข้าคลัง (held/published/draft) '
  'ไม่ใช่สถานะปัจจุบันของ trade_date นั้น';


-- ---------------------------------------------------------------------
-- 2. index
-- ---------------------------------------------------------------------
-- คำถามที่ถามบ่อยสองแบบ: "วันนั้นมีกี่ฉบับ อะไรบ้าง" และ
-- "บทสรุปแถวนี้เคยถูกเขียนทับมากี่ครั้ง"

create index if not exists daily_brief_revision_by_date
  on public.daily_brief_revision (trade_date, archived_at desc);

create index if not exists daily_brief_revision_by_brief
  on public.daily_brief_revision (brief_id, archived_at desc);


-- ---------------------------------------------------------------------
-- 3. trigger
-- ---------------------------------------------------------------------
-- ⛔ ตั้งใจไม่เป็น security definer
--    daily_brief ไม่มี policy ให้เขียนเลยสักตัว (มีแต่ SELECT สองตัว)
--    ผู้เขียนจริงจึงมีแค่ service_role ของ brief.py กับ postgres
--    ซึ่ง bypass RLS อยู่แล้ว · การใส่ security definer จะเปิดช่อง
--    ยกระดับสิทธิ์โดยไม่ได้แก้ปัญหาอะไรเพิ่ม
--
--    ผลข้างเคียงที่ตั้งใจ: ถ้าวันหนึ่งมีใครเปิด policy ให้ authenticated
--    เขียน daily_brief ได้ การ update ของเขาจะ "ล้มทั้งคำสั่ง" เพราะ
--    trigger เขียนคลังไม่ได้ · ซึ่งดีกว่าการที่มันสำเร็จแบบเงียบ ๆ
--    โดยไม่มีสำเนา

create or replace function public.archive_daily_brief()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- update ที่ไม่ได้เปลี่ยนเนื้อหาอะไรเลย ไม่ต้องเก็บสำเนา
  -- ใช้ `is distinct from` ไม่ใช่ `<>` เพราะคอลัมน์ส่วนใหญ่เป็น null ได้
  -- และ `null <> null` ให้ null ซึ่งอ่านเป็นเท็จ ทำให้เงื่อนไขพัง
  if tg_op = 'UPDATE'
     and old.body_json      is not distinct from new.body_json
     and old.body_th        is not distinct from new.body_th
     and old.status         is not distinct from new.status
     and old.validation_log is not distinct from new.validation_log
     and old.model          is not distinct from new.model
     and old.prompt_version is not distinct from new.prompt_version
     and old.publish_date   is not distinct from new.publish_date
  then
    return new;
  end if;

  insert into public.daily_brief_revision (
    brief_id, trade_date, publish_date, body_th, body_json,
    model, prompt_version, status, validation_log, created_at, archived_reason)
  values (
    old.id, old.trade_date, old.publish_date, old.body_th, old.body_json,
    old.model, old.prompt_version, old.status, old.validation_log,
    old.created_at, lower(tg_op));

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

comment on function public.archive_daily_brief() is
  'เก็บสำเนาแถวเดิมของ daily_brief เข้า daily_brief_revision ก่อนถูก '
  'เขียนทับหรือลบ · update ที่เนื้อหาไม่เปลี่ยนเลยจะไม่สร้างสำเนา';

drop trigger if exists trg_archive_daily_brief on public.daily_brief;
create trigger trg_archive_daily_brief
  before update or delete on public.daily_brief
  for each row execute function public.archive_daily_brief();


-- ---------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------
-- Supabase ให้สิทธิ์ตารางใหม่กับ anon/authenticated ครบทุกอย่าง
-- โดยอัตโนมัติ · RLS คือสิ่งเดียวที่กั้นจริง จึงต้องเปิดและให้เฉพาะ
-- SELECT กับ authenticated · ไม่มี policy ให้เขียน ลบ หรือแก้เลย
--
-- ⚠️ anon อ่านไม่ได้โดยตั้งใจ · ถ้าวันหนึ่งทำหน้าสาธารณะที่ต้องโชว์
--    ประวัติการแก้ ต้องเพิ่ม policy ให้ anon ก่อน และต้องคิดด้วยว่า
--    ฉบับที่ตกด่านควรให้คนนอกเห็นหรือไม่ (คำตอบตอนนี้คือไม่ควร)

alter table public.daily_brief_revision enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'daily_brief_revision'
      and policyname = 'daily_brief_revision_select')
  then
    create policy daily_brief_revision_select
      on public.daily_brief_revision
      for select to authenticated using (true);
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 5. ยืนยันว่าของครบ (รันแล้วต้องได้ ok ทุกบรรทัด)
-- ---------------------------------------------------------------------

select 'ตารางคลัง'  as สิ่งที่ตรวจ,
       case when to_regclass('public.daily_brief_revision') is not null
            then 'ok' else '❌ ไม่มี' end as ผล
union all
select 'trigger',
       case when exists (select 1 from pg_trigger
                         where tgname = 'trg_archive_daily_brief'
                           and not tgisinternal)
            then 'ok' else '❌ ไม่มี' end
union all
select 'RLS เปิด',
       case when (select relrowsecurity from pg_class
                  where oid = 'public.daily_brief_revision'::regclass)
            then 'ok' else '❌ ปิดอยู่' end
union all
select 'policy อ่านอย่างเดียว',
       case when (select string_agg(distinct cmd, ',') from pg_policies
                  where schemaname='public' and tablename='daily_brief_revision')
            = 'SELECT' then 'ok' else '❌ มี policy เขียน' end
order by 1;


-- =====================================================================
-- 6. คำสั่งตรวจหลังรัน — คัดลอกไปรันแยกเมื่อต้องการ
-- =====================================================================
--
-- 6.1 ซ้อมให้เห็นกับตาว่า trigger ทำงาน (ปลอดภัย ย้อนกลับเองทั้งหมด)
--     รันทั้งบล็อกรวด ผลคือ 1 แถวในคลังระหว่างทาง แล้ว rollback ทิ้ง
--
-- begin;
--   insert into public.daily_brief (trade_date, body_th, status, model)
--   values ('1999-01-01', 'ฉบับที่หนึ่ง', 'held', 'ทดสอบ');
--   update public.daily_brief set body_th = 'ฉบับที่สอง'
--    where trade_date = '1999-01-01';
--   select archived_reason, status, body_th, archived_at
--     from public.daily_brief_revision where trade_date = '1999-01-01';
--   -- ↑ ต้องได้ 1 แถว · archived_reason = update · body_th = ฉบับที่หนึ่ง
-- rollback;
--
-- 6.2 ทุกฉบับของวันหนึ่ง เรียงตามเวลา
--
-- select archived_at, archived_reason, status, prompt_version, model,
--        jsonb_array_length(validation_log) as จุดที่ตก
-- from public.daily_brief_revision
-- where trade_date = '2026-11-21'
-- order by archived_at;
--
-- 6.3 ด่านไหนจับบ่อยที่สุด — ของที่ใช้ตัดสินใจจริงว่าจะแก้ prompt ตรงไหน
--
-- select v ->> 'code' as รหัส, v ->> 'gate' as ด่าน, count(*) as ครั้ง
-- from public.daily_brief_revision r,
--      lateral jsonb_array_elements(r.validation_log) v
-- group by 1, 2 order by ครั้ง desc;
--
-- 6.4 กว่าจะผ่านต้องยิงกี่ครั้ง (นับฉบับในคลัง + ฉบับที่อยู่ในตารางหลัก)
--
-- select trade_date, count(*) + 1 as จำนวนครั้งที่ยิง
-- from public.daily_brief_revision
-- group by 1 order by 1 desc;
--
-- 6.5 เทียบหัวข้อแรกของฉบับเก่ากับฉบับปัจจุบัน
--
-- select r.archived_at,
--        r.body_json -> 'sections' -> 0 ->> 'text' as ฉบับเก่า,
--        b.body_json -> 'sections' -> 0 ->> 'text' as ฉบับปัจจุบัน
-- from public.daily_brief_revision r
-- join public.daily_brief b using (trade_date)
-- where r.trade_date = '2026-11-21'
-- order by r.archived_at;
--
-- 6.6 ลายเซ็นของฟังก์ชัน — รอบหน้าวัดซ้ำด้วยคำสั่งนี้
--     ถ้าค่าเปลี่ยนแปลว่ามีคนแก้สดในฐานข้อมูลโดยไม่ผ่านไฟล์
--
-- select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) as md5
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'archive_daily_brief';
--
-- 6.7 ขนาดคลัง เผื่อวันหนึ่งอยากรู้
--
-- select count(*) as แถว,
--        pg_size_pretty(pg_total_relation_size('public.daily_brief_revision')) as ขนาด
-- from public.daily_brief_revision;
-- =====================================================================
