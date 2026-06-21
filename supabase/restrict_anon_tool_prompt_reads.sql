-- Prevent anonymous marketplace visitors from reading private tool prompts.
-- Run once in Supabase SQL Editor after deploying marketplace.html's explicit
-- public column query. Authenticated owner access is left unchanged.

revoke select on table public.tools from anon;

grant select (
  id,
  name,
  description,
  category,
  type,
  icon,
  tags,
  input_schema,
  input_placeholder,
  listing_extras,
  price,
  runs,
  rating,
  trending,
  created_at,
  creator_id,
  is_published
) on table public.tools to anon;

comment on column public.tools.system_prompt is
  'Private tool prompt. Do not grant anonymous SELECT; paid/free execution should go through server-side APIs.';
