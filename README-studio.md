# Bubble Crush Studio staging

This branch adds a read-only web dashboard and a verified AdMob SSV ledger with separate balances for non-transferable game items. Rewards may be points, coins, gems, diamonds, pearls, game gold, lives, energy, boosters, skins, or cosmetics; they must only be used inside Bubble Crush.

AdMob rewards must never be IDR, USD, GBP, cash, crypto/Bitcoin, gift cards, airtime/pulsa, mobile-data packages, or any other real-world payment or redeemable item. In-game balances must not be transferable, tradable, or convertible to money or real-world goods. Publisher AdMob earnings are tracked separately from player rewards and paid to the publisher under their AdMob payment profile.

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
2. In Supabase Edge Function Secrets, set ADMOB_REWARD_CONFIG_JSON to a JSON object mapping each exact rewarded ad unit ID to its exact configured in-game item and integer amount. Example: `{"ca-app-pub-.../YOUR_UNIT_ID":{"item":"gems","amount":5}}`. Only the allowlisted, non-transferable in-game item names above are accepted. Do not configure fiat, cash, crypto, gift cards, transferable goods, airtime, or data packages.
3. Set GEMINI_API_KEY and GEMINI_MODEL in Edge Function Secrets to use the read-only assistant.
4. Configure the AdMob SSV URL on the rewarded ad unit only after the game SDK sends the signed callback user_id as a valid Supabase Auth UUID. Events without a mapped account are acknowledged without points.
5. Test with the AdMob SSV test tool and test ads. Do not use live ads on your own devices for revenue testing.

The SSV handler acknowledges verified callbacks that fail configured reward/user checks without crediting them. Repeated transaction IDs are deduplicated in Postgres. The ledger reports a separate balance for each item so points, gems, and lives are never added into one misleading total. Google public verification keys are refreshed at least once every 24 hours.

## Local checks

Run node --test tests/ssv.test.mjs for the signature and reward-validation tests.
Run npm ci, npm test, and npm run build for the full CI checks.

Gmail, Outlook, Binance, Canva, and third-party MCP servers are shown as disconnected until separate OAuth credentials and an explicit read-only tool allowlist are configured. No money-transfer tool is exposed to Gemini.

