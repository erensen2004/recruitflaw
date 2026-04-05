import { pool } from "@workspace/db";
import { seedIfEmpty } from "./seed.js";

let appReadyPromise: Promise<void> | null = null;

let supportTablesReady: Promise<void> | null = null;

async function ensureSupportTables() {
  supportTablesReady ??= (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.review_threads (
          id serial PRIMARY KEY,
          scope_type text NOT NULL,
          scope_id integer NOT NULL,
          visibility text NOT NULL DEFAULT 'shared',
          status text NOT NULL DEFAULT 'open',
          created_by_user_id integer NOT NULL REFERENCES users(id),
          created_by_name text NOT NULL,
          created_by_role text NOT NULL,
          created_by_company_id integer REFERENCES companies(id),
          last_message_at timestamptz NOT NULL DEFAULT now(),
          resolved_at timestamptz,
          resolved_by_user_id integer REFERENCES users(id),
          resolved_by_name text,
          resolved_by_role text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.review_thread_messages (
          id serial PRIMARY KEY,
          thread_id integer NOT NULL REFERENCES public.review_threads(id) ON DELETE CASCADE,
          author_user_id integer NOT NULL REFERENCES users(id),
          author_name text NOT NULL,
          author_role text NOT NULL,
          author_company_id integer REFERENCES companies(id),
          message text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      await pool.query(`
        ALTER TABLE public.review_threads
        ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open'
      `);

      await pool.query(`
        ALTER TABLE public.review_threads
        ADD COLUMN IF NOT EXISTS resolved_at timestamptz
      `);

      await pool.query(`
        ALTER TABLE public.review_threads
        ADD COLUMN IF NOT EXISTS resolved_by_user_id integer REFERENCES users(id)
      `);

      await pool.query(`
        ALTER TABLE public.review_threads
        ADD COLUMN IF NOT EXISTS resolved_by_name text
      `);

      await pool.query(`
        ALTER TABLE public.review_threads
        ADD COLUMN IF NOT EXISTS resolved_by_role text
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS review_threads_scope_idx
        ON public.review_threads (scope_type, scope_id, last_message_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS review_threads_status_idx
        ON public.review_threads (status, last_message_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS review_thread_messages_thread_idx
        ON public.review_thread_messages (thread_id, created_at ASC)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.password_setup_tokens (
          id serial PRIMARY KEY,
          user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
          token_hash text NOT NULL UNIQUE,
          purpose text NOT NULL DEFAULT 'invite',
          expires_at timestamptz NOT NULL,
          used_at timestamptz,
          created_by_user_id integer REFERENCES public.users(id),
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS password_setup_tokens_user_idx
        ON public.password_setup_tokens (user_id, purpose, created_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS password_setup_tokens_active_idx
        ON public.password_setup_tokens (token_hash, expires_at)
      `);

      await pool.query(`
        ALTER TABLE public.users
        ADD COLUMN IF NOT EXISTS admin_managed boolean NOT NULL DEFAULT false
      `);

      await pool.query(`
        ALTER TABLE public.candidates
        ADD COLUMN IF NOT EXISTS executive_headline text
      `);

      await pool.query(`
        ALTER TABLE public.candidates
        ADD COLUMN IF NOT EXISTS professional_snapshot text
      `);

      await pool.query(`
        ALTER TABLE public.candidates
        ADD COLUMN IF NOT EXISTS domain_focus jsonb
      `);

      await pool.query(`
        ALTER TABLE public.candidates
        ADD COLUMN IF NOT EXISTS seniority_signal text
      `);

      await pool.query(`
        ALTER TABLE public.candidates
        ADD COLUMN IF NOT EXISTS candidate_strengths jsonb
      `);

      await pool.query(`
        ALTER TABLE public.candidates
        ADD COLUMN IF NOT EXISTS candidate_risks jsonb
      `);

      await pool.query(`
        ALTER TABLE public.candidates
        ADD COLUMN IF NOT EXISTS notable_achievements jsonb
      `);

      await pool.query(`
        ALTER TABLE public.candidates
        ADD COLUMN IF NOT EXISTS inferred_work_model text
      `);

      await pool.query(`
        ALTER TABLE public.candidates
        ADD COLUMN IF NOT EXISTS location_flexibility text
      `);

      await pool.query(`
        ALTER TABLE public.candidates
        ADD COLUMN IF NOT EXISTS salary_signal text
      `);

      await pool.query(`
        ALTER TABLE public.candidates
        ADD COLUMN IF NOT EXISTS language_items jsonb
      `);

      await pool.query(`
        ALTER TABLE public.candidates
        ADD COLUMN IF NOT EXISTS field_confidence jsonb
      `);

      await pool.query(`
        ALTER TABLE public.candidates
        ADD COLUMN IF NOT EXISTS evidence jsonb
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.interview_processes (
          id serial PRIMARY KEY,
          candidate_id integer NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
          role_id integer NOT NULL REFERENCES public.job_roles(id) ON DELETE CASCADE,
          client_company_id integer NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
          vendor_company_id integer NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
          status text NOT NULL DEFAULT 'open',
          opened_at timestamptz NOT NULL DEFAULT now(),
          closed_at timestamptz,
          closed_reason text,
          created_by_user_id integer NOT NULL REFERENCES public.users(id),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.interview_meetings (
          id serial PRIMARY KEY,
          process_id integer NOT NULL REFERENCES public.interview_processes(id) ON DELETE CASCADE,
          status text NOT NULL DEFAULT 'negotiating',
          meeting_index integer NOT NULL,
          title text,
          scheduled_date text,
          scheduled_start_time text,
          scheduled_end_time text,
          timezone text,
          created_by_user_id integer NOT NULL REFERENCES public.users(id),
          confirmed_proposal_id integer,
          completed_at timestamptz,
          cancelled_at timestamptz,
          cancel_reason text,
          summary_note text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.interview_proposals (
          id serial PRIMARY KEY,
          meeting_id integer NOT NULL REFERENCES public.interview_meetings(id) ON DELETE CASCADE,
          proposed_by_role text NOT NULL,
          proposed_by_user_id integer NOT NULL REFERENCES public.users(id),
          proposal_type text NOT NULL,
          proposed_date text NOT NULL,
          start_time text,
          end_time text,
          window_label text,
          timezone text NOT NULL,
          duration_minutes integer NOT NULL,
          note text,
          response_status text NOT NULL DEFAULT 'pending',
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.interview_activity (
          id serial PRIMARY KEY,
          process_id integer NOT NULL REFERENCES public.interview_processes(id) ON DELETE CASCADE,
          meeting_id integer REFERENCES public.interview_meetings(id) ON DELETE CASCADE,
          actor_user_id integer REFERENCES public.users(id),
          actor_role text NOT NULL,
          event_type text NOT NULL,
          payload jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      await pool.query(`
        ALTER TABLE public.interview_meetings
        ADD COLUMN IF NOT EXISTS title text
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS interview_processes_candidate_idx
        ON public.interview_processes (candidate_id, opened_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS interview_processes_open_idx
        ON public.interview_processes (status, candidate_id, updated_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS interview_meetings_process_idx
        ON public.interview_meetings (process_id, meeting_index DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS interview_meetings_status_idx
        ON public.interview_meetings (status, updated_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS interview_proposals_meeting_idx
        ON public.interview_proposals (meeting_id, created_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS interview_proposals_pending_idx
        ON public.interview_proposals (response_status, created_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS interview_activity_process_idx
        ON public.interview_activity (process_id, created_at ASC)
      `);

    } catch (error) {
      console.warn("[runtime] support table bootstrap skipped", error);
    }
  })();

  await supportTablesReady;
}

export async function ensureAppReady(): Promise<void> {
  appReadyPromise ??= (async () => {
    await ensureSupportTables();
    await seedIfEmpty();
  })();
  await appReadyPromise;
}
