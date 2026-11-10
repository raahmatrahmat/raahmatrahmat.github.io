create table if not exists public.reward_ledger (
  transaction_id text primary key
    check (transaction_id ~ '^[A-Fa-f0-9]{16,128}$'),
  user_id uuid not null references auth.users(id) on delete restrict,
  points integer not null check (points > 0),
  reward_item text not null
    check (reward_item ~* '^(coins?|points?|game[_ -]?points|lives?|energy|tokens?)$'),
  ad_unit text not null,
  event_timestamp_ms bigint not null check (event_timestamp_ms > 0),
  created_at timestamptz not null default now()
);

alter table public.reward_ledger enable row level security;

create policy "Users can read their own game reward ledger"
  on public.reward_ledger
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete, truncate, references, trigger
  on table public.reward_ledger
  from anon, authenticated;

grant select on table public.reward_ledger to authenticated;

create or replace function public.get_my_reward_balance()
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(points), 0)::bigint
  from public.reward_ledger
  where user_id = auth.uid();
$$;

revoke all on function public.get_my_reward_balance() from public, anon;
grant execute on function public.get_my_reward_balance() to authenticated;

create or replace function public.credit_admob_reward(
  p_transaction_id text,
  p_user_id uuid,
  p_ad_unit text,
  p_reward_amount integer,
  p_reward_item text,
  p_event_timestamp_ms bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  if p_reward_item !~* '^(coins?|points?|game[_ -]?points|lives?|energy|tokens?)$' then
    raise exception 'Only non-cash in-game rewards are accepted';
  end if;
  if p_reward_amount is null or p_reward_amount < 1 then
    raise exception 'Reward amount must be positive';
  end if;
  if p_event_timestamp_ms is null or p_event_timestamp_ms < 1 then
    raise exception 'Event timestamp must be positive';
  end if;

  insert into public.reward_ledger (
    transaction_id,
    user_id,
    points,
    reward_item,
    ad_unit,
    event_timestamp_ms
  )
  values (
    p_transaction_id,
    p_user_id,
    p_reward_amount,
    p_reward_item,
    p_ad_unit,
    p_event_timestamp_ms
  )
  on conflict (transaction_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

revoke all on function public.credit_admob_reward(text, uuid, text, integer, text, bigint)
  from public, anon, authenticated;
grant execute on function public.credit_admob_reward(text, uuid, text, integer, text, bigint)
  to service_role;

