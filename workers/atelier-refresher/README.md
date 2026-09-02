# atelier-refresher

Keeps the homepage Instagram feed alive.

Instagram long-lived access tokens expire after about 60 days. This Worker runs
weekly, asks Instagram to refresh the token, and writes the new one back into
the `ATELIER_STORE` KV namespace. `functions/instagram.js` then reads that token
at request time to fetch the shop's latest post.

    Monday 10:00 UTC  ->  atelier-refresher  ->  ATELIER_STORE KV
                                                       |
                              functions/instagram.js  <-+

## Why this directory exists

The Worker was deployed by hand in December 2025 and lived only in the
Cloudflare dashboard for nine months — not in this repo, the README, or any
notes. That made it invisible infrastructure: if it stopped running, the stored
token would quietly expire, the homepage Instagram block would break, and
nothing in git, GitHub Actions or `scripts/.last_run.json` would show a
problem. The same silent-failure shape as the Pages Git integration
disconnecting in July 2026.

The code here is a faithful copy of what is deployed, so the repo now records
what actually runs.

## It is deliberately not deployed by CI

`.github/workflows/deploy.yml` publishes the *site* and nothing else. Its
Cloudflare token carries only `Cloudflare Pages: Edit`, so it cannot touch
Workers even by accident.

Deploying this Worker needs a token with `Workers Scripts: Edit` and
`Workers KV Storage: Edit`. Mint one for the occasion and revoke it afterwards
rather than keeping a standing Workers-scoped credential around:

    npx wrangler deploy        # from this directory

Check `wrangler.toml` first: `compatibility_date` is pinned to the Worker's
original deployment date so that bringing it into the repo did not change its
runtime semantics.

## If the homepage Instagram block breaks

Check this Worker before anything in the repo.

1. Is a recent post showing on the homepage? That is the quickest end-to-end test.
2. Cloudflare dashboard -> Workers -> `atelier-refresher` -> Logs. The script
   logs both success and the Instagram error payload on failure.
3. Is the cron trigger (`0 10 * * 1`) still attached?

A single failed run is harmless: weekly refreshes against a ~60-day token life
means roughly eight consecutive failures before the token actually dies.

There is no alerting on failure. The `console.error` calls go to Workers logs
that nobody reads, so a broken refresh is only noticed once the feed goes dark.
Worth fixing if the Instagram block ever matters more than it does today.

## Known uncertainty

`functions/instagram.js` notes that it uses "Basic Display API supported fields
only", and this Worker calls the `ig_refresh_token` endpoint. Meta has been
deprecating Instagram Basic Display. It works today, but if the feed breaks for
no obvious reason, check whether the API itself has been retired before
debugging the code.
