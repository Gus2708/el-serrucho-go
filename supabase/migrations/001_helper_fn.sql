-- Migration 001: safe_numeric helper function
-- Run this first — all views depend on it

CREATE OR REPLACE FUNCTION safe_numeric(v text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CAST(
    REPLACE(REPLACE(REPLACE(REPLACE(v, ',', '.'), ' ', ''), 'Bs.', ''), 'bs.', '')
    AS numeric
  );
EXCEPTION WHEN OTHERS THEN
  RETURN 0;
END;
$$;
