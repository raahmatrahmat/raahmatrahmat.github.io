alter table public.reward_ledger rename column points to amount;
alter table public.reward_ledger
  rename constraint reward_ledger_points_check to reward_ledger_amount_check;

alter table public.reward_ledger
  drop constraint reward_ledger_reward_item_check;

alter table public.reward_ledger
  add constraint reward_ledger_reward_item_check
  check (lower(reward_item) in (
    'points', 'game_points', 'coins', 'gems', 'diamonds', 'pearls', 'game_gold',
    'lives', 'energy', 'boosters', 'skins', 'cosmetics'
  ));

drop function public.get_my_reward_balance();

create function public.get_my_reward_balance()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(reward_item, balance), '{}'::jsonb)
  from (
    select reward_item, sum(amount)::bigint as balance
    from public.reward_ledger
    where user_id = (select auth.uid())
    group by reward_item
  ) as per_item;
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
  if p_reward_item is null or lower(p_reward_item) not in (
    'points', 'game_points', 'coins', 'gems', 'diamonds', 'pearls', 'game_gold',
    'lives', 'energy', 'boosters', 'skins', 'cosmetics'
  ) then
    raise exception 'Only approved non-transferable in-game rewards are accepted';
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
    amount,
    reward_item,
    ad_unit,
    event_timestamp_ms
  )
  values (
    p_transaction_id,
    p_user_id,
    p_reward_amount,
    lower(p_reward_item),
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

