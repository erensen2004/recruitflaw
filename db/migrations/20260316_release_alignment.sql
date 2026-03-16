ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS original_cv_file_name text,
  ADD COLUMN IF NOT EXISTS original_cv_mime_type text,
  ADD COLUMN IF NOT EXISTS standardized_cv_url text,
  ADD COLUMN IF NOT EXISTS parse_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS parse_confidence integer,
  ADD COLUMN IF NOT EXISTS parse_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parse_provider text,
  ADD COLUMN IF NOT EXISTS current_title text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS years_experience integer,
  ADD COLUMN IF NOT EXISTS education text,
  ADD COLUMN IF NOT EXISTS languages text,
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS standardized_profile text,
  ADD COLUMN IF NOT EXISTS parsed_skills jsonb,
  ADD COLUMN IF NOT EXISTS parsed_experience jsonb,
  ADD COLUMN IF NOT EXISTS parsed_education jsonb;

UPDATE public.candidates
SET
  parse_status = COALESCE(parse_status, 'not_started'),
  parse_review_required = COALESCE(parse_review_required, false)
WHERE parse_status IS NULL
   OR parse_review_required IS NULL;

CREATE TABLE IF NOT EXISTS public.candidate_status_history (
  id serial PRIMARY KEY,
  candidate_id integer NOT NULL REFERENCES public.candidates(id),
  previous_status text,
  next_status text NOT NULL,
  reason text,
  changed_by_user_id integer NOT NULL REFERENCES public.users(id),
  changed_by_name text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS candidate_status_history_candidate_id_idx
  ON public.candidate_status_history(candidate_id);

CREATE INDEX IF NOT EXISTS candidate_status_history_created_at_idx
  ON public.candidate_status_history(created_at DESC);

UPDATE public.job_roles
SET employment_type = CASE employment_type
  WHEN 'full_time' THEN 'full-time'
  WHEN 'part_time' THEN 'part-time'
  ELSE employment_type
END
WHERE employment_type IN ('full_time', 'part_time');
