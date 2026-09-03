-- Create one independent relationship row for each parent/guardian and student.
CREATE TABLE IF NOT EXISTS public.parent_student_links (
    id BIGSERIAL PRIMARY KEY,
    student_lrn BIGINT NOT NULL REFERENCES public.students(lrn) ON DELETE CASCADE,
    parent_psid TEXT NOT NULL,
    parent_guardian_name TEXT,
    parent_pin TEXT,
    notify_parent BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_lrn, parent_psid)
);

CREATE INDEX IF NOT EXISTS idx_parent_student_links_parent_psid
    ON public.parent_student_links(parent_psid);

CREATE INDEX IF NOT EXISTS idx_parent_student_links_student_lrn
    ON public.parent_student_links(student_lrn);

ALTER TABLE public.parent_student_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only parent student links" ON public.parent_student_links;
CREATE POLICY "Service role only parent student links"
    ON public.parent_student_links
    USING (false)
    WITH CHECK (false);

-- Migrate existing comma-separated Messenger IDs without creating duplicates.
INSERT INTO public.parent_student_links (student_lrn, parent_psid, parent_guardian_name, parent_pin, notify_parent)
SELECT
    s.lrn,
    trim(linked_psid),
    s.parent_guardian_name,
    s.parent_pin,
    COALESCE(s.notify_parent, false)
FROM public.students AS s
CROSS JOIN LATERAL unnest(string_to_array(COALESCE(s.parent_messenger_id, ''), ',')) AS linked_psid
WHERE trim(linked_psid) <> ''
ON CONFLICT (student_lrn, parent_psid) DO NOTHING;
