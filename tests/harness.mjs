// Boots the Functions locally: wrangler pages dev on the fixture site, with a
// local D1 (schema from migrations/) and the mock Stripe/Resend server.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServices } from "./mock-services.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The local wrangler binary directly (not npx): npx puts a shell between us
// and the dev server, and killing the shell on Linux leaves workerd running,
// which keeps the test process alive until the runner times out.
const WRANGLER = process.env.WRANGLER_BIN || path.join(ROOT, "node_modules", ".bin", "wrangler");
const WRANGLER_ARGS = [];
// Pages does not accept --config, so the root wrangler.toml is used as-is:
// its bindings are simulated locally and --persist-to isolates each run.
const DB_NAME = "atelier-sauvage-shop-preview";

export const TEST_ENV = {
  STRIPE_SECRET_KEY: "sk_test_mock",
  STRIPE_WEBHOOK_SECRET: "whsec_test_mock_secret",
  RESEND_API_KEY: "re_test_mock",
  RECONCILE_TOKEN: "reconcile-token-for-tests-0123456789",
  SHOP_ENV: "test",
};

function wrangler(args, opts = {}) {
  const r = spawnSync(WRANGLER, [...WRANGLER_ARGS, ...args], { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000, ...opts });
  if (r.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

export async function startHarness({ port = 8790 + Math.floor(Math.random() * 100) } = {}) {
  const persist = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), "as-shop-test-"));
  const mock = await startMockServices();

  wrangler(["d1", "migrations", "apply", DB_NAME, "--local", "--persist-to", persist]);

  const bindings = Object.entries({ ...TEST_ENV, STRIPE_API_BASE: mock.base, RESEND_API_BASE: mock.base })
    .flatMap(([k, v]) => ["--binding", `${k}=${v}`]);
  const args = [...WRANGLER_ARGS, "pages", "dev", "tests/fixtures/site", "--persist-to", persist,
    "--port", String(port), "--ip", "127.0.0.1", "--log-level", "warn", ...bindings];
  // Own process group, so stop() can kill wrangler and every child it spawned.
  const proc = spawn(WRANGLER, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  proc.stdout.on("data", (d) => { log += d; });
  proc.stderr.on("data", (d) => { log += d; });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/index.html`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (proc.exitCode !== null) throw new Error(`wrangler pages dev exited early:\n${log}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  if (Date.now() >= deadline) { proc.kill("SIGTERM"); throw new Error(`wrangler pages dev did not start:\n${log}`); }

  const sql = (statement) => {
    const out = wrangler(["d1", "execute", DB_NAME, "--local", "--persist-to", persist, "--json", "--command", statement]);
    const parsed = JSON.parse(out.slice(out.indexOf("[")));
    return parsed[0].results;
  };

  const stop = async () => {
    const exited = new Promise((r) => proc.once("exit", r));
    try { process.kill(-proc.pid, "SIGTERM"); } catch { proc.kill("SIGTERM"); }
    const timer = setTimeout(() => { try { process.kill(-proc.pid, "SIGKILL"); } catch { /* gone */ } }, 5000);
    await exited;
    clearTimeout(timer);
    await mock.close();
    rmSync(persist, { recursive: true, force: true });
  };

  return { base, mock, sql, stop, log: () => log };
}
