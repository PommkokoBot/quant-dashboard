-- =====================================================================
-- Quant Dashboard — Phase 2A  (fact sheet รายวัน · ยังไม่มี AI)
-- อ้างอิง: claude/tool-quant-dashboard.md ข้อ 11.3 และแผนรอบ 2A
--
-- วิธีรัน : Supabase SQL Editor → วางทั้งไฟล์ → Run
-- ปลอดภัย : ไม่มี revoke / drop policy / delete ทั้งไฟล์ (บทเรียนข้อ 8.8)
--           รันซ้ำได้ · ไม่แตะ index.html · ไม่แตะตาราง ฟังก์ชัน หรือ policy เดิม
--
-- รอบนี้ย้ายสองสูตรที่ยังอยู่ใน JS ลงมาอยู่กับพวกเดียวกันใน SQL
-- เพื่อให้บทสรุปสาธารณะกับหน้าเว็บอ้างแหล่งเดียวกัน (รอบ 2B จะสลับหน้าเว็บมาเรียก)
--
-- พิสูจน์แล้วว่าตรงกับ JS: เทียบ 2,697 คู่ (ผลตอบแทน 1,581 · volume 1,116)
--   ครบ 93 กอง x 3 granularity x ทุก lookback ที่หน้าเว็บมี
--   ต่างมากสุด 3.1e-14 (เศษปัดของ float64) · null ตรงกันทุกตำแหน่ง · ไม่ผ่าน 0
--   JS ที่ใช้เทียบคัดลอกจาก index.html ที่ push จริง (md5 b7a3e31d…) ไม่ได้เขียนใหม่
--   พิสูจน์ว่าแดงได้ 4 แบบ: off-by-one · ddof=0 · รวมงวดปัจจุบันเข้าฐาน · ใช้ค่าเฉลี่ยเลขคณิต
--
-- ทดสอบทั้งไฟล์จริงบนฐานข้อมูล nsbreucmgfmphmfewnbw ใน transaction ที่ rollback — ผ่าน 14 ข้อ:
--   ส่ง as_of = วันล่าสุด ได้ค่าเดิมเป๊ะ 0/0 แถวต่าง (backward compatible)
--   ส่ง as_of ย้อน 30 วัน ได้คนละชุดครบ 93 แถว (point-in-time ทำงานจริง)
--   ประตูเวลาปฏิเสธการสร้างของวันที่ยังไม่ถึง 00:00 UTC ของ D+1
--   สร้างแผ่นวันล่าสุด 10 กลุ่ม 2,098 ms · เรียกซ้ำไม่ทับของเก่า
--   backfill 3 วัน 4,012 ms (~1.34 วิ/วัน -> 20 วันราว 27 วิ ปลอดภัยจาก timeout)
--   แผ่นย้อนหลังประทับ source=backfilled และ risk.available=false ตามที่ตั้งใจ
--   breadth ของแผ่นย้อนหลังหยิบแถวของ trade_date ถูกต้อง ไม่ใช่แถวล่าสุด
--   SPY 21 วัน แผ่น 7 ต.ค. = +1.72% · แผ่นล่าสุด = -2.64% (คนละค่าจริง)
--   ขนาด 26 kB ต่อแผ่น -> ราว 6.5 MB ต่อปี
--
-- ตัวเลขที่ตรวจสอบข้ามกับงานรอบก่อน:
--   QQQ-SPY 21 วัน = -6.86 จุด เปอร์เซ็นไทล์ 0.2 — ตรงกับที่คำนวณมือไว้ในข้อ 11.2
--   Low Beta - High Beta = +14.33 จุด เปอร์เซ็นไทล์ 99.6 จาก 712 วัน
-- =====================================================================


-- =====================================================================
-- 2A.1  trailing_returns — เทียบเท่า computeTrailingReturn() ใน index.html
--
--   (close[t] / close[t-N] - 1) * 100 · ต้องมีอย่างน้อย N+1 งวด ไม่งั้นคืน null
--
--   *** ห้ามเขียนการแบ่งงวดใหม่ *** ฟังก์ชันนี้เรียก period_end_closes ตัวเดิม
--   ส่วนที่ยากและเปราะ (การแบ่งงวด · กฎงวดที่จบแล้ว · ปฏิทินวันทำการ) อยู่ในนั้นแล้ว
--   ที่นี่มีแต่เลขคณิต ชุดข้อมูลตั้งต้นจึงเหมือนหน้าเว็บโดยโครงสร้าง ไม่ใช่โดยบังเอิญ
--
--   p_start_date: ไม่ส่ง = คำนวณขอบเขตให้เองจาก max(lookback) เพื่อกันลืม
--   วัดจริง: ไม่จำกัดขอบเขต 1,224 ms -> จำกัด 147 ms (8.3 เท่า) ผลเหมือนกันทุกแถว
--   ขอบเขตอ้างจาก max(date) ของชุดข้อมูล ไม่ใช่ current_date เผื่อวันที่ pipeline ค้าง
-- =====================================================================
create or replace function public.trailing_returns(
  p_instrument_ids bigint[],
  p_granularity    text,
  p_lookbacks      int[],
  p_complete_only  boolean default false,
  p_start_date     date    default null,
  p_as_of          date    default null
)
returns table (instrument_id bigint, lookback int, period_end date, return_pct double precision)
language sql stable
set search_path = public, pg_temp
as $fn$
  with lk as (select distinct unnest(p_lookbacks) as lb),
  anchor as (select coalesce(p_as_of, (select max(o.date) from public.ohlcv_daily o)) as a),
  bound as (
    select coalesce(p_start_date,
      (select a from anchor) -
      (case p_granularity
         when 'day'   then ((select max(lb) from lk) + 2) * 22 / 10 + 40
         when 'week'  then ((select max(lb) from lk) + 2) * 8      + 40
         when 'month' then ((select max(lb) from lk) + 2) * 32     + 90
       end)::int) as d),
  s as materialized (
    select c.instrument_id as iid, c.period_end, c.adj_close::float8 as close,
           row_number() over (partition by c.instrument_id order by c.period_end desc) as rn
    from bound, anchor, public.period_end_closes(p_instrument_ids, p_granularity, bound.d, anchor.a, p_complete_only) c),
  last_row as materialized (select iid, period_end, close from s where rn = 1)
  select l.iid, lk.lb, l.period_end,
         case when b.close is not null and b.close <> 0 then (l.close / b.close - 1) * 100 end
  from last_row l
  cross join lk
  left join s b on b.iid = l.iid and b.rn = lk.lb + 1
$fn$;

comment on function public.trailing_returns(bigint[], text, int[], boolean, date, date) is
  'ผลตอบแทนสะสมย้อนหลัง N งวด เป็น % — เทียบเท่า computeTrailingReturn() ใน index.html · เรียก period_end_closes เป็นฐาน ห้ามเขียนการแบ่งงวดใหม่';


-- =====================================================================
-- 2A.2  volume_anomaly — เทียบเท่า computeVolumeAnomaly() ใน index.html
--
--   z    = (ln(V_t) - meanLog) / sdLog      (sdLog = sample SD, ddof=1)
--   rvol = V_t / exp(meanLog)               (ตัวหารเป็นค่าเฉลี่ยเรขาคณิต)
--
--   กติกาที่ห้ามย้อน (lessons.md ข้อ 2 และข้อ 7 ของเอกสารเครื่องมือ):
--     * คิดบน log + ค่าเฉลี่ยเรขาคณิต ห้ามกลับไปใช้ volume ดิบ
--     * ฐานคือ N งวด "ก่อนหน้า" ไม่รวมงวดปัจจุบัน กัน spike ดันค่าเฉลี่ยของตัวเอง
--     * ฐานมี null หรือ volume <= 0 แม้ตัวเดียว -> คืน null ทั้งก้อน (ไม่เฉลี่ยข้าม)
--
--   ln()/exp() ต้องทำบน float8 ให้ตรงกับ Math.log/Math.exp ของ JS
--   (สำหรับผลตอบแทน การ cast float8 ไม่มีผลต่อค่าเลย วัดแล้วต่างต่ำกว่า 1e-9
--    และไม่ได้เร็วกว่าด้วย — คงไว้เพื่อให้สองฟังก์ชันใช้ข้อตกลงเดียวกัน)
-- =====================================================================
create or replace function public.volume_anomaly(
  p_instrument_ids bigint[],
  p_granularity    text,
  p_baseline       int,
  p_complete_only  boolean default false,
  p_start_date     date    default null,
  p_as_of          date    default null
)
returns table (instrument_id bigint, period_end date, volume double precision,
               geo_mean double precision, sd_log double precision,
               z_score double precision, rvol double precision)
language sql stable
set search_path = public, pg_temp
as $fn$
  with anchor as (select coalesce(p_as_of, (select max(o.date) from public.ohlcv_daily o)) as a),
  bound as (
    select coalesce(p_start_date,
      (select a from anchor) -
      (case p_granularity
         when 'day'   then (p_baseline + 3) * 22 / 10 + 40
         when 'week'  then (p_baseline + 3) * 8      + 40
         when 'month' then (p_baseline + 3) * 32     + 90
       end)::int) as d),
  v as materialized (
    select c.instrument_id as iid, c.period_end, c.volume::float8 as vol,
           case when c.volume is not null and c.volume > 0 then ln(c.volume::float8) end as lg,
           row_number() over (partition by c.instrument_id order by c.period_end desc) as rn
    from bound, anchor, public.period_volume_series(p_instrument_ids, p_granularity, bound.d, anchor.a, p_complete_only) c),
  cur as materialized (select iid, period_end, vol, lg from v where rn = 1),
  base as materialized (
    select iid, count(*)::int as n, count(lg)::int as n_ok,
           avg(lg) as mean_log, stddev_samp(lg) as sd_log
    from v where rn between 2 and p_baseline + 1
    group by iid)
  select c.iid, c.period_end, c.vol, g.geo, b.sd_log,
         case when c.lg is not null and g.geo is not null
                   and b.sd_log is not null and b.sd_log > 0
              then (c.lg - b.mean_log) / b.sd_log end,
         case when g.geo is not null and g.geo > 0 then c.vol / g.geo end
  from cur c
  left join base b on b.iid = c.iid and b.n = p_baseline and b.n_ok = p_baseline
  cross join lateral (select case when b.mean_log is not null then exp(b.mean_log) end as geo) g
$fn$;

comment on function public.volume_anomaly(bigint[], text, int, boolean, date, date) is
  'Z-score และ RVOL ของปริมาณซื้อขาย คิดบน log + ค่าเฉลี่ยเรขาคณิต ไม่รวมงวดปัจจุบันเข้าฐาน — เทียบเท่า computeVolumeAnomaly() ใน index.html';


-- =====================================================================
-- 2A.4  fact_pair — คู่เปรียบเทียบ · Peat เพิ่ม/แก้เองได้ใน Table Editor
--       left_kind = 'ticker' เทียบสองกอง · 'bucket' เทียบสองกลุ่ม beta
-- =====================================================================
create table if not exists public.fact_pair (
  code        text primary key,
  label_th    text not null,
  left_kind   text not null check (left_kind  in ('ticker','bucket')),
  left_ref    text not null,
  right_kind  text not null check (right_kind in ('ticker','bucket')),
  right_ref   text not null,
  days        int  not null default 21,
  enabled     boolean not null default true,
  sort_order  int  not null default 100,
  note        text
);

comment on table public.fact_pair is
  'คู่เปรียบเทียบสำหรับ fact sheet — Phase 2A · เพิ่มแถวที่นี่ได้เลย ไม่ต้องแก้โค้ด';

-- RLS: เปิดแต่ไม่ใส่ policy ให้ใครเลย = ปิดสนิทสำหรับ anon และ authenticated
--   มติข้อ 1.9 เปิด anon ไว้แค่ 4 ตาราง (daily_brief · daily_facts ·
--   classification_rule · instrument_classification) ตารางนี้ไม่อยู่ในนั้น
--   และไม่จำเป็นต้องอยู่ เพราะ label กับ note ของแต่ละคู่ถูกฝังอยู่ใน
--   fact sheet ของทุกวันแล้ว หน้าสาธารณะจึงไม่ต้องอ่านตารางนี้ตรง ๆ
--
--   ใครยังอ่าน/เขียนได้: postgres (pg_cron) และ service_role ซึ่ง bypass RLS
--   -> pair_spreads() ที่ถูกเรียกจาก build_daily_facts ยังทำงานปกติ
--   -> Table Editor บนหน้า Supabase ใช้สิทธิ์ service_role จึงยังแก้ค่าได้เหมือนเดิม
--
--   ถ้าวันหน้าอยากให้หน้าเว็บอ่านรายการคู่โดยตรง ให้เพิ่ม policy ตอนนั้น
--   อย่างตั้งใจ แบบเดียวกับที่ Phase 1 ทำ ไม่ใช่เปิดทิ้งไว้ตั้งแต่ต้น
alter table public.fact_pair enable row level security;

insert into public.fact_pair
  (code, label_th, left_kind, left_ref, right_kind, right_ref, days, enabled, sort_order, note)
values
  ('qqq_spy',          'QQQ − SPY',           'ticker','QQQ',      'ticker','SPY',       21, true, 10, null),
  ('iwm_spy',          'IWM − SPY',           'ticker','IWM',      'ticker','SPY',       21, true, 20, null),
  ('lowbeta_highbeta', 'Low Beta − High Beta','bucket','low_beta', 'bucket','high_beta', 21, true, 30,
   'สมาชิกยึดตามไตรมาสจริงของแต่ละวัน ไม่ใช่รายชื่อวันนี้ย้อนอดีต · ประวัติกลุ่มเริ่ม 2024-01 เปอร์เซ็นไทล์จึงได้ ~2.8 ปี ไม่ถึง 3 ปี')
on conflict (code) do nothing;


-- =====================================================================
-- 2A.4b  pair_spreads — ส่วนต่างผลตอบแทนของคู่ + เปอร์เซ็นไทล์ย้อนหลัง
--
--   คู่แบบ bucket คิดจากสมาชิกของ "ไตรมาสนั้น ๆ" ตามประวัติจริง
--   ถ้าใช้รายชื่อวันนี้ย้อนไปทั้งเส้นจะเป็น look-ahead — เอารายชื่อที่เรารู้วันนี้ไปตัดสินอดีต
--   ทำได้เพราะ Phase 1 backfill ประวัติกลุ่มไว้ 12 ไตรมาสแล้ว
--
--   ตรวจแล้ว: QQQ−SPY = -6.86 จุด เปอร์เซ็นไทล์ 0.2 ตรงกับที่คำนวณมือตอนออกแบบ (ข้อ 11.2)
-- =====================================================================
create or replace function public.pair_spreads(p_as_of date)
returns table (code text, label_th text, spread_pct double precision,
               pctile double precision, n_days int, window_start date, note text)
language sql stable
set search_path = public, pg_temp
as $fn$
  with px as materialized (
    select o.instrument_id as iid, o.date as d, o.adj_close::float8 as c
    from public.ohlcv_daily o
    join public.instruments_active i on i.id = o.instrument_id
    where o.date >= p_as_of - 1300 and o.date <= p_as_of),
  r as materialized (
    select iid, d,
           c / nullif(lag(c, (select max(days) from public.fact_pair)) over (partition by iid order by d), 0) - 1 as rr
    from px),
  tick as (
    select fp.code, r.d, i.ticker, r.rr
    from public.fact_pair fp
    join public.instruments_active i on i.ticker in (fp.left_ref, fp.right_ref)
    join r on r.iid = i.id
    where fp.enabled and fp.left_kind = 'ticker'),
  tick_sp as (
    select fp.code, t.d,
           (max(t.rr) filter (where t.ticker = fp.left_ref) -
            max(t.rr) filter (where t.ticker = fp.right_ref)) * 100 as spread
    from tick t join public.fact_pair fp on fp.code = t.code
    group by fp.code, t.d),
  bkt as (
    select fp.code, r.d, m.bucket, avg(r.rr) as gr
    from public.fact_pair fp
    join public.instrument_classification m on m.bucket in (fp.left_ref, fp.right_ref)
    join r on r.iid = m.instrument_id and m.as_of_quarter = date_trunc('quarter', r.d)::date
    where fp.enabled and fp.left_kind = 'bucket' and r.rr is not null
    group by fp.code, r.d, m.bucket),
  bkt_sp as (
    select fp.code, b.d,
           (max(b.gr) filter (where b.bucket = fp.left_ref) -
            max(b.gr) filter (where b.bucket = fp.right_ref)) * 100 as spread
    from bkt b join public.fact_pair fp on fp.code = b.code
    group by fp.code, b.d),
  clean as (
    select code, d, spread
    from (select * from tick_sp union all select * from bkt_sp) z
    where spread is not null),
  last_sp as (select distinct on (code) code, d, spread from clean order by code, d desc)
  select l.code, fp.label_th, l.spread,
         100.0 * (select count(*) from clean x where x.code = l.code and x.spread <= l.spread)
               / nullif((select count(*) from clean x where x.code = l.code), 0),
         (select count(*)::int from clean x where x.code = l.code),
         (select min(d) from clean x where x.code = l.code),
         fp.note
  from last_sp l join public.fact_pair fp on fp.code = l.code
$fn$;

comment on function public.pair_spreads(date) is
  'ส่วนต่างผลตอบแทนของคู่ใน fact_pair + เปอร์เซ็นไทล์ย้อนหลัง · คู่แบบกลุ่มใช้สมาชิกตามไตรมาสจริง กัน look-ahead';


-- =====================================================================
-- 2A.5  build_daily_facts — ประกอบ fact sheet รายวันแล้วเก็บลง daily_facts
--
--   ประตูเวลา  : fact ของวัน D สร้างได้ตั้งแต่ 00:00 UTC ของวัน D+1
--                = หลังตลาดสหรัฐฯ ปิดอย่างน้อย 3 ชม. ทั้งปี ไม่ต้องจัดการ DST
--   แช่แข็ง    : ไม่ทับของเก่า ต้องสั่ง p_force เองถ้าจำเป็นจริง
--   ลายเซ็นสูตร: ประทับ md5 ของนิยามฟังก์ชันที่ใช้ ถ้ามีคนแก้ในฐานข้อมูล
--                โดยไม่อัปไฟล์เข้า repo ลายเซ็นจะเปลี่ยนและเห็นได้จากข้อมูลเอง
--   รูปแบบ     : จัดกลุ่ม (source เขียนครั้งเดียวต่อกลุ่ม) ตามที่ตกลงกัน
--
--   ⚠️ กลุ่ม risk และ health ใส่ได้เฉพาะแผ่นของวันล่าสุด
--      เพราะ risk_metrics() และ data_health_overview() คำนวณ ณ ปัจจุบันเสมอ
--      ไม่มีพารามิเตอร์วันที่ · แผ่นย้อนหลังจึงบันทึก available=false พร้อมเหตุผล
--      แทนที่จะเอาค่าของวันนี้ไปประทับเป็นค่าของวันในอดีต
-- =====================================================================
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
  c_version constant text := 'v1';
  v_td      date;
  v_gate    timestamptz;
  v_exists  boolean;
  v_facts   jsonb;
  v_maxd    date;
  v_current boolean;   -- วันนี้เป็นวันล่าสุดของชุดข้อมูลหรือไม่
  v_brdays  int;
  v_meta    jsonb;
  v_lineage jsonb;
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
                      'period_volume_series','compute_classification');

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
      'us_sector_ranked',(select jsonb_agg(jsonb_build_array(ticker,v) order by v desc) from rnk where category='us_sector')) g),

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

-- =====================================================================
-- 2A.6  backfill_daily_facts — สร้าง fact ย้อนหลัง N วัน
--       เดินจากเก่าไปใหม่ · ข้ามวันที่มีอยู่แล้ว · ข้ามวันที่ไม่ใช่วันทำการ
--
--       ⚠️ fact มหภาคของวันก่อน 3 พ.ย. 2026 จะบางกว่าปกติ เพราะ macro_revisions
--       เพิ่งเริ่มเก็บ point-in-time วันนั้น · ไม่เติมค่าเดาย้อนหลัง
-- =====================================================================
create or replace function public.backfill_daily_facts(
  p_days  int default 60,
  p_limit int default 20   -- สร้างได้สูงสุดกี่วันต่อการเรียกหนึ่งครั้ง
)
returns table (trade_date date, created boolean, n_groups int, reason text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare d date; made int := 0; r record;
begin
  if p_days  < 1 or p_days  > 400 then
    raise exception 'p_days ต้องอยู่ระหว่าง 1 ถึง 400 (ได้รับ: %)', p_days; end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit ต้องอยู่ระหว่าง 1 ถึง 100 (ได้รับ: %)', p_limit; end if;

  for d in
    select distinct o.date from public.ohlcv_daily o
    where o.date > (select max(date) from public.ohlcv_daily) - p_days
    order by o.date
  loop
    -- ข้ามวันที่สร้างแล้วโดยไม่เรียกฟังก์ชัน จะได้ไม่เสียเวลาคำนวณ
    if exists (select 1 from public.daily_facts f where f.trade_date = d) then
      continue;
    end if;
    for r in select * from public.build_daily_facts(d, false) loop
      trade_date := r.trade_date; created := r.created;
      n_groups := r.n_groups; reason := r.reason; return next;
      if r.created then made := made + 1; end if;
    end loop;
    exit when made >= p_limit;
  end loop;
end
$fn$;

comment on function public.backfill_daily_facts(int, int) is
  'สร้าง fact sheet ย้อนหลัง N วัน ครั้งละไม่เกิน p_limit วัน — Phase 2A · เรียกซ้ำจนกว่าจะไม่มีแถว created = true';


-- =====================================================================
-- 2A.7  pg_cron — เดินตรวจทุก 30 นาที ช่วง 00:00-08:00 UTC
--
--   ทำไมเป็นช่วงเวลา ไม่ใช่เวลาเดียว:
--     daily-fetch ของ GitHub Actions ถูกเข้าคิวไม่แน่นอน วัดจริง 56 วัน
--     ก่อน 10 ต.ค. ค่ากลาง 11 นาที · ตั้งแต่ 10 ต.ค. ค่ากลาง 2.6 ชม. (ช้าสุด 4.5)
--     ไม่มีเวลาใดเวลาหนึ่งที่ถูกทุกวัน จึงเดินตรวจแล้วสร้างเมื่อข้อมูลพร้อม
--
--   ทำไมเริ่ม 00:00 UTC:
--     นั่นคือ "ปิดตลาดสหรัฐฯ + 3 ชม." พอดีในฤดูหนาว และ +4 ชม. ในฤดูร้อน
--     กติกา "fact ของวัน D สร้างได้ตั้งแต่ 00:00 UTC ของวัน D+1" เป็นจริงทั้งปี
--     โดยไม่ต้องจัดการ DST เลย (เวลาไทย 07:00 น.)
--
--   ครั้งแรกที่เข้าเงื่อนไขชนะ ครั้งถัดไปไม่ทำอะไรเพราะ build_daily_facts
--   ตรวจว่ามีอยู่แล้วและออกทันทีโดยไม่คำนวณ
-- =====================================================================
select cron.schedule(
  'daily-facts-builder',
  '0,30 0-8 * * *',
  $cron$select public.build_daily_facts()$cron$
);


-- =====================================================================
-- 2A.5 (รัน)  Backfill ย้อนหลัง 60 วัน — ครั้งละไม่เกิน 20 วัน
--
--   วัดจริง ~1.4 วินาทีต่อวัน · 20 วัน ≈ 28 วินาที ปลอดภัยจาก statement timeout
--   ที่ postgres ตั้งไว้ 2 นาที (ถ้า timeout กลางคัน ธุรกรรมถูกยกเลิกทั้งก้อน
--   ไม่มีอะไรถูกบันทึก จึงต้องแบ่งเป็นก้อนเล็กแทนที่จะเสี่ยง)
--
--   *** รันบรรทัดนี้ซ้ำจนกว่าผลลัพธ์จะไม่มีแถวไหน created = true ***
--   คาดว่าประมาณ 3 ครั้ง (60 วันตามปฏิทิน ≈ 41 วันทำการ)
-- =====================================================================
select * from public.backfill_daily_facts(60, 20);


-- =====================================================================
-- ตรวจผล — ผลลัพธ์ที่ SQL Editor แสดงคือ query สุดท้ายนี้
-- =====================================================================

-- (ก) fact sheet ล่าสุดมีกลุ่มอะไรบ้าง
-- select trade_date, jsonb_object_keys(facts->'groups') as grp
--   from public.daily_facts order by trade_date desc limit 20;

-- (ข) ดูส่วนต่างคู่ของวันล่าสุด
-- select trade_date, jsonb_pretty(facts->'groups'->'pair'->'values')
--   from public.daily_facts order by trade_date desc limit 1;

-- (ค) ลายเซ็นสูตรที่ใช้สร้าง — ถ้าเปลี่ยนแปลว่ามีคนแก้ฟังก์ชันในฐานข้อมูล
-- select trade_date, jsonb_pretty(facts->'meta'->'lineage')
--   from public.daily_facts order by trade_date desc limit 1;

-- (ง) ขนาดที่เก็บจริงต่อวัน
-- select trade_date, pg_size_pretty(length(facts::text)::bigint) from public.daily_facts
--   order by trade_date desc limit 5;

select trade_date,
       facts->'meta'->>'universe_n'                                   as universe,
       jsonb_array_length(facts->'groups'->'events'->'items')         as events_ahead,
       round((facts->'groups'->'breadth'->'today'->>'pct')::numeric,1) as breadth_pct,
       round((facts->'groups'->'pair'->'values'->'qqq_spy'->>'spread')::numeric,2)     as qqq_spy,
       round((facts->'groups'->'pair'->'values'->'qqq_spy'->>'pctile_3y')::numeric,1)  as qqq_spy_pctile,
       pg_size_pretty(length(facts::text)::bigint)                    as size
from public.daily_facts
order by trade_date desc
limit 10;
