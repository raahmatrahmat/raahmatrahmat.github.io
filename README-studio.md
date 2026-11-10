# Bubble Crush Studio staging

This branch adds a read-only web dashboard and a verified AdMob SSV points ledger. An AdMob view never creates cash or wallet credit. The application must keep rewards non-transferable and usable only inside the game.

## Current staging project

- Supabase project: bubblecrush-rewards-staging
- Project ref: gacapmzobubnnerdqtes
- Region: Singapore (ap-southeast-1)
- Current Supabase project creation cost: US$0/month. Gemini API usage, if enabled, may be billed separately by Google.
- Dashboard route after the site branch is published: https://raahmatrahmat.github.io/studio/
- SSV callback URL: https://gacapmzobubnnerdqtes.supabase.co/functions/v1/admob-ssv

The frontend contains only the Supabase URL and a publishable key. RLS is enabled on the ledger; never add Supabase secret/service-role keys or a Gemini API key to the public repo.

## Required account setup

1. In Supabase Auth, create or invite the account that will read its own points. Keep public sign-up disabled for the owner dashboard.
2. In Supabase Edge Function Secrets, set ADMOB_ALLOWED_AD_UNITS to the exact rewarded ad unit IDs, ADMOB_REWARD_ITEM to the internal non-cash item name, and ADMOB_REWARD_AMOUNT to the exact integer configured on those units. Do not use IDR, USD, cash, gift cards, or a withdrawable balance.
3. Set GEMINI_API_KEY and GEMINI_MODEL in Edge Function Secrets to use the read-only assistant.
4. Configure the AdMob SSV URL on the rewarded ad unit only after the game SDK sends the signed callback user_id as a valid Supabase Auth UUID. Events without a mapped account are acknowledged without points.
5. Test with the AdMob SSV test tool and test ads. Do not use live ads on your own devices for revenue testing.

The SSV handler acknowledges verified callbacks that fail configured reward/user checks without crediting them. Repeated transaction IDs are deduplicated in Postgres. Google public verification keys are refreshed at least once every 24 hours.

## Local checks

Run node --test tests/ssv.test.mjs for the signature and reward-validation tests.
Run npm ci, npm test, and npm run build for the full CI checks.

Gmail, Outlook, Binance, Canva, and third-party MCP servers are shown as disconnected until separate OAuth credentials and an explicit read-only tool allowlist are configured. No money-transfer tool is exposed to Gemini.

