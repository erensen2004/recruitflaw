CREATE TABLE IF NOT EXISTS public.review_threads (
  id serial PRIMARY KEY,
  scope_type text NOT NULL,
  scope_id integer NOT NULL,
  visibility text NOT NULL DEFAULT 'shared',
  status text NOT NULL DEFAULT 'open',
  created_by_user_id integer NOT NULL REFERENCES public.users(id),
  created_by_name text NOT NULL,
  created_by_role text NOT NULL,
  created_by_company_id integer REFERENCES public.companies(id),
  last_message_at timestamp NOT NULL DEFAULT now(),
  resolved_at timestamp NULL,
  resolved_by_user_id integer REFERENCES public.users(id),
  resolved_by_name text NULL,
  resolved_by_role text NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS review_threads_scope_visibility_unique
  ON public.review_threads(scope_type, scope_id, visibility);

CREATE INDEX IF NOT EXISTS review_threads_scope_lookup_idx
  ON public.review_threads(scope_type, scope_id);

CREATE INDEX IF NOT EXISTS review_threads_last_message_at_idx
  ON public.review_threads(last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.review_thread_messages (
  id serial PRIMARY KEY,
  thread_id integer NOT NULL REFERENCES public.review_threads(id) ON DELETE CASCADE,
  author_user_id integer NOT NULL REFERENCES public.users(id),
  author_name text NOT NULL,
  author_role text NOT NULL,
  author_company_id integer REFERENCES public.companies(id),
  message text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_thread_messages_thread_id_created_at_idx
  ON public.review_thread_messages(thread_id, created_at DESC);
