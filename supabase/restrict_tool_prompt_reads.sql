-- Protect builder prompts from public Supabase reads.
-- Run once in Supabase SQL Editor after applying add_publish_columns_tools.sql.
--
-- Marketplace listings use public metadata only. Hosted runs read system_prompt
-- with the service role after enforcing payment; free downloads use this view.

create or replace view public.free_tool_prompts
with (security_barrier = true)
as
select id, system_prompt
from public.tools
where is_published = true
  and coalesce(price, 0) <= 0;

grant select on public.free_tool_prompts to anon, authenticated;

do $$
declare
  public_tool_columns text;
begin
  revoke select on public.tools from anon, authenticated;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into public_tool_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'tools'
    and column_name <> 'system_prompt';

  if public_tool_columns is null then
    raise exception 'public.tools has no readable columns to grant';
  end if;

  execute format(
    'grant select (%s) on table public.tools to anon, authenticated',
    public_tool_columns
  );
end $$;
