/**
 * `scripts/ci-token-scopes.mjs` 的契约（ISSUE #2551）。
 *
 * 这一格是「**这一跑的 `CNB_TOKEN` 够得着哪些能力**」的执行者。它最危险的失效形态有两种，
 * 本文件各有一组用例对着：
 *
 *   ① **把「没量到」读成「够得着」**（没配 token / 网络断 / 响应不是信封 ⇒ 那是没有结论，
 *      不是授权面完整 —— 与 §13.6.4.1 那条「取不到 ≠ 测出来是好的」同一纪律）；
 *   ② **把令牌值打进日志**（硬规则 17：这一格打的是「哪些能力够得着」，一个字节的凭据都不打）。
 *
 * 另外三条边界各有对象：业务层「对象不存在」（`errcode 5` / `errcode 404`）不许读成缺权限；
 * 缺权限本身**不许**变成红；`--strict` **不许**进 `.cnb.yml`（第一跑在 PR 上红了 7.5s，
 * 而红的原因没有任何人能修）。
 *
 * 全部用例**不发网络请求**：取数口是注入的，夹具是平台真实的响应形状。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CODE,
  OIDC_PROBE,
  PROBES,
  classifyReply,
  formatReadout,
  main,
  probeAll,
} from "../scripts/ci-token-scopes.mjs";

const ROOT = path.resolve(__dirname, "..");
const CONFIG = path.join(ROOT, ".cnb.yml");

type FetchResult = {
  body: string;
  error?: string | null;
  ok: boolean;
  status: number;
};
type FetchFn = (
  ctx: { base: string; repo: string; token: string; },
  subPath: string,
  extra?: { body?: string; method?: string; },
) => Promise<FetchResult>;

/** 平台真实的响应原文（字段名与嵌套都照抄，别自己编形状）。 */
const ok = (payload: unknown = []): string => JSON.stringify(payload);
const denied = (scope: string): string =>
  JSON.stringify({
    errcode: 10023,
    errmsg: `The token's authorization scope does not match this request. Missing required scopes: ${scope}`,
  });
const notFound = (): string => JSON.stringify({ errcode: 404, errmsg: "not found" });

/** 按子路径分流；没点到的回 200。 */
function fakeFetch(mapping: Record<string, FetchResult>): FetchFn {
  return async (_ctx, subPath) =>
    mapping[subPath] ?? { ok: true, status: 200, body: ok(), error: null };
}
const reply = (body: string, status = 200): FetchResult => ({
  ok: status >= 200 && status < 300,
  status,
  body,
  error: null,
});

describe("classifyReply：三句话的判据顺序", () => {
  it("原话点名缺哪一枚 ⇒ denied，且把那一枚抄下来", () => {
    expect(classifyReply(denied("repo-manage:r"), reply(denied("repo-manage:r"), 403))).toEqual({
      state: "denied",
      scope: "repo-manage:r",
    });
  });

  it("2xx ⇒ granted", () => {
    expect(classifyReply(ok({ name: "master" }), reply(ok({}), 200))).toEqual({
      state: "granted",
      status: 200,
    });
  });

  it("业务层「对象不存在」⇒ granted（平台认了这次请求，只是那个对象没有）", () => {
    // 两种码都在现场出现过：`errcode 5` 是 Resource not found，`errcode 404` 是 not found。
    for (const body of [
      JSON.stringify({ errcode: 5, errmsg: "Resource not found." }),
      notFound(),
    ]) {
      const r = classifyReply(body, reply(body, 404));
      expect(r.state, body).toBe("granted");
    }
  });

  it("网络层起不来 / 空响应 / 不是信封 ⇒ unknown，不是 granted", () => {
    expect(classifyReply("", { status: -1, error: "TimeoutError" }).state).toBe("unknown");
    expect(classifyReply("", { status: 0 }).state).toBe("unknown");
    expect(classifyReply("<html>gateway</html>", reply("<html>", 502)).state).toBe("unknown");
  });

  it("「没量到」的四种成因各自念得出来（否则读数让人猜 —— 第四跑之前就是这样）", () => {
    expect(classifyReply("", { status: -1, error: "ENOTFOUND" }).why).toContain("起不来");
    expect(classifyReply("", { status: 0 }).why).toContain("没有响应正文");
    expect(classifyReply("<html>", { status: 502 }).why).toContain("既没有信封");
    expect(
      classifyReply(JSON.stringify({ errcode: 10023, errmsg: "scope mismatch" }), { status: 403 })
        .why,
    ).toContain("403");
  });
});

describe("probeAll：每一条探针都只读，且只用平台无条件注入的那两件", () => {
  it("表里没有一条写路径（这一格会在 PR / 每日 / 桌包三种触发口上跑）", () => {
    for (const probe of PROBES) {
      expect(probe.path.startsWith("/"), `${probe.path} 不该以 / 开头`).toBe(false);
      expect(probe.path).not.toMatch(/\s/);
      // 写动作在 REST 里是 POST/PUT/PATCH/DELETE —— 探针表不声明 method，一律 GET。
      expect(probe).not.toHaveProperty("method");
    }
  });

  it("每条路径都不带仓库前缀（前缀由 `main()` 按 CNB_REPO_SLUG 拼一次）", () => {
    for (const probe of PROBES) {
      expect(probe.path.startsWith("moon-read/")).toBe(false);
    }
  });

  it("OIDC 那一问默认不发；`oidc: true` 才进清单，且它是唯一带请求体的一条", async () => {
    const seen: Array<{ hasBody: boolean; path: string; }> = [];
    const fn: FetchFn = async (_ctx, subPath, extra) => {
      seen.push({ path: subPath, hasBody: Boolean(extra?.body) });
      return reply(ok(), 200);
    };
    const base = { repo: "a/b", base: "https://api.example", token: "t", fetchFact: fn };

    await probeAll(base);
    expect(seen.length).toBe(PROBES.length);
    expect(seen.some((s) => s.hasBody)).toBe(false);

    seen.length = 0;
    const withOidc = await probeAll({ ...base, oidc: true });
    expect(withOidc.length).toBe(PROBES.length + 1);
    expect(withOidc.at(-1)?.domain).toBe(OIDC_PROBE.domain);
    expect(seen.filter((s) => s.hasBody).length).toBe(1);
  });

  it("`--only` 只跑点名的族", async () => {
    const rows = await probeAll({
      repo: "a/b",
      base: "https://api.example",
      token: "t",
      fetchFact: fakeFetch({}),
      only: ["repo-issue"],
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.domain))).toEqual(new Set(["repo-issue"]));
  });
});

describe("formatReadout：三档措辞各自代表不同的事实", () => {
  const rowsOf = (mapping: Record<string, FetchResult> = {}) =>
    probeAll({
      repo: "a/b",
      base: "https://api.example",
      token: "t",
      fetchFact: fakeFetch(mapping),
    });

  it("缺权限读成「未获授权 · 平台点名缺 X」", async () => {
    const text = formatReadout(
      await rowsOf({
        "settings/cloud-native-build": reply(denied("repo-manage:r"), 403),
      }),
      { repo: "a/b", event: "pull_request", branch: "master" },
    ).join("\n");
    expect(text).toContain("未获授权 · 平台点名缺 repo-manage:r");
    expect(text).toContain("事件=pull_request");
    expect(text).toContain("红了不构成任何结论");
  });

  it("全部答得清 ⇒ 每一族念「获授权」，一条「缺 X」都不出现", async () => {
    const lines = formatReadout(await rowsOf(), {
      repo: "a/b",
      event: "push",
      branch: "master",
    });
    // 族那一行是「两空格 + 族名 + 空白 + 结论」；探针行是四空格，别混进来。
    const groupLines = lines.filter((l) => /^ {2}\S+\s{2,}/.test(l));
    expect(groupLines.length).toBeGreaterThan(4);
    for (const line of groupLines) {
      expect(line).toContain("获授权");
    }
    expect(lines.filter((l) => l.includes("→ 缺 ")).length).toBe(0);
  });

  it("一条明确答复都没有的那一族念「没量到」，不许念成「获授权」", async () => {
    const dead: FetchResult = { ok: false, status: -1, body: "", error: "ECONNREFUSED" };
    const rows = await probeAll({
      repo: "a/b",
      base: "https://api.example",
      token: "t",
      fetchFact: async () => dead,
    });
    const lines = formatReadout(rows, { repo: "a/b", event: "pull_request", branch: "master" });
    const groupLines = lines.filter((l) => /^ {2}\S+\s{2,}/.test(l));
    expect(groupLines.length).toBeGreaterThan(4);
    for (const line of groupLines) {
      expect(line, `「${line}」把「没量到」念成了别的结论`).toContain("没量到");
    }
  });
});

describe("whereItLives：读数落在日志里，还要读得出来在哪", () => {
  /* 这一族治的是 ISSUE #2551 的追问原话：「它是什么形状现在每天在日志里，在哪里，
   * 我没看到」。读数早就打出来了 —— 缺的是**指路**。所以判据是「每一档触发口都念出
   * 它自己那个格名」，而不是「念了一句什么」。 */
  const rows = [
    {
      domain: "repo-code",
      scope: "repo-code:r",
      why: "读分支列表",
      path: "git/branches",
      reply: { state: "granted" as const, status: 200 },
      ms: 10,
    },
  ];

  it("三档触发口各自念对格名", () => {
    const head = (event: string, label: string) =>
      formatReadout(rows, { repo: "a/b", event, branch: "master", label })[0];
    expect(head("pull_request", "质量门禁")).toContain("质量门禁 流水线");
    expect(head("pull_request", "质量门禁")).toContain("「令牌权限读数」");
    expect(head("crontab: 0 1 * * *", "每日生产构建")).toContain("「每日令牌权限读数」");
    expect(head("web_trigger_daily", "每日档（手动触发）")).toContain("「每日令牌权限读数」");
    expect(head("api_trigger_daily", "每日档（API 触发）")).toContain("「每日令牌权限读数」");
    expect(head("crontab: 0 3 * * *", "桌面成品包")).toContain("「令牌权限读数」");
  });

  it("事件认不出来时按事件名指路，不猜一个可能不存在的格名", () => {
    const line = formatReadout(rows, { repo: "a/b", event: "push", branch: "master" })[0];
    expect(line).toContain("push");
    expect(line).toContain("找「令牌权限读数」");
    expect(line, "没认出来的事件不该被写成某一条具体流水线").not.toContain("流水线 流水线");
  });
});

describe("main：退码、缺件的出口、以及「不打凭据」", () => {
  const heard: Array<string> = [];
  const run = async (
    argv: Array<string>,
    env: Record<string, string | undefined> = {},
    fn: FetchFn = fakeFetch({}),
  ) => {
    heard.length = 0;
    const code = await main({
      argv,
      env: {
        CNB_REPO_SLUG: "a/b",
        CNB_TOKEN: "tk-must-never-appear",
        CNB_API_ENDPOINT: "https://api.example",
        ...env,
      },
      fetchFact: fn,
      log: (s: string) => heard.push(s),
    });
    return code;
  };

  it("缺权限不构成红：默认退 0，--strict 也不该因为「缺 repo-manage:r」退非零", async () => {
    const fn = fakeFetch({
      "settings/cloud-native-build": reply(denied("repo-manage:r"), 403),
    });
    expect(await run([], {}, fn)).toBe(CODE.OK);
    expect(await run(["--strict"], {}, fn)).toBe(CODE.OK);
  });

  it("一条明确答复都没有 ⇒ --strict 退 2（这一格自己坏了），默认仍退 0", async () => {
    const dead: FetchFn = async () => ({
      ok: false,
      status: -1,
      body: "",
      error: "ECONNREFUSED",
    });
    expect(await run(["--strict"], {}, dead)).toBe(CODE.NO_FACT);
    // 那句「自己坏了」是**紧接着的最后一行**，先收下来再看（下一跑会覆盖 `heard`）。
    const strictOut = heard.join("\n");
    expect(strictOut).toContain("自己坏了");
    expect(await run([], {}, dead)).toBe(CODE.OK);
  });

  it("缺 token / 缺平台地址 ⇒ 念出缺哪一件，且不乱猜", async () => {
    expect(await run(["--strict"], { CNB_TOKEN: "" })).toBe(CODE.NO_FACT);
    const text = heard.join("\n");
    expect(text).toContain("CNB_TOKEN");
    expect(text).toContain("没量到任何东西");

    heard.length = 0;
    await run([], { CNB_API_ENDPOINT: "" });
    expect(heard.join("\n")).toContain("CNB_API_ENDPOINT");
  });

  it("令牌值一个字节都不进日志（env 里有 CNB_TOKEN，读数里不许出现它）", async () => {
    await run(["--json"]);
    expect(heard.join("\n")).not.toContain("tk-must-never-appear");
    heard.length = 0;
    await run([]);
    expect(heard.join("\n")).not.toContain("tk-must-never-appear");
  });
});

describe("接线：平台那一跳不许带 --strict", () => {
  it("三处 endStages 都不带 --strict（否则 PR 上会有一条永远红、没人能修的格子）", () => {
    /* ISSUE #2551 的第一跑（`cnb-vv9-1k60eb6vl`）：PR 那一族的令牌连
     * `repo-cnb-history:r` 都没有 ⇒ 探针全 403，带了 `--strict` 就红。那不是这一格坏了，
     * 那是它要量的东西 —— 判它红等于把平台形态伪装成这次 PR 的缺陷。 */
    const config = readFileSync(CONFIG, "utf8");
    const lines = config.split("\n").filter((l) => l.includes("ci-token-scopes.mjs"));
    expect(lines.length, "三个入口各有一格，`.cnb.yml` 里应当出现三次").toBe(3);
    for (const line of lines) {
      expect(
        line,
        "平台那一跳带上 `--strict` 之后，PR 上会有一条永远红且没人能修的格子（ISSUE #2551）",
      ).not.toContain("--strict");
    }
  });
});
