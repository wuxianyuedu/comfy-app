// Auth flow smoke: register -> credentials login (CSRF) -> session verify.
// Run against a live `next start` server.
const BASE = process.env.BASE_URL || "http://localhost:3700";
const EMAIL = `smoke_${Date.now()}@comfy.app`;
const PASS = "Smoke@12345";

const log = (...a) => console.log("[auth-smoke]", ...a);

// Collect Set-Cookie headers robustly (Node 18.14+ undici).
function collectCookies(headers, jar) {
  const arr = headers.getSetCookie ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  for (const c of arr) jar.push(c.split(";")[0]);
  return jar;
}
const jarStr = (jar) => jar.join("; ");

async function main() {
  // 1) Register
  let r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS, name: "Smoke User" }),
  });
  const reg = await r.json().catch(() => ({}));
  if (!r.ok || !reg.user) {
    console.error("REGISTER_FAIL", r.status, reg);
    process.exit(1);
  }
  log("register ok", reg.user.email, "id=", reg.user.id);

  // 2) CSRF token
  const jar = [];
  r = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: jarStr(jar) } });
  const csrf = await r.json();
  collectCookies(r.headers, jar);
  log("csrf token len", csrf.csrfToken?.length);

  // 3) Credentials login
  r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jarStr(jar) },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email: EMAIL,
      password: PASS,
      callbackUrl: `${BASE}/workspace`,
    }).toString(),
  });
  log("login status", r.status, "location", r.headers.get("location"));
  const loginCookies = [];
  collectCookies(r.headers, loginCookies);
  const sessionCookie = loginCookies.find((c) => c.startsWith("authjs.session-token"));
  if (!sessionCookie) {
    console.error("LOGIN_FAIL: no session cookie. set-cookie:", r.headers.get("set-cookie"));
    process.exit(1);
  }
  log("session cookie issued:", true);

  // 4) Verify session
  r = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: sessionCookie } });
  const sess = await r.json();
  if (!sess?.user?.email || sess.user.email !== EMAIL) {
    console.error("SESSION_FAIL", sess);
    process.exit(1);
  }
  log("session ok, user=", sess.user.email, "id=", sess.user.id);

  // 5) Wrong password rejected
  const r2 = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jarStr(jar) },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email: EMAIL,
      password: "wrong-password",
      callbackUrl: `${BASE}/workspace`,
    }).toString(),
  });
  const wrongCookies = [];
  collectCookies(r2.headers, wrongCookies);
  if (wrongCookies.some((c) => c.startsWith("authjs.session-token"))) {
    console.error("SECURITY_FAIL: wrong password still issued session");
    process.exit(1);
  }
  log("wrong-password correctly rejected (no session)");

  // 6) /login page renders with the auth form
  r = await fetch(`${BASE}/login`);
  const html = await r.text();
  if (!r.ok || !html.includes("登录") || !html.includes("创建账号") || !html.includes("邮箱")) {
    console.error("LOGIN_PAGE_FAIL", r.status);
    process.exit(1);
  }
  log("/login page renders with 登录/创建账号/邮箱");

  // 7) landing page renders
  r = await fetch(`${BASE}/`);
  const land = await r.text();
  if (!r.ok || !land.includes("ComfyAPP")) {
    console.error("LANDING_FAIL", r.status);
    process.exit(1);
  }
  log("/ landing page renders");

  log("ALL_CHECKS_PASSED");
}

main().catch((e) => {
  console.error("SMOKE_ERROR", e);
  process.exit(1);
});
