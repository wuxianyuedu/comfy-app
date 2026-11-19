/**
 * `scripts/ci/ci-dependabot-triage.mjs` 的契约（ISSUE #4168）。
 *
 * 四组用例，每组钉一种危险失效（与 `ci-code-scanning-triage.test.ts` 同一结构）：
 *   ① 去重键认错了（用 alert number 或 GHSA 当键 ⇒ 复发 / 同包多 advisory 就重复建单）；
 *   ② 部分页被读成「没有告警」（⇒ 把一次失败写成一堆「已清零」的假读数）；
 *   ③ 401 / 403 / 限流 / 5xx 被读成「没有结论」以外的东西；
 *   ④ 建单后漏了补标签（`create-issue --labels` 实测不落地）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeAlert } from "../scripts/ci/ci-dependabot-triage-model.mjs";
import {
  CODE,
  aggregateByPackage,
  alertLink,
  classifyCnbFailure,
  classifyGithubFailure,
  findIssueForPackage,
  issueTitle,
  main,
  managedIssues,
  packageOfTitle,
  planActions,
  renderIssueBody,
  titleKey,
} from "../scripts/ci/ci-dependabot-triage.mjs";

/** 一条告警（本档 `normalizeAlert()` 之后的形状）。 */
type Alert = {
  ecosystem: string;
  ghsaId: string;
  manifestPath: string;
  name: string;
  number: number;
  patched: string;
  pkg: string;
  range: string;
  scope: string;
  severity: string;
  summary: string;
  updatedAt: string;
  url: string;
};

/** 平台上的已有单。 */
type IssueRow = { labels: string[]; number: number; title: string };

const alert = (
  number: number,
  pkg = "npm/lodash",
  severity = "high",
  manifestPath = "/package.json",
): Alert => ({
  number,
  pkg,
  ecosystem: pkg.split("/")[0] ?? "npm",
  name: pkg.split("/").slice(1).join("/") || pkg,
  severity,
  ghsaId: `GHSA-test-${number}`,
  summary: "Prototype pollution in a core package.",
  range: "< 4.17.21",
  patched: "4.17.21",
  manifestPath,
  scope: "runtime",
  url: `https://github.com/wuxianyuedu/comfy-app/security/dependabot/${number}`,
  updatedAt: "2026-11-16T10:00:00Z",
});

/** GitHub API 的原始形状（main 集成用例喂给假件的那一层）。 */
const rawAlert = (number: number, name = "lodash", ecosystem = "npm", severity = "high") => ({
  number,
  state: "open",
  html_url: `https://github.com/wuxianyuedu/comfy-app/security/dependabot/${number}`,
  created_at: "2026-11-15T09:00:00Z",
  updated_at: "2026-11-16T10:00:00Z",
  security_advisory: {
    ghsa_id: `GHSA-test-${number}`,
    summary: "Prototype pollution in a core package.",
    severity,
  },
  security_vulnerability: {
    package: { name, ecosystem },
    vulnerable_version_range: "< 4.17.21",
    first_patched_version: { identifier: "4.17.21" },
  },
  dependency: {
    package: { name, ecosystem },
    manifest_path: "/package.json",
    scope: "runtime",
  },
});

const issue = (number: number, title: string, labels: string[] = []): IssueRow => ({
  number,
  title,
  labels,
});

/* ── 一次最小可用的平台替身 ───────────────────────────────────────── */

type HttpCall = { init: { body?: string; method?: string }; url: string };

type FakeResponse = {
  headers: { get: (key: string) => string | null };
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<FakeResponse> {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
    text: () => Promise.resolve(text),
  });
}

/** GitHub 侧：`/dependabot/alerts`（Dependabot 没有分析读数，只有告警一张表）。 */
function ghOk(alerts: unknown[], calls?: HttpCall[]) {
  return (url: string, init?: { body?: string; method?: string }): Promise<FakeResponse> => {
    calls?.push({ url, init: init ?? {} });
    /* 单页形态：没有 Link 头 ⇒ 取完即停。 */
    return response(200, alerts);
  };
}

const ENV = {
  GH_TOKEN: "gh-token",
  CNB_ISSUE_TOKEN: "cnb-token",
  GITHUB_REPOSITORY: "wuxianyuedu/comfy-app",
};

/** 走一遍 `main` 并收集日志（不碰网络、不写 summary）。 */
async function runMain(
  ghFetch: (url: string, init?: { body?: string; method?: string }) => Promise<FakeResponse>,
  cnbFetch: (url: string, init?: { body?: string; method?: string }) => Promise<FakeResponse>,
  argv: string[] = [],
) {
  const logs: string[] = [];
  const code = await main({
    argv,
    env: ENV,
    ghFetch,
    cnbFetch,
    log: (line: string) => logs.push(line),
    summaryPath: null,
    now: () => new Date("2026-11-16T19:17:28Z"),
  });
  return { code, logs };
}

/* ── ① 去重键 ───────────────────────────────────────────────────── */

describe("去重键只认标题里的 `dependabot: <ecosystem>/<name>`", () => {
  it("键的形状就是标题前缀那一段", () => {
    expect(titleKey("npm/lodash")).toBe("dependabot: npm/lodash");
    expect(issueTitle("npm/lodash", 2, "high")).toContain(titleKey("npm/lodash"));
  });

  it("scoped 包名整个被认回（@ 与 / 都在键里，不裂成两张单）", () => {
    expect(packageOfTitle("dependabot: npm/@libsql/client · 2 条 · high")).toBe(
      "npm/@libsql/client",
    );
    expect(packageOfTitle("dependabot: npm/lodash · 1 条 · high")).toBe("npm/lodash");
    expect(packageOfTitle("code-scanning: js/redos · 1 处 · high")).toBeNull();
    expect(packageOfTitle("ci(push): 别的档")).toBeNull();
  });

  it("同一个包命中已有单；不同包 / 以告警号为键的标题都不命中", () => {
    const rows = [
      issue(9, "dependabot: npm/lodash · 1 条 · high"),
      issue(10, "dependabot: alert #17"),
      issue(11, "dependabot: npm/@libsql/client · 2 条 · high"),
    ];
    expect(findIssueForPackage(managedIssues(rows), "npm/lodash")?.number).toBe(9);
    expect(findIssueForPackage(managedIssues(rows), "npm/axios")).toBeNull();
    /* `alert #17` 这条标题不是任何一条真实依赖的键 —— 拿告警号当键的那个写法落不到这里。 */
    expect(findIssueForPackage(managedIssues(rows), "17")).toBeNull();
  });

  it("同一包漏配成两张单时取号最小的那张（不重复建第三张）", () => {
    const rows = managedIssues([
      issue(30, "dependabot: npm/lodash · 1 条 · high"),
      issue(28, "dependabot: npm/lodash · 2 条 · high"),
    ]);
    expect(findIssueForPackage(rows, "npm/lodash")?.number).toBe(28);
  });

  it("不挂本族标签、标题也不带键的单不算本族；挂了本族标签的就算标题没键也算", () => {
    const rows = managedIssues([
      issue(1, "ci(push): 别的档"),
      issue(2, "杂项"),
      issue(3, "dependabot: npm/lodash · 1 条 · high"),
      issue(4, "历史遗留的旧标题", ["dependabot:cleared"]),
    ]);
    expect(rows.map((r) => r.number)).toEqual([3, 4]);
  });
});

/* ── ② 聚合与计划 ─────────────────────────────────────────────── */

describe("按依赖聚合（一包一单）", () => {
  it("同一包的多条 advisory 进同一组，严重度取组内最高", () => {
    const groups = aggregateByPackage([
      alert(3, "npm/lodash", "medium"),
      alert(5, "npm/axios", "high"),
      alert(20, "npm/lodash", "low"),
      alert(8, "npm/lodash", "critical"),
    ]);
    const pkg = groups.find((g) => g.pkg === "npm/lodash");
    expect(pkg?.count).toBe(3);
    expect(pkg?.severity).toBe("critical");
    expect(groups[0]?.severity).toBe("critical");
    expect(groups.find((g) => g.pkg === "npm/axios")?.count).toBe(1);
  });

  it("原始告警归一：缺 dependency / 缺修复版都不抛错，落到占位值", () => {
    const normalized = normalizeAlert({
      number: 7,
      html_url: "https://github.com/wuxianyuedu/comfy-app/security/dependabot/7",
      security_advisory: { ghsa_id: "GHSA-x", summary: "s", severity: "HIGH" },
    });
    expect(normalized.pkg).toBe("(未知生态)/(未知包)");
    expect(normalized.severity).toBe("high");
    expect(normalized.patched).toBe("(无修复版)");
    expect(normalized.manifestPath).toBe("(无 manifest)");
  });

  it("计划一次覆盖三种动作：新建 / 刷新 / 标注已清零（无分析读数也可计划）", () => {
    const actions = planActions({
      alerts: [alert(17, "npm/lodash", "high"), alert(15, "npm/axios", "medium")],
      existing: [
        issue(100, "dependabot: npm/lodash · 1 条 · high"),
        issue(101, "dependabot: npm/webpack · 1 条 · low"),
      ],
      ghRepo: "wuxianyuedu/comfy-app",
      at: "2026-11-16 19:17Z",
    });
    expect(actions.map((a) => `${a.kind}:${a.pkg}`).sort()).toEqual([
      "clear:npm/webpack",
      "create:npm/axios",
      "update:npm/lodash",
    ]);
    const clear = actions.find((a) => a.kind === "clear");
    /* marker 稳定（不带时刻）：下一跑的「已处理过」判断要靠它命中。 */
    expect(clear?.marker).toBe("已无 open 告警 · `npm/webpack`");
  });

  it("同一份告警集跑两遍，正文逐字相同（正文里没有巡检时刻，不会天天刷）", () => {
    const once = planActions({
      alerts: [alert(17, "npm/lodash", "high")],
      existing: [],
      ghRepo: "wuxianyuedu/comfy-app",
      at: "2026-11-16 19:17Z",
    });
    const again = planActions({
      alerts: [alert(17, "npm/lodash", "high")],
      existing: [],
      ghRepo: "wuxianyuedu/comfy-app",
      at: "2026-11-17 03:00Z",
    });
    expect(once[0]?.body).toBe(again[0]?.body);
    expect(once[0]?.body).not.toContain("巡检时刻");
  });
});

/* ── ③ 正文模板 ───────────────────────────────────────────────── */

describe("正文模板（概览 / 告警表 / 修复建议 / 验收口径）", () => {
  it("包含 GHSA、受影响范围、修复版、manifest 与原始链接", () => {
    const body = renderIssueBody({
      pkg: "npm/lodash",
      ecosystem: "npm",
      name: "lodash",
      severity: "high",
      alerts: [alert(17, "npm/lodash", "high", "/apps/studio/package.json")],
      ghRepo: "wuxianyuedu/comfy-app",
    });
    expect(body).toContain("**[评论人：ci-daily]**");
    expect(body).toContain("## 概览");
    expect(body).toContain("GHSA-test-17");
    expect(body).toContain("< 4.17.21");
    expect(body).toContain("4.17.21");
    expect(body).toContain("/apps/studio/package.json");
    expect(body).toContain(alertLink("wuxianyuedu/comfy-app", 17));
    expect(body).toContain("## 修复建议");
    expect(body).toContain("## 验收口径");
  });

  it("表格单元里的竖线被转义（否则整张表会散架）", () => {
    const body = renderIssueBody({
      pkg: "npm/lodash",
      ecosystem: "npm",
      name: "lodash",
      severity: "high",
      alerts: [{ ...alert(17, "npm/lodash", "high"), summary: "a | b" }],
      ghRepo: "wuxianyuedu/comfy-app",
    });
    expect(body).toContain(String.raw`a \| b`);
  });

  it("链接形状与 GitHub 页面一致", () => {
    expect(alertLink("wuxianyuedu/comfy-app", 20)).toBe(
      "https://github.com/wuxianyuedu/comfy-app/security/dependabot/20",
    );
  });
});

/* ── ④ 失败姿态 ───────────────────────────────────────────────── */

describe("失败姿态：读不全 / 认证 / 限流 ⇒ 红且零写入", () => {
  it("第一页满 100 条、第二页 500 ⇒ 不写一个字（部分页不构成结论）", async () => {
    const full = Array.from({ length: 100 }, (_, i) => rawAlert(i + 1));
    const ghCalls: HttpCall[] = [];
    const cnbCalls: HttpCall[] = [];
    const ghFetch = (url: string): Promise<FakeResponse> => {
      ghCalls.push({ url, init: {} });
      /* 首页（无游标）给满页 + Link 下一页；带游标的那一页一律 500。 */
      return new URL(url).searchParams.has("after")
        ? response(500, "boom")
        : response(200, full, {
            link: `<https://api.github.com/repos/wuxianyuedu/comfy-app/dependabot/alerts?state=open&per_page=100&after=cur1>; rel="next"`,
          });
    };
    const { code, logs } = await runMain(ghFetch, (url, init) => {
      cnbCalls.push({ url, init: init ?? {} });
      return response(200, []);
    });
    expect(code).toBe(CODE.NO_FACT);
    expect(ghCalls.length).toBe(1 + 1 + 2); // 首页 + 游标页 + 两次重试
    expect(cnbCalls).toEqual([]);
    expect(logs.join("\n")).toContain("一次都不写");
  });

  it("分页走 Link 头游标：请求不带 page 参数，下一页取 rel=next 的原地址", async () => {
    const full = Array.from({ length: 100 }, (_, i) => rawAlert(i + 1));
    const ghCalls: HttpCall[] = [];
    const cursorUrl =
      "https://api.github.com/repos/wuxianyuedu/comfy-app/dependabot/alerts?state=open&per_page=100&after=cur1";
    const ghFetch = (url: string): Promise<FakeResponse> => {
      ghCalls.push({ url, init: {} });
      return new URL(url).searchParams.has("after")
        ? response(200, [rawAlert(101)])
        : response(200, full, { link: `<${cursorUrl}>; rel="next"` });
    };
    const { code } = await runMain(ghFetch, () => response(200, []), ["--dry-run"]);
    expect(code).toBe(CODE.DONE);
    expect(ghCalls.length).toBe(2);
    /* page 参数会被 400 拒掉（#4168 现场）：首页只准有 state/open/per_page，没有 page。 */
    expect(new URL(ghCalls[0]?.url ?? "").searchParams.has("page")).toBe(false);
    expect(ghCalls[1]?.url).toBe(cursorUrl);
  });

  it("401 ⇒ NO_FACT，话术点名令牌那一格", async () => {
    const { code, logs } = await runMain(
      () => response(401, "bad credentials"),
      () => response(200, []),
    );
    expect(code).toBe(CODE.NO_FACT);
    expect(logs.join("\n")).toContain("401");
    expect(classifyGithubFailure(401, "", null).detail).toContain("GH_TOKEN");
  });

  it("403 ⇒ 点名缺 `vulnerability-alerts: read`（GITHUB_TOKEN 的 security-events 不覆盖 Dependabot）", async () => {
    const { code, logs } = await runMain(
      () => response(403, "forbidden"),
      () => response(200, []),
    );
    expect(code).toBe(CODE.NO_FACT);
    expect(logs.join("\n")).toContain("vulnerability-alerts: read");
  });

  it("workflow 权限块给的是 `vulnerability-alerts: read`，不是 security-events", () => {
    const yaml = readFileSync(
      join(process.cwd(), ".github", "workflows", "dependabot-triage.yml"),
      "utf8",
    );
    expect(yaml).toMatch(/^\s*vulnerability-alerts:\s*read\s*$/m);
    expect(yaml).not.toMatch(/^\s*security-events:\s*read\s*$/m);
  });

  it("push 触发钉在依赖清单上（ISSUE #4432）：master 分支 + 四份清单路径", () => {
    const yaml = readFileSync(
      join(process.cwd(), ".github", "workflows", "dependabot-triage.yml"),
      "utf8",
    );
    const trigger = yaml.slice(yaml.indexOf("\non:"), yaml.indexOf("\npermissions:"));
    expect(trigger).toContain("push:");
    expect(trigger).toMatch(/branches:\s*\[master\]/);
    for (const manifest of [
      "package.json",
      "pnpm-lock.yaml",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
    ]) {
      expect(trigger).toContain(`- ${manifest}`);
    }
  });

  it("403 + 配额 0 ⇒ 读成限流，不读成缺权限", () => {
    expect(classifyGithubFailure(403, "", "0").kind).toBe("rate-limit");
    expect(classifyGithubFailure(429, "", "12").kind).toBe("rate-limit");
    expect(classifyGithubFailure(403, "", "99").kind).toBe("forbidden");
  });

  it("CNB 的 403 原话点名缺哪一枚 scope", () => {
    expect(
      classifyCnbFailure(403, '{"errcode":403,"errmsg":"Missing required scopes: repo-issue:rw"}')
        .detail,
    ).toContain("repo-issue:rw");
  });

  it("已有单列表取不到 ⇒ 不建单（查不到 ≠ 没有），且 GitHub 侧只发读请求", async () => {
    const cnbCalls: HttpCall[] = [];
    const { code } = await runMain(ghOk([rawAlert(17)]), (url, init) => {
      cnbCalls.push({ url, init: init ?? {} });
      return response(500, "boom");
    });
    expect(code).toBe(CODE.NO_FACT);
    expect(cnbCalls.every((c) => (c.init.method ?? "GET") === "GET")).toBe(true);
  });
});

/* ── ⑤ 建单：标签要单独补，并回读 ───────────────────────────────── */

describe("建单路径：创建 → 补标签 → 独立回读", () => {
  it("POST /issues 之后必须再 POST /issues/{n}/labels（create-issue --labels 不落地）", async () => {
    const cnbCalls: HttpCall[] = [];
    const cnbFetch = (
      url: string,
      init?: { body?: string; method?: string },
    ): Promise<FakeResponse> => {
      cnbCalls.push({ url, init: init ?? {} });
      if (url.includes("/issues?state=open")) {
        return response(200, []);
      }
      if (url.includes("/labels?page=1")) {
        return response(200, [{ name: "code-scanning" }]);
      }
      if (url.endsWith("/labels") && init?.method === "POST") {
        return response(201, { name: "dependabot" });
      }
      if (url.endsWith("/issues") && init?.method === "POST") {
        return response(201, { number: 200 });
      }
      if (url.includes("/issues/200/labels") && init?.method === "POST") {
        return response(200, []);
      }
      if (url.includes("/issues/200")) {
        return response(200, {
          number: 200,
          title: "dependabot: npm/lodash · 1 条 · high",
          labels: [{ name: "提单人:ci-daily" }, { name: "dependabot" }],
        });
      }
      return response(404, "unexpected");
    };
    const { code, logs } = await runMain(ghOk([rawAlert(17, "lodash", "npm", "high")]), cnbFetch);
    expect(code).toBe(CODE.DONE);
    /* 建的是本族标签（不是 code scanning 那两枚）。 */
    const labelCalls = cnbCalls.filter(
      (c) => c.init.method === "POST" && c.url.includes("/labels") && !c.url.includes("page="),
    );
    expect(labelCalls.length).toBeGreaterThan(0);
    expect(labelCalls.every((c) => String(c.init.body).includes("dependabot"))).toBe(true);
    expect(logs.join("\n")).toContain("#200 已回读");
  });

  it("已清零的单在下一跑里被跳过（marker 命中就不动它）", async () => {
    const cnbCalls: HttpCall[] = [];
    const clearedBody = `**[评论人：ci-daily]**\n\n## 最新读数：这个包已无 open 告警\n\n- 巡检时刻：上一次\n- 已无 open 告警 · \`npm/webpack\`\n`;
    const cnbFetch = (
      url: string,
      init?: { body?: string; method?: string },
    ): Promise<FakeResponse> => {
      cnbCalls.push({ url, init: init ?? {} });
      if (url.includes("/issues?state=open")) {
        return response(200, [
          { number: 101, title: "dependabot: npm/webpack · 0 条 · 已无 open 告警", labels: [] },
        ]);
      }
      if (url.includes("/labels?page=1")) {
        return response(200, [{ name: "dependabot" }, { name: "dependabot:cleared" }]);
      }
      if (url.includes("/issues/101")) {
        return response(200, { number: 101, body: clearedBody, labels: [] });
      }
      return response(404, "unexpected");
    };
    /* GitHub 侧没有任何 open 告警 ⇒ 唯一的计划动作是「标注已清零 #101」，
     * 而它的 marker 已在旧正文里 ⇒ 无变化、不写。 */
    const { code } = await runMain(ghOk([]), cnbFetch);
    expect(code).toBe(CODE.DONE);
    expect(cnbCalls.some((c) => c.init.method === "PATCH")).toBe(false);
    expect(cnbCalls.some((c) => c.init.method === "POST" && c.url.includes("/comments"))).toBe(
      false,
    );
  });
});
