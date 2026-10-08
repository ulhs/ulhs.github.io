ALTER TABLE public.attendance_logs
    ADD COLUMN IF NOT EXISTS duplicate_reviewed_at timestamptz,
    ADD COLUMN IF NOT EXISTS duplicate_reviewed_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_attendance_logs_duplicate_review
    ON public.attendance_logs (local_date, session, duplicate_reviewed_at)
    WHERE duplicate_of_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mark_attendance_duplicate_reviewed(p_log_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role IN ('admin', 'school_head')
    ) THEN
        RAISE EXCEPTION 'Administrator or School Head permission is required.';
    END IF;

    UPDATE public.attendance_logs
       SET duplicate_reviewed_at = COALESCE(duplicate_reviewed_at, now()),
           duplicate_reviewed_by = COALESCE(duplicate_reviewed_by, auth.uid())
     WHERE id = p_log_id
       AND duplicate_of_id IS NOT NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attendance log is not a marked duplicate.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_attendance_duplicate_reviewed(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_attendance_duplicate_reviewed(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_attendance_duplicate(
    p_duplicate_id bigint,
    p_canonical_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    duplicate_log public.attendance_logs%ROWTYPE;
    canonical_log public.attendance_logs%ROWTYPE;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role IN ('admin', 'school_head')
    ) THEN
        RAISE EXCEPTION 'Administrator or School Head permission is required.';
    END IF;

    IF p_duplicate_id = p_canonical_id THEN
        RAISE EXCEPTION 'A record cannot be a duplicate of itself.';
    END IF;

    SELECT * INTO duplicate_log
      FROM public.attendance_logs
     WHERE id = p_duplicate_id
     FOR UPDATE;
    SELECT * INTO canonical_log
      FROM public.attendance_logs
     WHERE id = p_canonical_id
     FOR UPDATE;

    IF duplicate_log.id IS NULL OR canonical_log.id IS NULL THEN
        RAISE EXCEPTION 'Both attendance records must exist.';
    END IF;

    IF upper(duplicate_log.session) NOT IN ('AM', 'PM')
       OR upper(duplicate_log.session) IS DISTINCT FROM upper(canonical_log.session)
       OR duplicate_log.student_lrn IS DISTINCT FROM canonical_log.student_lrn
       OR COALESCE(duplicate_log.local_date, (duplicate_log.scanned_at AT TIME ZONE 'Asia/Manila')::date)
          IS DISTINCT FROM
          COALESCE(canonical_log.local_date, (canonical_log.scanned_at AT TIME ZONE 'Asia/Manila')::date) THEN
        RAISE EXCEPTION 'Duplicate and canonical records must belong to the same student, date, and AM/PM session.';
    END IF;

    IF canonical_log.duplicate_of_id IS NOT NULL THEN
        RAISE EXCEPTION 'The canonical record is already marked as a duplicate.';
    END IF;

    IF duplicate_log.duplicate_of_id IS NOT NULL
       AND duplicate_log.duplicate_of_id IS DISTINCT FROM p_canonical_id THEN
        RAISE EXCEPTION 'This record is already linked to a different canonical record.';
    END IF;

    UPDATE public.attendance_logs
       SET duplicate_of_id = p_canonical_id
     WHERE id = p_duplicate_id
       AND duplicate_of_id IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_attendance_duplicate(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_attendance_duplicate(bigint, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_attendance_duplicate_candidates(
    p_from_date date DEFAULT NULL,
    p_to_date date DEFAULT NULL,
    p_session text DEFAULT NULL,
    p_unreviewed_only boolean DEFAULT true,
    p_limit integer DEFAULT 200,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    duplicate_id bigint,
    student_lrn text,
    attendance_date date,
    session text,
    duplicate_status text,
    duplicate_scanned_at timestamptz,
    duplicate_scanned_at_local timestamp without time zone,
    duplicate_of_id bigint,
    duplicate_reviewed_at timestamptz,
    canonical_id bigint,
    canonical_status text,
    canonical_scanned_at timestamptz,
    canonical_scanned_at_local timestamp without time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role IN ('admin', 'school_head')
    ) THEN
        RAISE EXCEPTION 'Administrator or School Head permission is required.';
    END IF;

    IF p_session IS NOT NULL AND upper(p_session) NOT IN ('AM', 'PM') THEN
        RAISE EXCEPTION 'Session filter must be AM, PM, or null.';
    END IF;
    IF p_from_date IS NOT NULL AND p_to_date IS NOT NULL AND p_from_date > p_to_date THEN
        RAISE EXCEPTION 'Start date must be on or before end date.';
    END IF;
    IF p_limit < 1 OR p_limit > 500 OR p_offset < 0 THEN
        RAISE EXCEPTION 'Page limit must be between 1 and 500 and offset cannot be negative.';
    END IF;

    RETURN QUERY
    WITH ranked AS (
        SELECT al.*,
               COALESCE(al.local_date, (al.scanned_at AT TIME ZONE 'Asia/Manila')::date) AS attendance_date,
               first_value(al.id) OVER (
                   PARTITION BY al.student_lrn, upper(al.session),
                       COALESCE(al.local_date, (al.scanned_at AT TIME ZONE 'Asia/Manila')::date)
                   ORDER BY al.scanned_at NULLS LAST, al.id
               ) AS first_id,
               row_number() OVER (
                   PARTITION BY al.student_lrn, upper(al.session),
                       COALESCE(al.local_date, (al.scanned_at AT TIME ZONE 'Asia/Manila')::date)
                   ORDER BY al.scanned_at NULLS LAST, al.id
               ) AS row_number
          FROM public.attendance_logs al
         WHERE upper(al.session) IN ('AM', 'PM')
           AND COALESCE(al.local_date, (al.scanned_at AT TIME ZONE 'Asia/Manila')::date) IS NOT NULL
           AND (p_session IS NULL OR upper(al.session) = upper(p_session))
    ),
    candidates AS (
        SELECT ranked.*,
               COALESCE(ranked.duplicate_of_id, ranked.first_id) AS selected_canonical_id
          FROM ranked
         WHERE ranked.duplicate_of_id IS NOT NULL
            OR ranked.row_number > 1
    )
    SELECT candidate.id,
           candidate.student_lrn::text,
           candidate.attendance_date,
           candidate.session::text,
           candidate.status::text,
           candidate.scanned_at,
           candidate.scanned_at_local,
           candidate.duplicate_of_id,
           candidate.duplicate_reviewed_at,
           canonical.id,
           canonical.status::text,
           canonical.scanned_at,
           canonical.scanned_at_local
      FROM candidates candidate
      JOIN public.attendance_logs canonical
        ON canonical.id = candidate.selected_canonical_id
     WHERE candidate.id <> canonical.id
       AND (p_from_date IS NULL OR candidate.attendance_date >= p_from_date)
       AND (p_to_date IS NULL OR candidate.attendance_date <= p_to_date)
       AND (NOT p_unreviewed_only OR candidate.duplicate_reviewed_at IS NULL)
     ORDER BY candidate.attendance_date DESC,
              upper(candidate.session),
              candidate.student_lrn,
              candidate.scanned_at NULLS LAST,
              candidate.id
     LIMIT p_limit
    OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_duplicate_candidates(date, date, text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_duplicate_candidates(date, date, text, boolean, integer, integer) TO authenticated;
