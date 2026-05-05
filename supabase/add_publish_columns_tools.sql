-- Richer publish / marketplace listings: optional tags, multi-field Run UI, sample output.
-- Run once in Supabase → SQL Editor. Safe to re-run (IF NOT EXISTS).

alter table public.tools add column if not exists tags text[] default '{}'::text[];
alter table public.tools add column if not exists input_schema jsonb;
alter table public.tools add column if not exists sample_output text;

comment on column public.tools.tags is 'Short discoverability tags from the publish form.';
comment on column public.tools.input_schema is 'JSON array of {id,label,type,placeholder} for Run modal fields.';
comment on column public.tools.sample_output is 'Optional example output for the listing.';
