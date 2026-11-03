-- =====================================================================
-- Quant Dashboard — Phase 1
-- อ้างอิง: claude/tool-quant-dashboard.md ข้อ 11.9 (และเกณฑ์ใน 11.1)
--
-- วิธีรัน : Supabase SQL Editor → วางทั้งไฟล์ → Run  (ไม่ผ่าน MCP ตามบทเรียนข้อ 8.8)
-- ปลอดภัย : ไม่มีคำสั่ง revoke / drop policy / delete ทั้งไฟล์
--           รันซ้ำได้ (idempotent) — create if not exists / on conflict do nothing
--           ไม่แตะตาราง ฟังก์ชัน หรือ policy เดิมแม้แต่ตัวเดียว
--
-- ทดสอบแล้ว: รันทั้งไฟล์จริงบนฐานข้อมูล nsbreucmgfmphmfewnbw ใน transaction
--           ที่ปิดท้ายด้วย rollback (ยืนยันหลังจบว่าไม่มี object ตกค้างเลย)
--           backfill 12 ไตรมาส = 1,116 แถว ใช้เวลา 2.6 วินาที
--           SPY ได้ beta = 1.000000 และ downside capture = 100.0000 เป๊ะ
--           anon อ่านได้ 4 ตารางตามที่ตั้งใจ · เขียนถูก RLS ปฏิเสธจริง
-- =====================================================================


-- =====================================================================
-- 1.1  view instruments_active
--      registry ทุกตัวต้องอ่านจาก view นี้ ไม่อ่าน instruments ตรง ๆ
--      ตั้งใจไม่มีคอลัมน์ is_active ใน view เพื่อให้ "ลืมกรอง" ไม่ได้
-- =====================================================================
create or replace view public.instruments_active
with (security_invoker = true) as
select id, ticker, name, category, theme, market, created_at
from public.instruments
where is_active;

comment on view public.instruments_active is
  'กองที่ยังใช้งาน (is_active) — Phase 1 ข้อ 1.1 · registry/fact sheet ต้องอ่านจาก view นี้เท่านั้น · security_invoker = RLS ของ instruments มีผลตามเดิม';

grant select on public.instruments_active to authenticated, service_role;


-- =====================================================================
-- 1.2  ตาราง classification_rule — Peat แก้เองได้ใน Table Editor
--      ขอบเขตเป็นช่วงครึ่งเปิด: min_value <= x < max_value
--      hysteresis / confirm_quarters เก็บคู่กับกฎที่มันคุม
-- =====================================================================
create table if not exists public.classification_rule (
  priority          int  primary key,
  code              text not null unique,
  label_th          text not null,
  label_en          text not null,
  metric            text not null check (metric in ('beta','downside_capture')),
  min_value         double precision,
  max_value         double precision,
  hysteresis        double precision not null default 0 check (hysteresis >= 0),
  confirm_quarters  int  not null default 1 check (confirm_quarters between 1 and 8),
  note              text
);

comment on table public.classification_rule is
  'เกณฑ์แบ่งกลุ่มสินทรัพย์ 4 กลุ่ม — Phase 1 ข้อ 1.2 · เช็คตาม priority จากน้อยไปมาก · ช่วงเป็นครึ่งเปิด min <= x < max · แก้ค่าที่นี่ได้ แต่ช่วงการวัด (156 สัปดาห์) อยู่ใน method_version ของฟังก์ชัน แก้ไม่ได้จากตารางนี้';

insert into public.classification_rule
  (priority, code,             label_th,        label_en,               metric,             min_value, max_value, hysteresis, confirm_quarters, note)
values
  (1, 'negative_corr', 'สวนทางตลาด',   'Negative Correlation', 'downside_capture', null,  0.0,  0,    2,
      'เช็คก่อนทุกกลุ่ม เพราะ beta กับ correlation เป็นคนละแกน · ต้องเข้าเกณฑ์ 2 ไตรมาสติดกันจึงติดป้าย'),
  (2, 'low_beta',      'Low Beta',      'Low Beta',             'beta',             null,  0.7,  0.05, 1, null),
  (3, 'market_beta',   'Market Beta',   'Market Beta',          'beta',             0.7,   1.2,  0.05, 1, null),
  (4, 'high_beta',     'High Beta',     'High Beta',            'beta',             1.2,   null, 0.05, 1, null)
on conflict (priority) do nothing;


-- =====================================================================
-- 1.3  ตาราง instrument_classification — 1 แถว = 1 กอง x 1 ไตรมาส
--      ไม่ทับของเก่า (on conflict do nothing ในฟังก์ชัน)
--      ticker เก็บซ้ำไว้โดยตั้งใจ เพราะ anon อ่าน instruments ไม่ได้
-- =====================================================================
create table if not exists public.instrument_classification (
  as_of_quarter       date   not null,
  instrument_id       bigint not null references public.instruments(id),
  ticker              text   not null,
  beta                double precision,
  downside_capture    double precision,
  weeks               int    not null,
  window_start        date,
  window_end          date,
  bucket              text   not null,
  bucket_raw          text,
  prev_bucket         text,
  quarters_in_bucket  int    not null default 1,
  rule_version        text   not null,
  method_version      text   not null,
  source              text   not null check (source in ('live','backfilled')),
  computed_at         timestamptz not null default now(),
  primary key (as_of_quarter, instrument_id)
);

comment on table public.instrument_classification is
  'ผลแบ่งกลุ่มรายไตรมาส — Phase 1 ข้อ 1.3 · bucket = หลังใช้ hysteresis/confirm แล้ว · bucket_raw = ก่อนใช้ (ไว้ตรวจย้อน) · source backfilled = คำนวณย้อนหลัง ไม่ใช่เลขที่คนเห็นในวันนั้น';

-- FK index: กัน advisor ขึ้นคำเตือน unindexed foreign key เพิ่ม
create index if not exists instrument_classification_instrument_idx
  on public.instrument_classification (instrument_id, as_of_quarter desc);


-- =====================================================================
-- 1.4  ฟังก์ชัน compute_classification(as_of, source)
--
--  วิธีวัด (ตรึงไว้ในโค้ด ไม่ใช่ setting — ประทับเป็น method_version ทุกแถว):
--    * ผลตอบแทนรายสัปดาห์จาก adj_close (สัปดาห์ = ISO จันทร์-อาทิตย์
--      ใช้ราคาปิดวันทำการสุดท้ายของสัปดาห์)
--      อ่านจาก ohlcv_daily.adj_close ตรง ๆ ไม่ผ่าน ohlcv_adj โดยตั้งใจ:
--      ฟังก์ชันนี้ไม่แตะ high/low/open เลย จึงไม่เข้าข้อห้ามในข้อ 7
--      (adj_close ใน ohlcv_daily ปรับแล้วอยู่แล้ว) และการเลี่ยง view
--      ตัดการคูณราคาทุกแถวทิ้ง ซึ่งเป็นต้นทุนหลักของคิวรีนี้
--    * ใช้เฉพาะ "สัปดาห์ที่จบแล้ว" — ตัดสัปดาห์ที่คร่อม as_of ออกเสมอ
--    * หน้าต่าง = 156 สัปดาห์ล่าสุดของ benchmark (SPY) ที่จบแล้ว
--    * beta             = covar_samp(r, r_spy) / var_samp(r_spy)
--    * downside capture = 100 * mean(r | r_spy < 0) / mean(r_spy | r_spy < 0)
--                         (ใช้ค่าเฉลี่ยเลขคณิต ตรงกับตัวเลขในข้อ 11.1)
--    * มีข้อมูลร่วมกับ benchmark < 104 สัปดาห์ -> bucket = 'unclassified'
--
--  SECURITY INVOKER: การเขียนถูกคุมด้วย RLS (ไม่มี insert policy ให้ใคร)
--  pg_cron รันในนาม postgres ซึ่งเป็นเจ้าของตาราง จึงเขียนได้
-- =====================================================================
create or replace function public.compute_classification(
  p_as_of  date default current_date,
  p_source text default 'live'
)
returns table (
  quarter_start  date,
  n_inserted     int,
  n_skipped      int,
  n_unclassified int
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  c_weeks      constant int  := 156;
  c_min_weeks  constant int  := 104;
  c_method     constant text := 'weekly-156w-min104-betacov-dcapmean-v1';
  v_quarter    date;
  v_prev_q     date;
  v_cut        date;   -- วันจันทร์ของสัปดาห์ที่คร่อม as_of: ทุกวันก่อนหน้านี้คือสัปดาห์ที่จบแล้ว
  v_bench      bigint;
  v_rule_ver   text;
  v_w0         date;
  v_w1         date;
  v_before     int;
  v_after      int;
  v_total      int;
  v_unc        int;
begin
  if p_source not in ('live','backfilled') then
    raise exception 'p_source ต้องเป็น live หรือ backfilled (ได้รับ: %)', p_source;
  end if;

  v_quarter := date_trunc('quarter', p_as_of)::date;
  v_prev_q  := (date_trunc('quarter', p_as_of) - interval '3 months')::date;
  v_cut     := date_trunc('week', p_as_of)::date;

  select id into v_bench from public.instruments_active where ticker = 'SPY';
  if v_bench is null then
    raise exception 'ไม่พบ benchmark SPY ใน instruments_active';
  end if;

  -- รุ่นของชุดกฎ: เปลี่ยนค่าในตารางเมื่อไร ลายเซ็นนี้เปลี่ยนทันที
  select md5(string_agg(
           priority || '|' || code || '|' || metric || '|' ||
           coalesce(min_value::text,'') || '|' || coalesce(max_value::text,'') || '|' ||
           hysteresis || '|' || confirm_quarters, ';' order by priority))
    into v_rule_ver
    from public.classification_rule;

  if v_rule_ver is null then
    raise exception 'classification_rule ว่าง — ยังไม่มีเกณฑ์ให้ใช้';
  end if;

  select count(*) into v_total from public.instruments_active;

  select count(*), count(*) filter (where ic.bucket = 'unclassified')
    into v_before, v_unc
    from public.instrument_classification ic where ic.as_of_quarter = v_quarter;

  -- ไตรมาสนี้ครบแล้ว: ออกทันทีโดยไม่คำนวณอะไรเลย
  -- ทำให้ backfill รันซ้ำได้ถูก ๆ และรันเป็นช่วง ๆ ต่อกันได้ถ้าเจอ timeout
  if v_before >= v_total then
    quarter_start  := v_quarter;
    n_inserted     := 0;
    n_skipped      := v_total;
    n_unclassified := v_unc;
    return next;
    return;
  end if;

  -- ---------- หน้าต่างการวัด: 156 ผลตอบแทนรายสัปดาห์ล่าสุดของ benchmark ----------
  with weekly as materialized (
    select date_trunc('week', a.date)::date as wk,
           (array_agg(a.adj_close order by a.date desc))[1]::float8 as c
    from public.ohlcv_daily a
    where a.instrument_id = v_bench
      and a.date >= v_cut - 1200     -- ~171 สัปดาห์ เผื่อจาก 157 ที่ต้องใช้
      and a.date <  v_cut            -- เฉพาะสัปดาห์ที่จบแล้ว (sargable)
    group by 1
  ),
  r as materialized (
    select wk, c / nullif(lag(c) over (order by wk), 0) - 1 as ret from weekly
  )
  select min(t.wk), max(t.wk) into v_w0, v_w1
  from (select wk from r where ret is not null order by wk desc limit c_weeks) t;

  if v_w0 is null then
    raise exception 'ไม่มีข้อมูลราคาของ benchmark ก่อน % พอจะสร้างหน้าต่างการวัด', p_as_of;
  end if;

  -- ---------- สถิติรายกอง -> ตัดสินกลุ่ม -> บันทึก ----------
  insert into public.instrument_classification (
    as_of_quarter, instrument_id, ticker, beta, downside_capture, weeks,
    window_start, window_end, bucket, bucket_raw, prev_bucket, quarters_in_bucket,
    rule_version, method_version, source)
  -- materialized ทุกชั้นโดยตั้งใจ: CTE ที่ถูกอ้างหลายครั้งถ้าปล่อยให้ Postgres inline
  -- จะคำนวณ weekly ใหม่ทุกครั้งที่ถูกอ้าง (บทเรียนข้อ 8.7) — วัดแล้วต่างกันสิบเท่า
  with weekly as materialized (
    select a.instrument_id,
           date_trunc('week', a.date)::date as wk,
           (array_agg(a.adj_close order by a.date desc))[1]::float8 as c
    from public.ohlcv_daily a
    join public.instruments_active i on i.id = a.instrument_id
    where a.date >= v_cut - 1200
      and a.date <  v_cut
    group by 1, 2
  ),
  rets as materialized (
    select instrument_id, wk,
           c / nullif(lag(c) over (partition by instrument_id order by wk), 0) - 1 as ret
    from weekly
  ),
  bench as materialized (
    select wk, ret from rets where instrument_id = v_bench and ret is not null
  ),
  paired as materialized (
    select rr.instrument_id, rr.ret, bb.ret as bret
    from rets rr
    join bench bb on bb.wk = rr.wk
    where rr.ret is not null and rr.wk between v_w0 and v_w1
  ),
  stats as materialized (
    select pp.instrument_id,
           count(*)::int as weeks,
           case when var_samp(pp.bret) > 0
                then covar_samp(pp.ret, pp.bret) / var_samp(pp.bret) end as beta,
           case when avg(pp.bret) filter (where pp.bret < 0) <> 0
                then 100 * avg(pp.ret)  filter (where pp.bret < 0)
                         / avg(pp.bret) filter (where pp.bret < 0) end as dcap
    from paired pp
    group by pp.instrument_id
  ),
  base as materialized (
    select i.id as instrument_id,
           i.ticker,
           coalesce(s.weeks, 0) as weeks,
           s.beta,
           s.dcap,
           -- กลุ่มดิบตามกฎทุกข้อ เรียงตาม priority (negative_corr มาก่อน)
           case when coalesce(s.weeks, 0) < c_min_weeks then 'unclassified'
                else coalesce((
                  select r.code from public.classification_rule r
                   where (r.metric = 'beta' and s.beta is not null
                          and s.beta >= coalesce(r.min_value, '-infinity'::float8)
                          and s.beta <  coalesce(r.max_value,  'infinity'::float8))
                      or (r.metric = 'downside_capture' and s.dcap is not null
                          and s.dcap >= coalesce(r.min_value, '-infinity'::float8)
                          and s.dcap <  coalesce(r.max_value,  'infinity'::float8))
                   order by r.priority limit 1), 'unclassified') end as bucket_raw,
           -- กลุ่มตาม beta อย่างเดียว (ที่ลงเมื่อกฎ 2 ไตรมาสยังไม่ครบ)
           case when coalesce(s.weeks, 0) < c_min_weeks then 'unclassified'
                else coalesce((
                  select r.code from public.classification_rule r
                   where r.metric = 'beta' and s.beta is not null
                     and s.beta >= coalesce(r.min_value, '-infinity'::float8)
                     and s.beta <  coalesce(r.max_value,  'infinity'::float8)
                   order by r.priority limit 1), 'unclassified') end as beta_bucket
    from public.instruments_active i
    left join stats s on s.instrument_id = i.id
  )
  select v_quarter, b.instrument_id, b.ticker, b.beta, b.dcap, b.weeks,
         v_w0, v_w1, f.bucket, b.bucket_raw, p.bucket,
         case when p.bucket = f.bucket then p.quarters_in_bucket + 1 else 1 end,
         v_rule_ver, c_method, p_source
  from base b
  left join public.instrument_classification p
         on p.as_of_quarter = v_prev_q and p.instrument_id = b.instrument_id
  -- hysteresis: ยังอยู่ในกรอบของกลุ่มเดิมที่ถ่างออกด้วย hysteresis -> คงกลุ่มเดิม
  cross join lateral (
    select coalesce((
      select r.code from public.classification_rule r
       where r.code = p.bucket and r.metric = 'beta' and b.beta is not null
         and b.beta >= coalesce(r.min_value, '-infinity'::float8) - r.hysteresis
         and b.beta <  coalesce(r.max_value,  'infinity'::float8) + r.hysteresis
    ), b.beta_bucket) as beta_bucket_h
  ) h
  cross join lateral (
    select case
      when b.bucket_raw = 'unclassified' then 'unclassified'
      -- กฎที่ต้องยืนยันหลายไตรมาส (negative_corr)
      when coalesce((select r.confirm_quarters from public.classification_rule r
                      where r.code = b.bucket_raw), 1) > 1
        then case
               when p.bucket = b.bucket_raw then b.bucket_raw                       -- ติดป้ายอยู่แล้ว
               when p.downside_capture is not null and p.downside_capture < 0
                    then b.bucket_raw                                               -- เข้าเกณฑ์ 2 ไตรมาสติด
               else h.beta_bucket_h                                                 -- ยังไม่ครบ -> ใช้กลุ่ม beta
             end
      else h.beta_bucket_h
    end as bucket
  ) f
  on conflict (as_of_quarter, instrument_id) do nothing;

  select count(*), count(*) filter (where ic.bucket = 'unclassified')
    into v_after, v_unc
    from public.instrument_classification ic where ic.as_of_quarter = v_quarter;

  quarter_start  := v_quarter;
  n_inserted     := v_after - v_before;
  n_skipped      := v_total - (v_after - v_before);
  n_unclassified := v_unc;
  return next;
end
$fn$;

comment on function public.compute_classification(date, text) is
  'คำนวณกลุ่มสินทรัพย์ของไตรมาสที่ as_of ตกอยู่ — Phase 1 ข้อ 1.4 · ไม่ทับแถวเดิม (on conflict do nothing) · ใช้ beta + downside capture รายสัปดาห์ 156 สัปดาห์ที่จบแล้ว เทียบ SPY';


-- =====================================================================
-- 1.5  Backfill ย้อนหลัง — ต้องเดินจากไตรมาสเก่าไปใหม่
--      เพราะ hysteresis และกฎ 2 ไตรมาสอ่านผลของไตรมาสก่อนหน้า
--      ทุกแถวประทับ source = 'backfilled'
-- =====================================================================
create or replace function public.backfill_classification(p_quarters int default 12)
returns table (
  quarter_start  date,
  n_inserted     int,
  n_skipped      int,
  n_unclassified int
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  i int;
  v_q date;
begin
  if p_quarters < 1 or p_quarters > 40 then
    raise exception 'p_quarters ต้องอยู่ระหว่าง 1 ถึง 40 (ได้รับ: %)', p_quarters;
  end if;

  for i in reverse p_quarters - 1 .. 0 loop
    v_q := (date_trunc('quarter', current_date) - make_interval(months => 3 * i))::date;
    return query select * from public.compute_classification(v_q, 'backfilled');
  end loop;
end
$fn$;

comment on function public.backfill_classification(int) is
  'รัน compute_classification ย้อนหลัง N ไตรมาส เรียงจากเก่าไปใหม่ — Phase 1 ข้อ 1.5 · ทุกแถว source = backfilled เพราะ adj_close ถูกปรับย้อนหลัง ไม่ใช่เลขที่คนเห็นในวันนั้น';


-- =====================================================================
-- 1.7  ตาราง daily_facts — fact sheet รายวัน เก็บถาวร ไม่มีกลไกลบ
-- =====================================================================
create table if not exists public.daily_facts (
  trade_date    date primary key,
  facts         jsonb not null,
  facts_version text  not null default 'v1',
  generated_at  timestamptz not null default now()
);

comment on table public.daily_facts is
  'fact sheet รายวัน (Phase 2) — Phase 1 ข้อ 1.7 · เก็บถาวร สำคัญกว่าตัวข้อความ เพราะวันหน้าเปลี่ยนวิธีเขียนแล้วสร้างใหม่จากข้อมูลดิบได้';


-- =====================================================================
-- 1.8  ตาราง daily_brief — ข้อความสรุป + ผลด่านตรวจ
--      เก็บทั้งฉบับที่ตกด่าน (status = 'held') เพื่อให้สาวเหตุได้
--      หนึ่ง trade_date เผยแพร่ได้ฉบับเดียว (partial unique index)
-- =====================================================================
create table if not exists public.daily_brief (
  id             bigint generated always as identity primary key,
  trade_date     date not null,
  publish_date   date,
  body_th        text,
  model          text,
  prompt_version text,
  status         text  not null default 'held' check (status in ('published','held','draft')),
  validation_log jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now()
);

comment on table public.daily_brief is
  'บทสรุปตลาดรายวัน — Phase 1 ข้อ 1.8 · status held = ตกด่านตรวจ ไม่เผยแพร่ (หน้าเว็บคงฉบับก่อนหน้า) · validation_log เก็บเหตุที่ตก';

create unique index if not exists daily_brief_one_published_per_day
  on public.daily_brief (trade_date) where status = 'published';

create index if not exists daily_brief_trade_date_idx
  on public.daily_brief (trade_date desc);


-- =====================================================================
-- 1.9  เปิด anon select เฉพาะ 4 ตารางนี้ — ตารางอื่นไม่แตะ
--
--  นี่เป็นการเปลี่ยนนโยบายความปลอดภัยครั้งแรกของโปรเจกต์
--  (เดิมไม่มี policy ให้ anon เลยสักตาราง)
--
--  โครงสร้างสิทธิ์ที่ได้:
--    anon           : select อย่างเดียว · daily_brief เห็นเฉพาะ status='published'
--                     · daily_facts เห็นเฉพาะวันที่มีบทสรุปเผยแพร่แล้ว
--    authenticated  : select ทั้งหมด (รวมฉบับที่ตกด่าน ไว้ให้ Peat ตรวจ)
--    เขียน          : ไม่มี policy ให้ใครเลย -> GitHub Actions ต้องใช้ service_role key
--                     (service_role และ postgres bypass RLS ตามปกติ)
--
--  หมายเหตุ: anon มี grant ระดับตาราง (insert/update/delete) ติดมาจาก
--  default privileges ของ Supabase เหมือนทุกตารางในฐานข้อมูลนี้อยู่แล้ว
--  การกันอยู่ที่ RLS ไม่ใช่ที่ grant — เป็นท่าเดียวกับข้อ 8.8 ที่เลี่ยง revoke
-- =====================================================================
alter table public.classification_rule        enable row level security;
alter table public.instrument_classification  enable row level security;
alter table public.daily_facts                enable row level security;
alter table public.daily_brief                enable row level security;

grant select on public.classification_rule       to anon, authenticated;
grant select on public.instrument_classification to anon, authenticated;
grant select on public.daily_facts               to anon, authenticated;
grant select on public.daily_brief               to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='classification_rule'
                    and policyname='classification_rule_public_read') then
    create policy classification_rule_public_read on public.classification_rule
      for select to anon, authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='instrument_classification'
                    and policyname='instrument_classification_public_read') then
    create policy instrument_classification_public_read on public.instrument_classification
      for select to anon, authenticated using (true);
  end if;

  -- anon เห็น fact sheet เฉพาะวันที่บทสรุปผ่านด่านและเผยแพร่แล้ว
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='daily_facts'
                    and policyname='daily_facts_anon_read_published') then
    create policy daily_facts_anon_read_published on public.daily_facts
      for select to anon using (
        exists (select 1 from public.daily_brief b
                 where b.trade_date = daily_facts.trade_date and b.status = 'published')
      );
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='daily_facts'
                    and policyname='daily_facts_auth_read_all') then
    create policy daily_facts_auth_read_all on public.daily_facts
      for select to authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='daily_brief'
                    and policyname='daily_brief_anon_read_published') then
    create policy daily_brief_anon_read_published on public.daily_brief
      for select to anon using (status = 'published');
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='daily_brief'
                    and policyname='daily_brief_auth_read_all') then
    create policy daily_brief_auth_read_all on public.daily_brief
      for select to authenticated using (true);
  end if;
end
$$;


-- =====================================================================
-- 1.5 (รัน)  Backfill 12 ไตรมาส — วัดจริง 2.6 วินาที
--      ถ้าเจอ statement timeout (ของ postgres ตั้งไว้ 2 นาที) รันซ้ำได้เลย
--      ไตรมาสที่ครบแล้วจะถูกข้ามทันทีโดยไม่คำนวณใหม่
-- =====================================================================
select * from public.backfill_classification(12);


-- =====================================================================
-- 1.6  pg_cron รายไตรมาส
--      cron สั่ง "วันทำการแรก" ตรง ๆ ไม่ได้ จึงให้ลองวันที่ 1-5 ของเดือน
--      ม.ค./เม.ย./ก.ค./ต.ค. เวลา 02:00 UTC (หลัง integrity 01:00 และ macro 01:10)
--      ครั้งแรกที่สำเร็จชนะ ครั้งถัดมาไม่ทำอะไร เพราะ on conflict do nothing
-- =====================================================================
select cron.schedule(
  'quarterly-classification',
  '0 2 1-5 1,4,7,10 *',
  $cron$select public.compute_classification(current_date, 'live')$cron$
);


-- =====================================================================
-- ตรวจผล — ผลลัพธ์ที่ SQL Editor แสดงคือ query สุดท้ายนี้
-- =====================================================================

-- (ก) ด่านพิสูจน์ความถูกต้องในตัว: SPY ต้องได้ beta = 1 และ downside capture = 100 เป๊ะ
-- select ticker, round(beta::numeric,4) beta, round(downside_capture::numeric,2) dcap, weeks
--   from public.instrument_classification
--  where as_of_quarter = date_trunc('quarter', current_date)::date and ticker = 'SPY';

-- (ข) จำนวนแถวและกลุ่มต่อไตรมาส
-- select as_of_quarter, count(*) n,
--        count(*) filter (where bucket='negative_corr') neg,
--        count(*) filter (where bucket='low_beta')      low,
--        count(*) filter (where bucket='market_beta')   mkt,
--        count(*) filter (where bucket='high_beta')     high,
--        count(*) filter (where bucket='unclassified')  unc
--   from public.instrument_classification group by 1 order by 1;

-- (ค) ใครย้ายกลุ่มในไตรมาสล่าสุด
-- select ticker, prev_bucket, bucket, round(beta::numeric,2) beta, quarters_in_bucket
--   from public.instrument_classification
--  where as_of_quarter = date_trunc('quarter', current_date)::date
--    and prev_bucket is not null and prev_bucket <> bucket order by ticker;

select as_of_quarter,
       count(*)                                          as instruments,
       count(*) filter (where bucket = 'negative_corr')   as negative_corr,
       count(*) filter (where bucket = 'low_beta')        as low_beta,
       count(*) filter (where bucket = 'market_beta')     as market_beta,
       count(*) filter (where bucket = 'high_beta')       as high_beta,
       count(*) filter (where bucket = 'unclassified')    as unclassified,
       count(*) filter (where prev_bucket is not null
                          and prev_bucket <> bucket)      as moved
from public.instrument_classification
group by as_of_quarter
order by as_of_quarter;
