-- ============================================================================
-- Round 2 (2026-09-22): Custom Events + admin approval + expiry
-- ALREADY APPLIED to Supabase project nsbreucmgfmphmfewnbw (9 migrations,
-- versions 20260922042541 .. 20260922124415). Kept here for reference only;
-- this file is the FINAL state (later fixes folded in), safe to re-run.
-- ============================================================================

-- 1. event type + columns ----------------------------------------------------
ALTER TABLE public.event_types DROP CONSTRAINT IF EXISTS event_types_category_check;
ALTER TABLE public.event_types ADD CONSTRAINT event_types_category_check
  CHECK (category IN ('monetary','inflation','politics','options','other','user'));

INSERT INTO public.event_types (code, name_th, name_en, category, source, nontrading_shift, show_default, sort_order, source_note)
VALUES ('custom', 'เหตุการณ์กำหนดเอง', 'Custom Event', 'user', 'manual', 'next', false, 999, 'User-created custom events')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.market_events
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS color text DEFAULT '#3498db',
  ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.market_events DROP CONSTRAINT IF EXISTS market_events_status_check;
ALTER TABLE public.market_events ADD CONSTRAINT market_events_status_check CHECK (status IN ('draft','approved'));

-- system events stay unique per (type, date); manual/custom may repeat
ALTER TABLE public.market_events DROP CONSTRAINT IF EXISTS market_events_event_type_event_date_key;
DROP INDEX IF EXISTS public.market_events_event_type_event_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS market_events_system_unique
  ON public.market_events (event_type, event_date) WHERE source <> 'manual';

-- 2. helpers -----------------------------------------------------------------
-- MUST return false (never NULL): `IF NOT NULL` does not raise, so a NULL here
-- let anonymous callers approve/reject (fixed 2026-09-22).
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT COALESCE((auth.jwt() ->> 'email') = 'mehresix@gmail.com', false); $$;

-- reads auth.users on behalf of normal users; logged-in callers only
CREATE OR REPLACE FUNCTION public.get_masked_email(p_user_id uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
AS $$ SELECT LEFT(u.email, 3) || '***@' || SPLIT_PART(u.email, '@', 2) FROM auth.users u WHERE u.id = p_user_id; $$;
REVOKE ALL ON FUNCTION public.get_masked_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_masked_email(uuid) TO authenticated, service_role;

-- 3. RLS ---------------------------------------------------------------------
ALTER TABLE public.market_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can read market_events" ON public.market_events;
DROP POLICY IF EXISTS "select_market_events"    ON public.market_events;
DROP POLICY IF EXISTS "insert_own_custom_event" ON public.market_events;
DROP POLICY IF EXISTS "update_own_draft"        ON public.market_events;
DROP POLICY IF EXISTS "delete_own_draft"        ON public.market_events;
DROP POLICY IF EXISTS "admin_update_event"      ON public.market_events;
DROP POLICY IF EXISTS "admin_delete_event"      ON public.market_events;
CREATE POLICY "select_market_events"    ON public.market_events FOR SELECT USING (status = 'approved' OR user_id = auth.uid());
CREATE POLICY "insert_own_custom_event" ON public.market_events FOR INSERT WITH CHECK (user_id = auth.uid() AND event_type = 'custom' AND status = 'draft');
CREATE POLICY "update_own_draft"        ON public.market_events FOR UPDATE USING (user_id = auth.uid() AND status = 'draft') WITH CHECK (user_id = auth.uid() AND status = 'draft');
CREATE POLICY "delete_own_draft"        ON public.market_events FOR DELETE USING (user_id = auth.uid() AND status = 'draft');
CREATE POLICY "admin_update_event"      ON public.market_events FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_delete_event"      ON public.market_events FOR DELETE USING (public.is_admin());

-- 4. insert defaults: the server, not the client, decides owner/state --------
-- (RLS WITH CHECK is evaluated after BEFORE triggers)
CREATE OR REPLACE FUNCTION public.set_custom_event_defaults()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.event_type = 'custom' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.user_id    := auth.uid();
      NEW.source     := 'manual';
      NEW.status     := 'draft';
      NEW.expires_at := now() + interval '7 days';
    ELSE -- server-side insert: only fill gaps
      NEW.source := COALESCE(NEW.source, 'manual');
      IF NEW.status = 'draft' AND NEW.expires_at IS NULL THEN
        NEW.expires_at := now() + interval '7 days';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_custom_event_defaults ON public.market_events;
CREATE TRIGGER trg_custom_event_defaults BEFORE INSERT ON public.market_events
  FOR EACH ROW EXECUTE FUNCTION public.set_custom_event_defaults();

-- 5. admin RPCs --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_custom_event(p_event_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only admin can approve events'; END IF;
  UPDATE public.market_events SET status = 'approved', expires_at = NULL WHERE id = p_event_id AND status = 'draft';
END; $$;

CREATE OR REPLACE FUNCTION public.reject_custom_event(p_event_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only admin can reject events'; END IF;
  DELETE FROM public.market_events WHERE id = p_event_id AND status = 'draft';
END; $$;

-- delete an (approved) custom event; system types are refused
CREATE OR REPLACE FUNCTION public.delete_custom_event(p_event_id bigint)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only admin can delete events'; END IF;
  DELETE FROM public.market_events WHERE id = p_event_id AND event_type = 'custom';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'Custom event % not found', p_event_id; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.delete_custom_event(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_custom_event(bigint) TO authenticated;

-- all users' non-expired drafts for the Admin Panel (RLS would hide others')
CREATE OR REPLACE FUNCTION public.admin_pending_drafts()
 RETURNS TABLE(id bigint, event_date date, name text, color text, creator_email text, created_at timestamptz, expires_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only admin can list pending drafts'; END IF;
  RETURN QUERY
    SELECT e.id, e.event_date, e.name, e.color,
           CASE WHEN e.user_id IS NOT NULL THEN public.get_masked_email(e.user_id) END,
           e.created_at, e.expires_at
    FROM public.market_events e
    WHERE e.status = 'draft' AND e.event_type = 'custom'
      AND (e.expires_at IS NULL OR e.expires_at > now())
    ORDER BY e.created_at DESC;
END; $$;
REVOKE ALL ON FUNCTION public.admin_pending_drafts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pending_drafts() TO authenticated;

-- 6. expiry ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_expired_drafts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE deleted_count integer;
BEGIN
  DELETE FROM public.market_events WHERE status = 'draft' AND expires_at IS NOT NULL AND expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END; $$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
-- daily 19:00 UTC = 02:00 Bangkok (unschedule first if re-running)
-- SELECT cron.unschedule('cleanup-expired-custom-drafts');
SELECT cron.schedule('cleanup-expired-custom-drafts', '0 19 * * *', $$SELECT public.cleanup_expired_drafts();$$);

-- 7. read RPC (final) --------------------------------------------------------
-- approved + caller's own; expired drafts hidden immediately (cron deletes them later)
DROP FUNCTION IF EXISTS public.market_events_between(text[], date, date);
CREATE FUNCTION public.market_events_between(p_types text[] DEFAULT NULL, p_start date DEFAULT NULL, p_end date DEFAULT NULL)
RETURNS TABLE(event_type text, event_date date, market_date date, is_future boolean, name_th text, name_en text,
              category text, show_default boolean, note text, status text, color text, event_name text,
              creator_email text, event_id bigint)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH spy AS (SELECT id FROM public.instruments WHERE ticker = 'SPY'),
  bounds AS (
    SELECT (SELECT min(o.date) FROM public.ohlcv_daily o WHERE o.instrument_id = spy.id) AS first_d,
           (SELECT max(o.date) FROM public.ohlcv_daily o WHERE o.instrument_id = spy.id) AS last_d,
           spy.id AS spy_id
    FROM spy)
  SELECT e.event_type, e.event_date,
    CASE
      WHEN e.event_date < b.first_d THEN NULL
      WHEN e.event_date <= b.last_d THEN
        CASE WHEN t.nontrading_shift = 'prev'
          THEN (SELECT max(o.date) FROM public.ohlcv_daily o WHERE o.instrument_id = b.spy_id AND o.date <= e.event_date)
          ELSE (SELECT min(o.date) FROM public.ohlcv_daily o WHERE o.instrument_id = b.spy_id AND o.date >= e.event_date)
        END
      ELSE
        CASE extract(isodow FROM e.event_date)::int
          WHEN 6 THEN e.event_date + CASE WHEN t.nontrading_shift = 'prev' THEN -1 ELSE 2 END
          WHEN 7 THEN e.event_date + CASE WHEN t.nontrading_shift = 'prev' THEN -2 ELSE 1 END
          ELSE e.event_date
        END
    END AS market_date,
    e.event_date > b.last_d AS is_future,
    t.name_th, t.name_en, t.category, t.show_default, e.note, e.status, e.color,
    e.name AS event_name,
    CASE WHEN e.user_id IS NOT NULL THEN public.get_masked_email(e.user_id) END AS creator_email,
    e.id AS event_id
  FROM public.market_events e
  JOIN public.event_types t ON t.code = e.event_type
  CROSS JOIN bounds b
  WHERE (p_types IS NULL OR e.event_type = ANY(p_types))
    AND (p_start IS NULL OR e.event_date >= p_start)
    AND (p_end IS NULL OR e.event_date <= p_end)
    AND (e.status = 'approved' OR e.user_id = auth.uid())
    AND (e.status = 'approved' OR e.expires_at IS NULL OR e.expires_at > now())
  ORDER BY e.event_date, t.sort_order;
$$;
