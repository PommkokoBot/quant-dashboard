-- =====================================================================
-- รอบ B1 · ความถูกต้องของข้อมูล — ด่านความครบของแผ่น fact
-- ไฟล์: sql/2026-11-13_b1_completeness_gate.sql
-- วันที่: 13 พ.ย. 2026
-- =====================================================================
-- ปัญหาที่แก้ (ข้อ 8.15 ของ claude/tool-quant-dashboard.md)
--   คืน 10 พ.ย. fetch_prices.py วิ่งห่างตลาดปิดแค่ 5 ชม. Yahoo ยังไม่ลงราคา
--   ของกองธีมเล็ก จึงได้มา 54 จาก 93 กอง โดยไม่มี error สักกอง
--   build_daily_facts จึงสร้างแผ่นจาก 54 กอง และ Breadth ออกมาเป็น 15/24 = 62.5%
--   ขณะที่คำตอบจริงคือ 47/93 = 50.5%
--   ด่านที่มีอยู่ทั้งหมดเงียบสนิท เพราะทุกด่านถามว่า "เลขสอดคล้องกันไหม"
--   และ 15/24 = 62.5% สอดคล้องสมบูรณ์ในตัวมันเอง
--   ไม่มีด่านไหนถามว่า "ของที่เอามาคำนวณครบหรือเปล่า"
--
-- ไฟล์นี้เพิ่มคำถามข้อนั้น และบันทึกการแก้ cron ของวันที่ 11 พ.ย. ที่ยังไม่มีไฟล์
--
-- ลำดับในไฟล์
--   1 · coverage_report()          ฟังก์ชันใหม่ — นิยามเดียวของคำว่า "ครบ"
--   2 · build_daily_facts()        ของเดิมทุกตัวอักษร + บล็อกด่าน 10 บรรทัด
--   3 · catch_up_daily_facts()     ฟังก์ชันใหม่ — ไล่สร้างแผ่นของวันที่ยังขาด
--   4 · pg_cron                    บันทึกการแก้ 11 พ.ย. + ให้ไล่เก็บวันที่ขาดด้วย
--   5 · คำสั่งตรวจหลังรัน           (คอมเมนต์ไว้ ให้รันเองทีละคำสั่ง)
--
-- ไฟล์นี้รันซ้ำได้ทั้งไฟล์โดยไม่เสียหาย (create or replace / alter_job ทั้งหมด)
-- ไม่มี revoke · ไม่มี drop policy · ไม่มี delete · ไม่สร้างตารางใหม่ จึงไม่มีเรื่อง RLS
--
-- ตรวจก่อนแก้: md5 ของ build_daily_facts ในฐานข้อมูลจริง (ตัดอักขระ \r ออก)
-- ตรงกับไฟล์ sql/2026-11-04_phase2a_fact_sheet.sql เป๊ะ = 2dbdef1884a8592c0b651c1941f292f3
-- แปลว่าไฟล์ในrepo ไม่ได้ล้าหลังของจริง การแก้จากไฟล์จึงไม่ทับงานที่เคยแก้สด
-- =====================================================================

-- ---------------------------------------------------------------------------
-- ส่วนที่ 1 · coverage_report() — "วันนั้นมีราคามากี่กอง และปกติควรมีกี่กอง"
-- ---------------------------------------------------------------------------
-- ทำไมไม่เทียบกับเลข 93 ตรง ๆ: ทั้งประวัติมีเพียง 581 วันที่มีครบ 93 กอง
-- (วันแรกคือ 23 ก.ค. 2024) เพราะ ETF หลายกองเกิดทีหลัง · ถ้าตั้งด่านเป็น
-- "ต้องมี 93" backfill_daily_facts จะสร้างแผ่นย้อนหลังไม่ได้อีกเลย
-- จึงเทียบกับ "ค่ากลางของ 5 วันทำการก่อนหน้า" ซึ่งใช้ได้ทั้งแผ่นวันนี้และแผ่นย้อนหลัง
--
-- เกณฑ์อยู่ที่นี่ที่เดียว · build_daily_facts และ watchdog.py อ่านผลจากฟังก์ชันนี้
-- ไม่ถือเกณฑ์ของตัวเอง (กติกาข้อ 7.2 — ห้ามมีนิยามชุดที่สอง)
create or replace function public.coverage_report(p_date date default null)
returns table(
  trade_date  date,
  n_priced    int,
  baseline    int,
  pct         numeric,
  is_complete boolean,
  reason      text)
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $fn$
declare
  c_min_pct       constant numeric := 98.0;  -- ต่ำกว่านี้ = ไม่ครบ (ยอมให้ขาด 1-2 กอง)
  c_baseline_days constant int     := 5;     -- จำนวนวันทำการก่อนหน้าที่ใช้หาค่ากลาง
  v_td   date;
  v_n    int;
  v_base numeric;
begin
  v_td := coalesce(p_date, (select max(o.date) from public.ohlcv_daily o));
  if v_td is null then
    trade_date := null; n_priced := 0; baseline := null; pct := null;
    is_complete := false; reason := 'ไม่มีข้อมูลราคาเลย';
    return next; return;
  end if;

  -- นับเฉพาะกองที่เปิดใช้งาน ผ่าน view instruments_active (ลืมกรอง is_active ไม่ได้)
  select count(*)::int into v_n
  from public.ohlcv_daily o
  join public.instruments_active i on i.id = o.instrument_id
  where o.date = v_td and o.close is not null;

  select percentile_cont(0.5) within group (order by d.n) into v_base
  from (
    select count(*)::numeric as n
    from public.ohlcv_daily o
    join public.instruments_active i on i.id = o.instrument_id
    where o.date < v_td and o.close is not null
    group by o.date
    order by o.date desc
    limit c_baseline_days
  ) d;

  trade_date := v_td;
  n_priced   := v_n;
  baseline   := round(v_base)::int;

  if v_base is null or v_base = 0 then
    -- วันแรกสุดของชุดข้อมูล ไม่มีอะไรให้เทียบ · ไม่ถือเป็นความผิด
    pct := null;
    is_complete := true;
    reason := format('ไม่มีวันก่อนหน้าให้เทียบ — ผ่านโดยปริยาย (%s กอง)', v_n);
  else
    pct := round(100.0 * v_n / v_base, 1);
    is_complete := pct >= c_min_pct;
    if is_complete then
      reason := format('ครบ — %s กอง จากค่าปกติ %s (%s%%)', v_n, round(v_base)::int, pct);
    else
      reason := format('ไม่ครบ — %s กอง จากค่าปกติ %s (%s%%) · ขั้นต่ำ %s%%',
                       v_n, round(v_base)::int, pct, c_min_pct);
    end if;
  end if;
  return next;
end
$fn$;

comment on function public.coverage_report(date) is
  'รอบ B1 · นับกองที่มีราคาในวันนั้น เทียบกับค่ากลางของ 5 วันทำการก่อนหน้า · เกณฑ์ 98% · เป็นนิยามเดียวของคำว่า "ข้อมูลครบ" ทั้งระบบ';


-- ---------------------------------------------------------------------------
-- ส่วนที่ 2 · build_daily_facts() — ของเดิมทั้งดุ้น + บล็อกด่านความครบ
-- ---------------------------------------------------------------------------
-- ตัวฟังก์ชันคัดลอกมาจาก sql/2026-11-04_phase2a_fact_sheet.sql ตรง ๆ
-- สิ่งที่เพิ่มมีสองจุดเท่านั้น: ตัวแปร v_cov_ok / v_cov_why ในส่วน declare
-- และบล็อกด่านก่อนบรรทัด v_maxd := ... · ไม่มีบรรทัดเดิมถูกแก้แม้แต่ตัวอักษรเดียว

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

-- ---------------------------------------------------------------------------
-- ส่วนที่ 3 · catch_up_daily_facts() — ไล่สร้างแผ่นของวันที่ยังขาด
-- ---------------------------------------------------------------------------
-- ทำไมต้องมี: ด่านความครบเปลี่ยน "แผ่นผิด" เป็น "ไม่มีแผ่น" ซึ่งดีกว่ามาก
-- แต่ build_daily_facts() ที่เรียกเปล่า ๆ สร้างได้เฉพาะ "วันล่าสุดของข้อมูล"
-- พอวันถัดไปราคาเติมเข้ามา วันล่าสุดก็ขยับไปแล้ว แผ่นของวันที่ถูกปฏิเสธ
-- จึงกลายเป็นรูถาวรที่ต้องสั่ง force ด้วยมือทุกครั้ง · ตัวนี้ปิดรูนั้นเอง
--
-- ข้อจำกัดที่ต้องรู้: แผ่นที่สร้างตามหลัง (ไม่ใช่วันล่าสุด) จะบันทึกกลุ่ม risk
-- และ health เป็น available:false เพราะสองกลุ่มนั้นคำนวณ "ณ ตอนนี้" ย้อนหลังไม่ได้
-- → ตัวเลขราคาได้คืนครบ แต่ ATR เปอร์เซ็นไทล์ / ตำแหน่ง 52 สัปดาห์ ของวันนั้นหายถาวร
create or replace function public.catch_up_daily_facts(p_days int default 10)
returns table(trade_date date, created boolean, reason text)
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_d date;
  r   record;
begin
  for v_d in
    select d.date
    from (
      select distinct o.date
      from public.ohlcv_daily o
      order by o.date desc
      limit greatest(coalesce(p_days, 10), 1)
    ) d
    where not exists (
      select 1 from public.daily_facts f where f.trade_date = d.date)
    order by d.date          -- เก่าไปใหม่ เพื่อให้ลำดับผลอ่านง่าย
  loop
    select b.trade_date, b.created, b.reason
      into r
      from public.build_daily_facts(v_d, false) b;
    trade_date := r.trade_date;
    created    := r.created;
    reason     := r.reason;
    return next;
  end loop;
end
$fn$;

comment on function public.catch_up_daily_facts(int) is
  'รอบ B1 · ไล่ดูวันทำการล่าสุด N วัน วันไหนยังไม่มีแผ่นและตอนนี้ผ่านด่านความครบแล้วให้สร้างให้ · ไม่มีวันขาดก็คืน 0 แถว';

-- ---------------------------------------------------------------------------
-- ส่วนที่ 4 · pg_cron
-- ---------------------------------------------------------------------------
-- 4.1 บันทึกย้อนหลังการแก้เมื่อ 11 พ.ย. 2026
--     วันนั้นเลื่อนหน้าต่างของ daily-facts-builder จาก '0,30 0-8 * * *'
--     เป็น '0,30 4-8 * * *' ด้วย cron.alter_job ผ่าน MCP แต่ไม่ได้ทำไฟล์ sql/
--     → ฐานข้อมูลกับ repo ต่างกันโดยไม่มีอะไรฟ้อง (ผิดกติกาข้อ 7.4)
--     บรรทัดข้างล่างสั่งค่าเดิมซ้ำ จึงไม่เปลี่ยนอะไรในฐานข้อมูล
--     แต่ทำให้ repo มีบันทึกว่าตารางเวลาปัจจุบันคืออะไรและมาจากไหน
select cron.alter_job(jobid, schedule => '0,30 4-8 * * *')
from cron.job
where jobname = 'daily-facts-builder';

-- 4.2 เปลี่ยนคำสั่งให้ไล่เก็บวันที่ขาดด้วย ไม่ใช่สร้างแค่วันล่าสุด
--     ของเดิม: select public.build_daily_facts()
--     ถ้าวันไหนถูกด่านปฏิเสธ แล้ววันถัดไปราคาเติมเข้ามา วันล่าสุดจะขยับไปแล้ว
--     แผ่นของวันที่ถูกปฏิเสธจึงไม่มีทางถูกสร้างเองอีกเลย
--     catch_up_daily_facts(10) สร้างแผ่นของวันล่าสุดเหมือนเดิม และเก็บวันที่ขาด
--     ย้อนหลังไม่เกิน 10 วันทำการให้ด้วย · ไม่มีวันขาดก็ไม่ทำอะไร
select cron.alter_job(jobid, command => 'select public.catch_up_daily_facts(10)')
from cron.job
where jobname = 'daily-facts-builder';

-- ---------------------------------------------------------------------------
-- ส่วนที่ 5 · คำสั่งตรวจหลังรัน (คอมเมนต์ไว้ — ลอกไปรันทีละคำสั่งได้เลย)
-- ---------------------------------------------------------------------------
-- 5.1 ความครบของ 10 วันทำการล่าสุด · ควรขึ้น is_complete = true ทุกแถว
--     (ยกเว้นวันที่ราคายังมาไม่ครบจริง ๆ ซึ่งเป็นสิ่งที่เราอยากให้มันบอก)
--
--   select c.* from (
--     select distinct date from public.ohlcv_daily order by date desc limit 10
--   ) d, lateral public.coverage_report(d.date) c
--   order by c.trade_date;
--
-- 5.2 สร้างแผ่นของ 10 พ.ย. ใหม่ (แผ่นที่ผิดอยู่ตอนนี้)
--     ราคาของวันนั้นเติมครบ 93 กองแล้ว จึงต้องผ่านด่านและสร้างทับได้
--
--   select * from public.build_daily_facts('2026-11-10', true);
--
-- 5.3 ยืนยันว่าตัวหารกลับมาเป็น 93 · ค่าที่ถูกคือราว 50.5% ไม่ใช่ 62.5%
--
--   select trade_date,
--          facts->'groups'->'breadth'->'today'->>'universe' as universe,
--          facts->'groups'->'breadth'->'today'->>'pct'      as pct,
--          facts->'meta'->>'source'                          as source
--   from public.daily_facts
--   where trade_date in ('2026-11-09','2026-11-10','2026-11-11');
--
-- 5.4 ดูว่ามีวันไหนในช่วง 10 วันทำการล่าสุดยังไม่มีแผ่น · ควรได้ 0 แถวหลังข้อ 5.2
--
--   select * from public.catch_up_daily_facts(10);
--
-- 5.5 ยืนยันตารางเวลาและคำสั่งของ pg_cron
--
--   select jobname, schedule, command from cron.job order by jobid;
