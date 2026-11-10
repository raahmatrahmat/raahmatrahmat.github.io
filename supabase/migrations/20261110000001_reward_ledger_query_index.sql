create index if not exists reward_ledger_user_created_at_idx
  on public.reward_ledger (user_id, created_at desc);

