-- =====================================================================
-- รอบ B2a · บทสรุปรายสัปดาห์ที่ใช้งานได้จริง — ฝั่งฐานข้อมูล
-- ไฟล์: sql/2026-11-15_b2a_weekly_facts.sql
-- วันที่: 15 พ.ย. 2026
-- =====================================================================
-- ที่มา: ร่างบทสรุปรายสัปดาห์ฉบับจริงของ Peat (14 พ.ย.) เอาไปเทียบกับแผ่น fact
-- ของ 12 พ.ย. แล้วพบว่าทุกประโยคที่พูดถึงปริมาณซื้อขายขัดกับแผ่นหมด
-- (XLV 0.73 เท่า · XLP 0.74 · INDA 0.71 · PAWZ 0.33 ขณะที่ร่างบอก 2-3 เท่า)
-- ไม่ใช่คนเขียนผิด แต่เป็นเพราะ **บทสรุปเป็นรายสัปดาห์ ส่วนแผ่นมีแต่งวดรายวัน**
-- ไฟล์นี้เติมงวดรายสัปดาห์ รายชื่อ universe และสถิติฤดูกาลเข้าไปในแผ่น
--
-- ลำดับในไฟล์
--   1 · universe_def + universe_member + universe_tickers()
--       รายชื่อ Asset Class และกฎของ Broad Market ย้ายจาก app.js เข้าฐานข้อมูล
--   2 · seasonal_baseline() + seasonal_block()
--       สถิติฤดูกาลที่มาพร้อมฐานเทียบเสมอ · กองที่รายงานประกาศไว้ล่วงหน้า
--   3 · build_daily_facts() รุ่น v2
--       เพิ่มกลุ่ม ret.week · vol.week · seasonal และอันดับสอง universe
--       **ขยับ facts_version จาก v1 เป็น v2**
--   4 · คำสั่งตรวจหลังรัน (คอมเมนต์ไว้)
--
-- ⚠️ ผลที่ตามมาซึ่งต้องจัดการฝั่งโค้ด (ทำแล้วใน PR เดียวกัน)
--    แผ่นเก่า 48 แผ่นเป็น v1 และจะไม่มีกลุ่มใหม่ตลอดไปตามกติกาแช่แข็ง
--    ด่าน 0 ของบทสรุปจึงต้องรู้จักแผ่นสองรุ่น ไม่งั้นจะตีกลับแผ่นเก่าทั้งหมด
--
-- ไฟล์นี้รันซ้ำได้ทั้งไฟล์ · create table if not exists · create or replace
-- · insert ... on conflict do update · ไม่มี revoke / drop policy / delete
--
-- ตรวจก่อนแก้ (15 พ.ย. 2026): body ของ build_daily_facts ในฐานข้อมูลจริง
-- เหมือนในไฟล์ sql/2026-11-13_b1_completeness_gate.sql ทุกตัวอักษร
--   md5(replace(prosrc, chr(13), '')) = 319302d82aab9c8fb6489a4a19e9c874
--   ความยาว prosrc = 11895 (ในไฟล์ 11664 หลังตัด \r — ต่างกันที่ CRLF เท่านั้น)
-- คำสั่งที่ใช้ตรวจซ้ำได้:
--   select md5(replace(p.prosrc, chr(13), '')), length(p.prosrc)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'build_daily_facts';
-- แปลว่าด่านความครบของ B1 ยังอยู่ครบและไฟล์นี้ต่อยอดจากของจริง ไม่ได้ทับงานเก่า
-- =====================================================================

-- ---------------------------------------------------------------------------
-- ส่วนที่ 1 · รายชื่อ universe ย้ายเข้าฐานข้อมูล
-- ---------------------------------------------------------------------------
-- ปัญหาที่แก้: Asset Class มีรายชื่อ 6 ตัวพิมพ์ไว้ใน app.js และ Broad Market
-- มีกฎพิเศษ "หมวด broad_market บวก IEF บวก VNQ" อยู่ในไฟล์เดียวกัน
-- ฐานข้อมูลไม่รู้จักทั้งสองอย่าง · พอ fact sheet ต้องจัดอันดับสอง universe นี้
-- ด้วย ถ้าเขียนรายชื่อซ้ำลง SQL ก็จะกลายเป็นนิยามสองที่ทันที
--
-- ทำไมไม่เก็บรายชื่อ broad_market ทั้ง 18 ตัวลงตาราง: เพราะ 16 ตัวมาจาก
-- คอลัมน์ instruments.category อยู่แล้ว ถ้าคัดลอกมาเก็บ วันที่เพิ่มกองใหม่
-- ตารางนี้จะเก่าเงียบ ๆ · จึงเก็บเฉพาะ "ส่วนที่กฎในหมวดอธิบายไม่ได้"
--
-- ⚠️ app.js ยังอ่านรายชื่อของตัวเองอยู่จนกว่าจะได้แตะหน้าเว็บ (รอบ C′ หรือ E)
--    วันไหนแตะ ต้องเปลี่ยนไปอ่านจากที่นี่และลบรายชื่อใน JS ทิ้ง

create table if not exists public.universe_def (
  universe       text primary key,
  label_th       text not null,
  base_category  text,                      -- null = ไม่ได้ใช้หมวดเป็นฐาน
  note           text
);

create table if not exists public.universe_member (
  universe    text not null references public.universe_def(universe) on delete cascade,
  ticker      text not null,
  sort_order  int  not null default 0,
  note        text,
  primary key (universe, ticker)
);

alter table public.universe_def    enable row level security;
alter table public.universe_member enable row level security;

-- อ่านได้เหมือน instruments (authenticated) · เขียนได้เฉพาะ postgres/service_role
-- เหมือนทุกตารางในโปรเจกต์นี้คือไม่มี policy ให้เขียนเลย
drop policy if exists universe_def_select    on public.universe_def;
drop policy if exists universe_member_select on public.universe_member;
create policy universe_def_select    on public.universe_def    for select to authenticated using (true);
create policy universe_member_select on public.universe_member for select to authenticated using (true);

insert into public.universe_def (universe, label_th, base_category, note) values
  ('asset_class',  'ประเภทสินทรัพย์', null,
   'รายชื่อตายตัว 6 ตัว ลอกมาจาก ASSET_CLASS_TICKERS ใน app.js บรรทัด 798'),
  ('broad_market', 'ตลาดกว้าง',      'broad_market',
   'หมวด broad_market ทั้งหมด บวก IEF และ VNQ ตามกฎใน app.js บรรทัด 940')
on conflict (universe) do update
  set label_th = excluded.label_th,
      base_category = excluded.base_category,
      note = excluded.note;

insert into public.universe_member (universe, ticker, sort_order, note) values
  ('asset_class', 'SPY', 1, 'หุ้นสหรัฐ'),
  ('asset_class', 'EFA', 2, 'ตลาดพัฒนาแล้วนอกสหรัฐ'),
  ('asset_class', 'EEM', 3, 'ตลาดเกิดใหม่'),
  ('asset_class', 'IEF', 4, 'พันธบัตรสหรัฐ 7-10 ปี'),
  ('asset_class', 'VNQ', 5, 'อสังหาริมทรัพย์สหรัฐ'),
  ('asset_class', 'DBC', 6, 'สินค้าโภคภัณฑ์'),
  ('broad_market','IEF', 1, 'ส่วนเพิ่มนอกหมวด broad_market'),
  ('broad_market','VNQ', 2, 'ส่วนเพิ่มนอกหมวด broad_market')
on conflict (universe, ticker) do update
  set sort_order = excluded.sort_order, note = excluded.note;

-- ตัวแปลรายชื่อ · ใครอยากรู้ว่า universe หนึ่งมีกองอะไรบ้าง ต้องถามผ่านฟังก์ชันนี้
-- กรองผ่าน instruments_active เสมอ จึงลืมกรอง is_active ไม่ได้
create or replace function public.universe_tickers(p_universe text)
returns table(instrument_id bigint, ticker text, sort_order int)
language sql
stable
set search_path to 'public', 'pg_temp'
as $fn$
  with d as (select * from public.universe_def where universe = p_universe)
  select i.id, i.ticker, coalesce(m.sort_order, 1000)::int
  from d
  join public.instruments_active i
    on i.category = d.base_category
  left join public.universe_member m
    on m.universe = d.universe and m.ticker = i.ticker
  union
  select i.id, i.ticker, m.sort_order
  from d
  join public.universe_member m on m.universe = d.universe
  join public.instruments_active i on i.ticker = m.ticker
  order by 3, 2;
$fn$;

comment on function public.universe_tickers(text) is
  'รอบ B2a · คืนรายชื่อกองของ universe หนึ่ง (asset_class / broad_market) · เป็นนิยามเดียวที่ฝั่งฐานข้อมูลใช้';

-- ---------------------------------------------------------------------------
-- ส่วนที่ 2 · สถิติฤดูกาล + ฐานเทียบ
-- ---------------------------------------------------------------------------
-- กติกาที่บังคับอยู่ในฟังก์ชันนี้ (ไม่ใช่ใน prompt) เพราะ prompt แก้ง่ายเกินไป:
--   1. กองที่รายงานประกาศไว้ล่วงหน้า = SPY ตัวเดียว · ห้ามเลือกตอนเขียน
--      ถ้าปล่อยให้หยิบ "ตัวที่น่าสนใจที่สุด" จาก 93 กอง × 12 เดือน × 20 metric
--      จะได้ของที่เด่นเพราะบังเอิญทุกครั้ง (บทเรียนเส้นฐานความบังเอิญของ SET100)
--   2. ทุกตัวเลขฤดูกาลมาพร้อมฐานเทียบของตัวเองเสมอ ในก้อน JSON เดียวกัน
--      "สัปดาห์ที่ 46 ชนะ 60%" ไม่มีความหมายจนกว่าจะรู้ว่าทุกสัปดาห์ชนะ 58.9%
--   3. ใช้เฉพาะปีที่จบแล้ว (p_end_year = ปีก่อนหน้า) กัน look-ahead
--      เพราะ seasonal_stats มีจุดยึดเวลาละเอียดแค่ระดับปี
--   4. n ต่ำกว่า 8 = ไม่รายงานท่อนนั้นเลย ไม่ใช่รายงานพร้อมหมายเหตุ
--      ปี 2026 มี 53 สัปดาห์ · สัปดาห์ที่ 53 ย้อนหลัง 10 ปีเจอแค่ครั้งสองครั้ง
--   5. สถิติรายเดือนออกเฉพาะสัปดาห์ที่สัปดาห์ถัดไปคร่อมเข้าเดือนใหม่
--      เป็นการประกาศจังหวะล่วงหน้า กันการเลือกหยิบเฉพาะเดือนที่ตัวเลขสวย

create or replace function public.seasonal_baseline(
  p_instrument_id  bigint,
  p_period_type    text,
  p_lookback_years int,
  p_end_year       int)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $fn$
  with period_last as (
    select distinct on (date_trunc(p_period_type, o.date)::date)
      date_trunc(p_period_type, o.date)::date as period_start,
      o.adj_close
    from public.ohlcv_daily o
    where o.instrument_id = p_instrument_id and o.adj_close is not null
    order by 1, o.date desc
  ),
  with_ret as (
    select period_start,
           adj_close / nullif(lag(adj_close) over (order by period_start), 0) - 1 as ret,
           case when p_period_type = 'week' then extract(isoyear from period_start)::int
                else extract(year from period_start)::int end as yr
    from period_last
  ),
  f as (
    select ret from with_ret
    where ret is not null
      and yr between p_end_year - p_lookback_years + 1 and p_end_year
  )
  select jsonb_build_object(
    'n',         count(*),
    'win_pct',   round((100.0 * avg(case when ret > 0 then 1 else 0 end))::numeric, 1),
    'mean_pct',  round((100.0 * avg(ret))::numeric, 3),
    'window',    (p_end_year - p_lookback_years + 1)::text || '-' || p_end_year::text,
    'note',      'ทุก' || case when p_period_type = 'week' then 'สัปดาห์' else 'เดือน' end ||
                 'ในช่วงเดียวกัน ไม่เจาะจงงวด — ใช้เป็นฐานเทียบของตัวเลขฤดูกาล')
  from f;
$fn$;

comment on function public.seasonal_baseline(bigint, text, int, int) is
  'รอบ B2a · ค่าปกติของกองนั้นเองในทุกงวดของช่วงเวลาเดียวกัน · เป็นฐานเทียบที่ด่าน 5 บังคับให้อ้างคู่กับสถิติฤดูกาลเสมอ';


create or replace function public.seasonal_block(p_trade_date date default null)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $fn$
declare
  c_ticker     constant text := 'SPY';   -- ประกาศล่วงหน้า ห้ามเลือกตอนเขียน
  c_min_n      constant int  := 8;
  c_week_years constant int  := 10;
  c_mon_years  constant int  := 20;
  v_td    date;
  v_iid   bigint;
  v_mon_this  date;       -- วันจันทร์ของสัปดาห์ที่ข้อมูลอยู่
  v_mon_next  date;
  v_wk_cur    int;
  v_wk_next   int;
  v_end_year  int;
  v_new_month int;
  v_crossing  boolean;
  v_cur   jsonb; v_next jsonb; v_mon jsonb;
  v_bw    jsonb; v_bm   jsonb;
begin
  v_td := coalesce(p_trade_date, (select max(o.date) from public.ohlcv_daily o));
  select id into v_iid from public.instruments where ticker = c_ticker;
  if v_td is null or v_iid is null then
    return jsonb_build_object('source','seasonal_stats','available',false,
                              'reason','ไม่มีข้อมูลราคา หรือไม่พบกองที่ประกาศไว้');
  end if;

  v_mon_this := date_trunc('week', v_td)::date;
  v_mon_next := v_mon_this + 7;
  v_wk_cur   := extract(week from v_mon_this)::int;
  v_wk_next  := extract(week from v_mon_next)::int;
  -- ใช้เฉพาะปีที่จบแล้ว · ISO year เพราะ seasonal_stats ใช้ ISO year กับสัปดาห์
  v_end_year := extract(isoyear from v_mon_this)::int - 1;

  -- สัปดาห์ถัดไปคร่อมเข้าเดือนใหม่หรือยัง (ดูวันอาทิตย์ปลายสัปดาห์ถัดไป)
  v_crossing  := extract(month from (v_mon_next + 6)) <> extract(month from v_td);
  v_new_month := extract(month from (v_mon_next + 6))::int;

  v_cur  := public.seasonal_stats(v_iid, 'week', v_wk_cur,  c_week_years, v_end_year, false);
  v_next := public.seasonal_stats(v_iid, 'week', v_wk_next, c_week_years, v_end_year, false);
  v_bw   := public.seasonal_baseline(v_iid, 'week',  c_week_years, v_end_year);

  if v_crossing then
    v_mon := public.seasonal_stats(v_iid, 'month', v_new_month, c_mon_years,
                                   extract(year from v_mon_this)::int - 1, false);
    v_bm  := public.seasonal_baseline(v_iid, 'month', c_mon_years,
                                      extract(year from v_mon_this)::int - 1);
  end if;

  return jsonb_build_object(
    'source', format('seasonal_stats(%s, ปีที่จบแล้วถึง %s) + seasonal_baseline', c_ticker, v_end_year),
    'instrument', c_ticker,
    'unit', 'pct',
    'min_n', c_min_n,
    'note', 'ตัวเลขฤดูกาลทุกตัวในกลุ่มนี้ต้องอ้างคู่กับ baseline ของงวดเดียวกันเสมอ',
    'week_current', case
      when (v_cur->>'n')::int >= c_min_n then jsonb_build_object(
        'available', true, 'period', v_wk_cur, 'n', (v_cur->>'n')::int,
        'win_pct',  round((v_cur->>'win_frequency_pct')::numeric, 1),
        'mean_pct', round((v_cur->>'mean_pct')::numeric, 3))
      else jsonb_build_object('available', false, 'period', v_wk_cur,
        'n', coalesce((v_cur->>'n')::int, 0),
        'reason', format('มีข้อมูลเพียง %s ครั้ง ต่ำกว่าเกณฑ์ %s ครั้ง',
                         coalesce((v_cur->>'n')::int, 0), c_min_n)) end,
    'week_next', case
      when (v_next->>'n')::int >= c_min_n then jsonb_build_object(
        'available', true, 'period', v_wk_next, 'n', (v_next->>'n')::int,
        'win_pct',  round((v_next->>'win_frequency_pct')::numeric, 1),
        'mean_pct', round((v_next->>'mean_pct')::numeric, 3))
      else jsonb_build_object('available', false, 'period', v_wk_next,
        'n', coalesce((v_next->>'n')::int, 0),
        'reason', format('มีข้อมูลเพียง %s ครั้ง ต่ำกว่าเกณฑ์ %s ครั้ง',
                         coalesce((v_next->>'n')::int, 0), c_min_n)) end,
    'baseline_week', v_bw,
    'month_next', case
      when not v_crossing then jsonb_build_object('available', false,
        'reason', 'สัปดาห์ถัดไปยังไม่ข้ามเดือน — สถิติรายเดือนออกเฉพาะรอบที่ข้ามเดือน')
      when (v_mon->>'n')::int >= c_min_n then jsonb_build_object(
        'available', true, 'period', v_new_month, 'n', (v_mon->>'n')::int,
        'win_pct',  round((v_mon->>'win_frequency_pct')::numeric, 1),
        'mean_pct', round((v_mon->>'mean_pct')::numeric, 3))
      else jsonb_build_object('available', false, 'period', v_new_month,
        'n', coalesce((v_mon->>'n')::int, 0),
        'reason', format('มีข้อมูลเพียง %s ครั้ง ต่ำกว่าเกณฑ์ %s ครั้ง',
                         coalesce((v_mon->>'n')::int, 0), c_min_n)) end,
    'baseline_month', case when v_crossing then v_bm
      else jsonb_build_object('available', false, 'reason', 'ไม่ได้ข้ามเดือน') end);
end
$fn$;

comment on function public.seasonal_block(date) is
  'รอบ B2a · สถิติฤดูกาลของสัปดาห์ปัจจุบัน/ถัดไป (และเดือนใหม่เฉพาะรอบที่ข้ามเดือน) พร้อมฐานเทียบ · กองที่รายงานประกาศไว้ล่วงหน้าในโค้ด';


-- ---------------------------------------------------------------------------
-- ส่วนที่ 3 · build_daily_facts รุ่น v2
-- ---------------------------------------------------------------------------
-- ตัวฟังก์ชันคัดลอกมาจาก sql/2026-11-13_b1_completeness_gate.sql ตรง ๆ
-- (ซึ่ง md5 ตรงกับของจริงในฐานข้อมูล) สิ่งที่เพิ่มมีหกจุด:
--   c_version เป็น v2 · ลายเซ็นสูตรครอบฟังก์ชันใหม่ · CTE ret.week/vol.week
--   · CTE รายชื่อ universe · อันดับสอง universe ในกลุ่ม rank · CTE seasonal
-- ด่านความครบของ B1 อยู่ครบไม่ถูกแตะ

create or replace function public.build_daily_facts(
  p_trade_date date    default null,
  p_force      boolean default false
)
returns table (trade_date date, created boolean, n_groups int, reason text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  c_version constant text := 'v2';
  v_td      date;
  v_gate    timestamptz;
  v_exists  boolean;
  v_facts   jsonb;
  v_maxd    date;
  v_current boolean;   -- วันนี้เป็นวันล่าสุดของชุดข้อมูลหรือไม่
  v_brdays  int;
  v_meta    jsonb;
  v_lineage jsonb;
  v_cov_ok  boolean;  -- รอบ B1
  v_cov_why text;     -- รอบ B1
  v_n       int;
begin
  v_td := coalesce(p_trade_date, (select max(o.date) from public.ohlcv_daily o));
  if v_td is null then
    trade_date := null; created := false; n_groups := 0;
    reason := 'ไม่มีข้อมูลราคาเลย'; return next; return;
  end if;

  -- ประตูเวลา: fact ของวัน D สร้างได้ตั้งแต่ 00:00 UTC ของวัน D+1
  -- = หลังตลาดสหรัฐฯ ปิดอย่างน้อย 3 ชม. ทั้งปี โดยไม่ต้องจัดการ DST
  v_gate := ((v_td + 1)::timestamp) at time zone 'UTC';
  if not p_force and now() < v_gate then
    trade_date := v_td; created := false; n_groups := 0;
    reason := 'ยังไม่ถึงเวลา — สร้างได้ตั้งแต่ ' || to_char(v_gate,'YYYY-MM-DD HH24:MI UTC');
    return next; return;
  end if;

  -- ด่านความครบ (รอบ B1 · 13 พ.ย. 2026)
  -- "ครบไหม" เป็นคำถามคนละข้อกับ "ถูกไหม" — ด่านความถูกต้อง 5 ด่านตรวจความสอดคล้อง
  -- ภายใน จึงไม่มีทางจับกรณี 10 พ.ย. ได้ (15/24 = 62.5% สอดคล้องสมบูรณ์ในตัวมันเอง)
  -- วางไว้ก่อนการเช็ค v_exists โดยตั้งใจ: p_force จึงทับแผ่นที่ดีอยู่แล้ว
  -- ด้วยข้อมูลที่ไม่ครบไม่ได้
  select c.is_complete, c.reason into v_cov_ok, v_cov_why
  from public.coverage_report(v_td) c;
  if not coalesce(v_cov_ok, false) then
    trade_date := v_td; created := false; n_groups := 0;
    reason := 'ข้อมูลไม่ครบ · ' || coalesce(v_cov_why, '(ไม่ทราบสาเหตุ)') ||
              ' — ยังไม่สร้างแผ่น รอรอบถัดไป';
    return next; return;
  end if;

  v_maxd    := (select max(o.date) from public.ohlcv_daily o);
  v_current := (v_td = v_maxd);
  v_brdays  := (v_maxd - v_td) + 40;

  select exists(select 1 from public.daily_facts f where f.trade_date = v_td) into v_exists;
  if v_exists and not p_force then
    trade_date := v_td; created := false;
    n_groups := (select count(*)::int from public.daily_facts f, jsonb_each(f.facts->'groups') where f.trade_date=v_td);
    reason := 'มีอยู่แล้ว ไม่ทับของเก่า'; return next; return;
  end if;

  -- ลายเซ็นของสูตรที่ใช้สร้าง: ถ้ามีใครแก้ฟังก์ชันในฐานข้อมูลโดยไม่อัปไฟล์ ลายเซ็นจะเปลี่ยนและเห็นได้จากข้อมูล
  select jsonb_object_agg(p.proname, substr(md5(pg_get_functiondef(p.oid)),1,12))
    into v_lineage
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in ('trailing_returns','volume_anomaly','risk_metrics',
                      'breadth_series','pair_spreads','period_end_closes',
                      'period_volume_series','compute_classification',
                      'seasonal_stats','seasonal_baseline','seasonal_block',
                      'universe_tickers','coverage_report');

  with ids as (select array_agg(id) a from public.instruments_active),

  -- ---------- ผลตอบแทน 1/5/21 วัน ----------
  ret as (
    select x.instrument_id iid, x.lookback lb, x.return_pct v
    from ids, lateral public.trailing_returns(ids.a,'day',array[1,5,21],false,null,v_td) x),
  ret_g as (
    select jsonb_build_object(
      'source','trailing_returns(active,''day'',[1,5,21], as_of=trade_date)','unit','pct','keys',jsonb_build_array(1,5,21),
      'values',(select jsonb_object_agg(i.ticker, k.arr) from public.instruments_active i
                join lateral (select jsonb_agg(r.v order by r.lb) arr from ret r where r.iid=i.id) k on true)) g),

  -- ---------- ปริมาณซื้อขาย ----------
  vol as (select x.instrument_id iid, x.z_score z, x.rvol rv
          from ids, lateral public.volume_anomaly(ids.a,'day',20,false,null,v_td) x),
  vol_g as (
    select jsonb_build_object(
      'source','volume_anomaly(active,''day'',20, as_of=trade_date)','unit','z=sigma(log) · rvol=x',
      'keys',jsonb_build_array('z','rvol'),
      'values',(select jsonb_object_agg(i.ticker, jsonb_build_array(v.z, v.rv))
                from public.instruments_active i join vol v on v.iid=i.id)) g),

  -- ---------- ผลตอบแทนรายสัปดาห์ (รอบ B2a) ----------
  -- บทสรุปเป็นรายสัปดาห์ แต่ก่อนหน้านี้แผ่นมีแต่งวดรายวัน ทุกประโยคที่พูดถึง
  -- สัปดาห์จึงไม่มี fact รองรับ · จำกัดขอบเขตวันที่ไว้ 560 วันเพราะไม่จำกัดแล้ว
  -- สแกนประวัติทั้ง 33 ปีทุกครั้ง (บทเรียน 4 พ.ย. · เร็วขึ้น 8 เท่าเมื่อจำกัด)
  retw as (
    select x.instrument_id iid, x.lookback lb, x.return_pct v
    from ids, lateral public.trailing_returns(ids.a,'week',array[1,4,13],false,(v_td - 560),v_td) x),
  retw_g as (
    select jsonb_build_object(
      'source','trailing_returns(active,''week'',[1,4,13], as_of=trade_date)','unit','pct',
      'keys',jsonb_build_array(1,4,13),
      'week_start',(date_trunc('week', v_td)::date),
      'days_in_week',(select count(distinct o.date) from public.ohlcv_daily o
                      where o.date between date_trunc('week', v_td)::date and v_td),
      'note','งวดสัปดาห์ของแผ่นวันศุกร์คือสัปดาห์ที่จบแล้ว · แผ่นของวันกลางสัปดาห์จะเป็นงวดที่ยังไม่จบ ดู days_in_week',
      'values',(select jsonb_object_agg(i.ticker, k.arr) from public.instruments_active i
                join lateral (select jsonb_agg(r.v order by r.lb) arr from retw r where r.iid=i.id) k on true)) g),

  -- ---------- ปริมาณซื้อขายรายสัปดาห์ (รอบ B2a) ----------
  volw as (select x.instrument_id iid, x.z_score z, x.rvol rv
           from ids, lateral public.volume_anomaly(ids.a,'week',20,false,(v_td - 560),v_td) x),
  volw_g as (
    select jsonb_build_object(
      'source','volume_anomaly(active,''week'',20, as_of=trade_date)','unit','z=sigma(log) · rvol=x',
      'keys',jsonb_build_array('z','rvol'),
      'values',(select jsonb_object_agg(i.ticker, jsonb_build_array(v.z, v.rv))
                from public.instruments_active i join volw v on v.iid=i.id)) g),

  -- ---------- รายชื่อสอง universe ที่เดิมอยู่ใน app.js เท่านั้น ----------
  uac as (select t.ticker from public.universe_tickers('asset_class') t),
  ubm as (select t.ticker from public.universe_tickers('broad_market') t),

  -- ---------- ความเสี่ยง/ตำแหน่งราคา ----------
  rk as (select x.instrument_id iid, x.atr_pct, x.atr_pctile_1y, x.pos_52w, x.pct_from_high
         from ids, lateral public.risk_metrics(
           case when v_current then ids.a else array[-1]::bigint[] end) x),
  rk_g as (
    select case when not v_current then jsonb_build_object(
      'source','risk_metrics(active)','available',false,
      'reason','risk_metrics คำนวณ ณ วันล่าสุดเสมอ ไม่มีพารามิเตอร์วันที่ จึงไม่ใส่ในแผ่นย้อนหลัง เพื่อไม่ให้ค่าของวันนี้ถูกประทับเป็นค่าของวันในอดีต')
    else jsonb_build_object(
      'source','risk_metrics(active)','unit','pct','available',true,
      'keys',jsonb_build_array('atr_pct','atr_pctile_1y','pos_52w','pct_from_high'),
      'values',(select jsonb_object_agg(i.ticker,
                  jsonb_build_array(r.atr_pct,r.atr_pctile_1y,r.pos_52w,r.pct_from_high))
                from public.instruments_active i join rk r on r.iid=i.id)) end g),

  -- ---------- breadth ----------
  br as (select *, row_number() over (order by date desc) rn
         from public.breadth_series(v_brdays) where date <= v_td),
  br_g as (
    select jsonb_build_object(
      'source','breadth_series(ครอบถึง trade_date) · หยิบแถวของ trade_date ไม่ใช่แถวล่าสุด',
      'note','ไม่ใช่ market breadth ของตลาด เป็นสัดส่วนในลิสต์ที่เราเลือกเอง 93 กอง (thematic 54) เทียบกับแหล่งอื่นโดยตรงไม่ได้',
      'today', (select jsonb_build_object('date',date,'universe',universe,'above',above_sma200,
                  'pct',pct_above_sma200,'new_hi',new_hi,'new_lo',new_lo) from br where rn=1),
      'prior_21d', (select jsonb_build_object('date',date,'universe',universe,'above',above_sma200,
                  'pct',pct_above_sma200) from br where rn=22)) g),

  -- ---------- กลุ่ม beta ----------
  bk as (
    select c.bucket, i.ticker, r.lb, r.v
    from public.instrument_classification c
    join public.instruments_active i on i.id=c.instrument_id
    join ret r on r.iid=c.instrument_id
    where c.as_of_quarter = (select max(as_of_quarter) from public.instrument_classification)),
  bk_g as (
    select jsonb_build_object(
      'source','instrument_classification (ไตรมาสล่าสุด) + trailing_returns',
      'as_of_quarter',(select max(as_of_quarter) from public.instrument_classification),
      'unit','pct',
      'buckets',(select jsonb_object_agg(bucket, jsonb_build_object(
          'n',n,'members',members,'avg_1d',a1,'avg_21d',a21))
        from (select bucket, count(distinct ticker)::int n,
                     jsonb_agg(distinct ticker) members,
                     avg(v) filter (where lb=1)  a1,
                     avg(v) filter (where lb=21) a21
              from bk group by bucket) q)) g),

  -- ---------- ส่วนต่างคู่ ----------
  pr_g as (
    select jsonb_build_object(
      'source','pair_spreads(trade_date)','unit','pct_points',
      'values',(select jsonb_object_agg(code, jsonb_build_object(
          'label',label_th,'spread',spread_pct,'pctile_3y',pctile,
          'n_days',n_days,'window_start',window_start,'note',note))
        from public.pair_spreads(v_td))) g),

  -- ---------- อันดับ ----------
  rnk as (
    select i.ticker, i.category, r.v
    from ret r join public.instruments_active i on i.id=r.iid where r.lb=21 and r.v is not null),
  rnk_g as (
    select jsonb_build_object(
      'source','trailing_returns 21d · เรียงจากมากไปน้อย','unit','pct','n',5,
      'all_top',(select jsonb_agg(jsonb_build_array(ticker,v)) from (select * from rnk order by v desc limit 5) a),
      'all_bottom',(select jsonb_agg(jsonb_build_array(ticker,v)) from (select * from rnk order by v asc limit 5) a),
      'thematic_top',(select jsonb_agg(jsonb_build_array(ticker,v)) from (select * from rnk where category='thematic' order by v desc limit 5) a),
      'thematic_bottom',(select jsonb_agg(jsonb_build_array(ticker,v)) from (select * from rnk where category='thematic' order by v asc limit 5) a),
      'us_sector_ranked',(select jsonb_agg(jsonb_build_array(ticker,v) order by v desc) from rnk where category='us_sector'),
      'asset_class_ranked',(select jsonb_agg(jsonb_build_array(r.ticker,r.v) order by r.v desc)
                            from rnk r join uac u on u.ticker=r.ticker),
      'broad_market_ranked',(select jsonb_agg(jsonb_build_array(r.ticker,r.v) order by r.v desc)
                             from rnk r join ubm u on u.ticker=r.ticker)) g),

  -- ---------- ปฏิทินข้างหน้า 14 วัน ----------
  ev_g as (
    select jsonb_build_object(
      'source','market_events_between(null, trade_date, trade_date+14)','window_days',14,
      'items',coalesce((select jsonb_agg(jsonb_build_object(
          'type',event_type,'date',event_date,'market_date',market_date,'name',coalesce(name_th,name_en,event_name))
          order by event_date)
        from public.market_events_between(null, v_td, v_td + 14) where status='approved'),'[]'::jsonb)) g),

  -- ---------- มหภาคที่ประกาศช่วงที่ผ่านมา ----------
  mc as (
    select series_id, date, value,
           lag(value) over (partition by series_id order by date) prev_value,
           lag(date)  over (partition by series_id order by date) prev_date,
           row_number() over (partition by series_id order by date desc) rn
    from public.macro_series where date >= v_td - 400),
  mc_g as (
    select jsonb_build_object(
      'source','macro_series (ค่าใหม่ภายใน 35 วันก่อนวันข้อมูล)',
      'items',coalesce((select jsonb_object_agg(series_id, jsonb_build_object(
          'date',date,'value',value,'prev_date',prev_date,'prev_value',prev_value))
        from mc where rn=1 and date >= v_td - 35),'{}'::jsonb)) g),

  -- ---------- สถิติฤดูกาล (รอบ B2a) ----------
  seas_g as (select public.seasonal_block(v_td) g),

  -- ---------- สถานะข้อมูล ----------
  hl_g as (
    select case when not v_current then jsonb_build_object(
      'source','data_as_of() · data_health_overview() · integrity_log','available',false,
      'reason','สถานะความสดและความถูกต้องเป็นค่า ณ ปัจจุบัน ย้อนหลังไม่ได้')
    else jsonb_build_object(
      'source','data_as_of() · data_health_overview() · integrity_log','available',true,
      'data_as_of',(select public.data_as_of()),
      'health',(select public.data_health_overview()),
      'integrity_last',(select jsonb_build_object('run_on',max(l.run_at)::date,
          'errors',count(*) filter (where l.status='error'),
          'warnings',count(*) filter (where l.status='warn'))
        from public.integrity_log l
        where l.run_at = (select max(run_at) from public.integrity_log))) end g)

  select jsonb_build_object(
    'ret.day',(select g from ret_g), 'vol.day',(select g from vol_g),
    'ret.week',(select g from retw_g), 'vol.week',(select g from volw_g),
    'seasonal',(select g from seas_g),
    'risk',(select g from rk_g),     'breadth',(select g from br_g),
    'beta',(select g from bk_g),     'pair',(select g from pr_g),
    'rank',(select g from rnk_g),    'events',(select g from ev_g),
    'macro',(select g from mc_g),    'health',(select g from hl_g))
  into v_facts;

  v_meta := jsonb_build_object(
    'trade_date', v_td,
    'generated_at', now(),
    'facts_version', c_version,
    'universe_n', (select count(*) from public.instruments_active),
    'source', case when v_current then 'live' else 'backfilled' end,
    'data_max_date', v_maxd,
    'lineage', v_lineage,
    'disclaimer', 'ตัวเลขชุดนี้เป็นค่า ณ เวลาที่สร้าง · ราคาย้อนหลังอาจถูกปรับภายหลังจากปันผลหรือการแตกพาร์ ' ||
                  'ตัวเลขในฉบับเก่าจึงอาจไม่ตรงกับที่แดชบอร์ดแสดงในภายหลัง');

  v_n := (select count(*) from jsonb_each(v_facts));

  -- ไม่ใช้ on conflict เพราะ trade_date เป็นทั้งชื่อคอลัมน์และตัวแปร out ของฟังก์ชัน
  -- Postgres จะฟ้องว่ากำกวม · เช็ค v_exists ไปแล้วข้างบน จึงแยกสองทางตรง ๆ ได้
  if v_exists then
    update public.daily_facts
       set facts = jsonb_build_object('meta',v_meta,'groups',v_facts),
           facts_version = c_version, generated_at = now()
     where public.daily_facts.trade_date = v_td;
  else
    insert into public.daily_facts (trade_date, facts, facts_version)
    values (v_td, jsonb_build_object('meta',v_meta,'groups',v_facts), c_version);
  end if;

  trade_date := v_td; created := true; n_groups := v_n;
  reason := case when v_exists then 'สร้างทับตามคำสั่ง p_force' else 'สร้างใหม่' end;
  return next;
end
$fn$;

-- ---------------------------------------------------------------------------
-- ส่วนที่ 4 · คำสั่งตรวจหลังรัน (คอมเมนต์ไว้ — ลอกไปรันทีละคำสั่ง)
-- ---------------------------------------------------------------------------
-- 4.1 รายชื่อ universe ที่ฐานข้อมูลเห็น ต้องตรงกับ app.js
--     asset_class ควรได้ SPY EFA EEM IEF VNQ DBC ตามลำดับนี้
--     broad_market ควรได้ 18 ตัว (หมวด broad_market 16 + IEF + VNQ)
--
--   select 'asset_class' as universe, string_agg(ticker, ', ' order by sort_order) as tickers
--   from public.universe_tickers('asset_class')
--   union all
--   select 'broad_market', count(*)::text || ' ตัว: ' || string_agg(ticker, ', ' order by ticker)
--   from public.universe_tickers('broad_market');
--
-- 4.2 สถิติฤดูกาลของสัปดาห์ล่าสุด พร้อมฐานเทียบ
--     ดูว่า week_current.period ตรงกับสัปดาห์ ISO ของวันที่ข้อมูลล่าสุด
--     และ baseline_week.n ควรราว 520 (10 ปี × 52 สัปดาห์)
--
--   select jsonb_pretty(public.seasonal_block(null));
--
-- 4.3 สร้างแผ่นของวันล่าสุดใหม่เป็นรุ่น v2
--     (แผ่นเดิมเป็น v1 · ต้องใช้ force เพราะกติกาแช่แข็ง)
--
--   select * from public.build_daily_facts(null, true);
--
-- 4.4 ยืนยันว่าแผ่นใหม่มี 13 กลุ่มและเป็น v2
--
--   select trade_date,
--          facts->'meta'->>'facts_version'            as version,
--          (select count(*) from jsonb_object_keys(facts->'groups')) as n_groups,
--          facts->'groups'->'ret.week'->>'week_start'  as week_start,
--          facts->'groups'->'ret.week'->>'days_in_week' as days_in_week,
--          facts->'groups'->'seasonal'->'week_current'->>'period' as week_no
--   from public.daily_facts
--   order by trade_date desc limit 3;
--
-- 4.5 เทียบผลตอบแทนรายสัปดาห์กับรายวันของกองที่ร่างพูดถึง
--     ค่า rvol รายสัปดาห์ของ XLP/XLV ควรต่างจากรายวันอย่างมีเหตุผล
--
--   select t.ticker,
--          f.facts->'groups'->'vol.day' ->'values'->t.ticker as day_z_rvol,
--          f.facts->'groups'->'vol.week'->'values'->t.ticker as week_z_rvol
--   from public.daily_facts f,
--        (values ('XLV'),('XLP'),('INDA'),('PAWZ')) as t(ticker)
--   where f.trade_date = (select max(trade_date) from public.daily_facts);
