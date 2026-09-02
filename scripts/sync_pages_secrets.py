"""
Push Function secrets from GitHub secrets to a Cloudflare Pages environment.

Runs in deploy.yml before the publish step. Reads <PREFIX>_<NAME> from the
environment, where PREFIX is PREVIEW or PROD depending on TARGET_ENV, and
writes each non-empty value as an encrypted variable on that environment of
the Pages project. Names that are not set are left alone, so a missing key
is a shop that answers 503, never a broken deploy.

Uses the same Cloudflare Pages: Edit token as the publish step; nothing wider.
"""

import json
import os
import sys
import urllib.error
import urllib.request

NAMES = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY", "RECONCILE_TOKEN"]


def api(method, url, token, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as err:
        body = err.read().decode(errors="replace")[:500]
        raise SystemExit(f"::error::Pages API {method} failed: {err.code} {body}")


def main():
    token = os.environ["CF_API_TOKEN"]
    account = os.environ["CF_ACCOUNT_ID"]
    project = os.environ["CF_PROJECT"]
    target = os.environ.get("TARGET_ENV", "preview")
    prefix = "PROD" if target == "production" else "PREVIEW"

    values = {name: os.environ.get(f"{prefix}_{name}", "") for name in NAMES}
    present = {k: v for k, v in values.items() if v}
    missing = [k for k, v in values.items() if not v]
    print(f"target environment: {target}")
    print(f"secrets to write  : {', '.join(present) or '(none)'}")
    if missing:
        print(f"not set in GitHub : {', '.join(missing)} -- the Functions will answer 503 for those features")
    if not present:
        return 0

    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects/{project}"
    payload = {"deployment_configs": {target: {"env_vars": {
        name: {"type": "secret_text", "value": value} for name, value in present.items()
    }}}}
    result = api("PATCH", url, token, payload)
    if not result.get("success"):
        raise SystemExit(f"::error::Pages API reported failure: {json.dumps(result.get('errors'))[:500]}")

    # Read back the names (values are never returned) to prove they landed.
    project_data = api("GET", url, token)["result"]
    env_vars = ((project_data.get("deployment_configs") or {}).get(target) or {}).get("env_vars") or {}
    landed = sorted(env_vars)
    print(f"variables now on {target}: {', '.join(landed) or '(none)'}")
    lost = [name for name in present if name not in env_vars]
    if lost:
        raise SystemExit(f"::error::Secrets were not applied: {', '.join(lost)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
