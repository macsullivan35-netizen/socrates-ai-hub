-- Run in Supabase SQL Editor once. Enables Stripe Connect payout fields on profiles.

alter table public.profiles add column if not exists stripe_account_id text;
alter table public.profiles add column if not exists stripe_charges_enabled boolean default false;

create index if not exists profiles_stripe_account_id_idx on public.profiles (stripe_account_id) where stripe_account_id is not null;

comment on column public.profiles.stripe_account_id is 'Stripe Connect Express account id (acct_...)';
comment on column public.profiles.stripe_charges_enabled is 'True when Stripe account can receive destination charges';
