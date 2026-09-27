-- ============================================================================
-- 2026-09-22 (after round 2): Supabase security-advisor clean-up.
-- ALREADY APPLIED (migrations round2_function_hardening +
-- market_events_between_reset_search_path). Reference only.
-- ============================================================================

-- pin search_path (advisor 0011)
ALTER FUNCTION public.approve_custom_event(bigint) SET search_path = public;
ALTER FUNCTION public.reject_custom_event(bigint)  SET search_path = public;
ALTER FUNCTION public.cleanup_expired_drafts()     SET search_path = public;
ALTER FUNCTION public.get_masked_email(uuid)       SET search_path = public;
-- NOT market_events_between: pinning it stopped the SQL function from being
-- inlined (~4ms -> ~62ms). It is SECURITY INVOKER and fully schema-qualified,
-- so that single advisor warning is accepted.
ALTER FUNCTION public.market_events_between(text[], date, date) RESET search_path;

-- no anonymous EXECUTE on SECURITY DEFINER functions (advisor 0028)
REVOKE ALL ON FUNCTION public.approve_custom_event(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_custom_event(bigint)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_custom_event(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_custom_event(bigint)  TO authenticated, service_role;

-- cleanup is run by pg_cron (postgres) only
REVOKE ALL ON FUNCTION public.cleanup_expired_drafts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_drafts() TO service_role;

-- admin policies apply to signed-in users only, so anon never evaluates is_admin()
ALTER POLICY "admin_update_event" ON public.market_events TO authenticated;
ALTER POLICY "admin_delete_event" ON public.market_events TO authenticated;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- Remaining advisor warnings, intentional:
--  * "authenticated can execute SECURITY DEFINER" for admin_pending_drafts,
--    approve/reject/delete_custom_event, is_admin, get_masked_email -- each
--    checks is_admin() (or only returns a masked email) inside.
--  * market_events_between mutable search_path (see above).
--  * Auth leaked-password protection (pre-existing, dashboard setting).
