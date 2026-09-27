-- ============================================================================
-- 2026-09-27: fixes the daily market-event sync, broken since 2026-09-23.
-- Round 2 replaced unique(event_type, event_date) with a PARTIAL unique index
-- (WHERE source <> 'manual') so several users can file a custom event on the
-- same day. PostgREST's upsert cannot name a partial index, so
-- scripts/fetch_events.py failed every run with
--   42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
-- The merge now happens in the database, where the index predicate can be given.
-- ALREADY APPLIED (migration upsert_system_events_rpc). Reference only.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.upsert_system_events(p_rows jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE n integer;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a json array';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(event_type text, source text)
    WHERE r.event_type = 'custom' OR r.source = 'manual' OR r.source IS NULL OR r.event_type IS NULL
  ) THEN
    RAISE EXCEPTION 'upsert_system_events handles system events only (never custom/manual)';
  END IF;

  WITH src AS (
    SELECT r.event_type, r.event_date, r.source, r.note
    FROM jsonb_to_recordset(p_rows) AS r(event_type text, event_date date, source text, note text)
  ), ins AS (
    INSERT INTO public.market_events (event_type, event_date, source, note)
    SELECT event_type, event_date, source, note FROM src
    ON CONFLICT (event_type, event_date) WHERE source <> 'manual'
    DO UPDATE SET source = EXCLUDED.source, note = EXCLUDED.note, updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END;
$function$;

-- the sync job runs with the service role; nobody else needs this
REVOKE ALL ON FUNCTION public.upsert_system_events(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_system_events(jsonb) TO service_role;
