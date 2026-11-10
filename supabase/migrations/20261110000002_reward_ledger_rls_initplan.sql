alter policy "Users can read their own game reward ledger"
  on public.reward_ledger
  using ((select auth.uid()) = user_id);

