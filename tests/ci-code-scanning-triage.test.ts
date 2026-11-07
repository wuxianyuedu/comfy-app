/**
 * `scripts/ci-code-scanning-triage.mjs` 的契约。
 *
 * 四组用例，每组钉一种危险失效：
 *   ① 去重键认错了（用 alert number 或 file:line 当键 ⇒ 复发 / 行号漂移就重复建单）；
 *   ② 部分页被读成「没有告警」（⇒ 把一次失败写成一堆「已清零」的假读数）；
 *   ③ 401 / 403 / 限流 / 5xx 被读成「没有结论」以外的东西（⇒ 红得不明不白，或悄悄放行）；
 *   ④ 建单后漏了补标签（`create-issue --labels` 实测不落地）。
 */
import { describe, expect, it } from "vitest";

import {
  CODE,
  aggregateByRule,
  alertLink,
  classifyCnbFailure,
  classifyGithubFailure,
  findIssueForRule,
  issueTitle,
  main,
  managedIssues,
  planActions,
  renderIssueBody,
  ruleOfTitle,
  titleKey,
} from "../scripts/ci-code-scanning-triage.mjs";

/** 一条告警（本档 `normalizeAlert()` 之后的形状）。 */
type Alert = {
  message: string;
  number: number;
  path: string;
  ruleId: string;
  severity: string;
  startLine: number | null;
  url: string;
};

/** 平台上的已有单。 */
type IssueRow = { labels: string[]; number: number; title: string };

const analysis = {
  id: 2_117_829_505,
  ref: "refs/heads/master",
  commitSha: "cbb029de342e8c354056dbadf0b5975ff1ff1c76",
  createdAt: "2026-11-07T10:17:28Z",
};

const alert = (
  number: number,
  ruleId: string,
  severity = "medium",
  path = "src/lib/comfyui/client.ts",
  startLine = 10,
): Alert => ({
  number,
  ruleId,
  severity,
  path,
  startLine,
  message: "The URL of this request depends on a user-provided value.",
  url: `https://api.github.com/repos/wuxianyuedu/comfy-app/code-scanning/alerts/${number}`,
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

/** GitHub 侧：`/code-scanning/alerts` 与 `/code-scanning/analyses`。 */
function ghOk(alerts: unknown[], calls?: HttpCall[]) {
  return (url: string, init?: { body?: string; method?: string }): Promise<FakeResponse> => {
    calls?.push({ url, init: init ?? {} });
    if (url.includes("/code-scanning/analyses")) {
      return response(200, [
        { ...analysis, error: "", tool: { name: "CodeQL" }, results_count: 12 },
      ]);
    }
    const page = Number(new URL(url).searchParams.get("page") ?? "1");
    return page === 1 ? response(200, alerts) : response(200, []);
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
    now: () => new Date("2026-11-07T18:17:28Z"),
  });
  return { code, logs };
}

/* ── ① 去重键 ───────────────────────────────────────────────────── */

describe("去重键只认标题里的 `code-scanning: <rule id>`", () => {
  it("键的形状就是标题前缀那一段", () => {
    expect(titleKey("js/redos")).toBe("code-scanning: js/redos");
    expect(issueTitle("js/redos", 2, "high")).toContain(titleKey("js/redos"));
  });

  it("从标题里读回的规则 id 与规则原样一致（含连字符）", () => {
    expect(ruleOfTitle("code-scanning: js/redos · 1 处 · high")).toBe("js/redos");
    expect(
      ruleOfTitle("code-scanning: js/incomplete-multi-character-sanitization · 1 处 · high"),
    ).toBe("js/incomplete-multi-character-sanitization");
    expect(ruleOfTitle("ci(daily): 不相关的单")).toBeNull();
  });

  it("同一个规则命中已有单；不同规则 / 以 alert 号为键的标题都不命中", () => {
    const rows = [
      issue(9, "code-scanning: js/redos · 1 处 · high"),
      issue(10, "code-scanning: alert #17"),
      issue(11, "code-scanning: js/insecure-randomness · 2 处 · high"),
    ];
    expect(findIssueForRule(managedIssues(rows), "js/redos")?.number).toBe(9);
    expect(findIssueForRule(managedIssues(rows), "js/request-forgery")).toBeNull();
    /* `alert #17` 这条标题不是任何一条真实规则的键 —— 拿告警号当键的那个写法落不到这里。 */
    expect(findIssueForRule(managedIssues(rows), "17")).toBeNull();
  });

  it("同一规则漏配成两张单时取号最小的那张（不重复建第三张）", () => {
    const rows = managedIssues([
      issue(30, "code-scanning: js/redos · 1 处 · high"),
      issue(28, "code-scanning: js/redos · 2 处 · high"),
    ]);
    expect(findIssueForRule(rows, "js/redos")?.number).toBe(28);
  });

  it("不挂本族标签、标题也不带键的单不算本族", () => {
    const rows = managedIssues([issue(1, "ci(push): 别的档"), issue(2, "杂项")]);
    expect(rows).toEqual([]);
  });
});

/* ── ② 聚合 ───────────────────────────────────────────────────── */

describe("按规则聚合（一规则一单）", () => {
  it("同一规则的多条告警进同一组，严重度取组内最高", () => {
    const groups = aggregateByRule([
      alert(3, "actions/missing-workflow-permissions", "medium"),
      alert(5, "js/redos", "high"),
      alert(20, "actions/missing-workflow-permissions", "medium"),
      alert(8, "js/redos", "critical"),
    ]);
    const rule = groups.find((g) => g.ruleId === "js/redos");
    expect(rule?.count).toBe(2);
    expect(rule?.severity).toBe("critical");
    expect(groups[0]?.severity).toBe("critical");
    expect(groups.find((g) => g.ruleId === "actions/missing-workflow-permissions")?.count).toBe(2);
  });

  it("计划一次覆盖三种动作：新建 / 刷新 / 标注已清零", () => {
    const actions = planActions({
      alerts: [alert(17, "js/redos", "high"), alert(15, "js/insecure-randomness", "high")],
      existing: [
        issue(100, "code-scanning: js/redos · 1 处 · high"),
        issue(101, "code-scanning: js/bad-tag-filter · 1 处 · high"),
      ],
      analysis,
      ghRepo: "wuxianyuedu/comfy-app",
      at: "2026-11-07 18:17Z",
    });
    expect(actions.map((a) => `${a.kind}:${a.ruleId}`).sort()).toEqual([
      "clear:js/bad-tag-filter",
      "create:js/insecure-randomness",
      "update:js/redos",
    ]);
    const clear = actions.find((a) => a.kind === "clear");
    expect(clear?.marker).toContain("cbb029de");
  });
});

/* ── ③ 正文模板 ───────────────────────────────────────────────── */

describe("正文模板（概览 / 命中表 / 修复建议 / 验收口径）", () => {
  it("包含最近分析 commit + ref、文件:行、原始链接", () => {
    const body = renderIssueBody({
      ruleId: "js/redos",
      severity: "high",
      alerts: [alert(17, "js/redos", "high", "scripts/ui-primitives-rules-p67-p86.cjs", 598)],
      analysis,
      ghRepo: "wuxianyuedu/comfy-app",
    });
    expect(body).toContain("**[评论人：ci-daily]**");
    expect(body).toContain("## 概览");
    expect(body).toContain("cbb029de");
    expect(body).toContain("refs/heads/master");
    expect(body).toContain("scripts/ui-primitives-rules-p67-p86.cjs:598");
    expect(body).toContain(alertLink("wuxianyuedu/comfy-app", 17));
    expect(body).toContain("## 修复建议");
    expect(body).toContain("## 验收口径");
  });

  it("表格单元里的竖线被转义（否则整张表会散架）", () => {
    const body = renderIssueBody({
      ruleId: "js/redos",
      severity: "high",
      alerts: [{ ...alert(17, "js/redos", "high"), message: "a | b" }],
      analysis,
      ghRepo: "wuxianyuedu/comfy-app",
    });
    expect(body).toContain(String.raw`a \| b`);
  });

  it("链接形状与 GitHub 页面一致", () => {
    expect(alertLink("wuxianyuedu/comfy-app", 20)).toBe(
      "https://github.com/wuxianyuedu/comfy-app/security/code-scanning/20",
    );
  });
});

/* ── ④ 失败姿态 ───────────────────────────────────────────────── */

describe("失败姿态：读不全 / 认证 / 限流 ⇒ 红且零写入", () => {
  it("第一页满 100 条、第二页 500 ⇒ 不写一个字（部分页不构成结论）", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      rule: { id: "js/redos", security_severity_level: "high" },
      most_recent_instance: { location: { path: "a.ts", start_line: 1 }, message: { text: "m" } },
    }));
    const ghCalls: HttpCall[] = [];
    const cnbCalls: HttpCall[] = [];
    const ghFetch = (url: string): Promise<FakeResponse> => {
      ghCalls.push({ url, init: {} });
      return new URL(url).searchParams.get("page") === "1"
        ? response(200, full)
        : response(500, "boom");
    };
    const { code, logs } = await runMain(ghFetch, (url, init) => {
      cnbCalls.push({ url, init: init ?? {} });
      return response(200, []);
    });
    expect(code).toBe(CODE.NO_FACT);
    expect(ghCalls.length).toBe(1 + 1 + 2); // 第 1 页 + 第 2 页 + 两次重试
    expect(cnbCalls).toEqual([]);
    expect(logs.join("\n")).toContain("一次都不写");
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

  it("403 ⇒ 点名缺 `security-events: read`", async () => {
    const { code, logs } = await runMain(
      () => response(403, "forbidden"),
      () => response(200, []),
    );
    expect(code).toBe(CODE.NO_FACT);
    expect(logs.join("\n")).toContain("security-events: read");
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

  it("已有单列表取不到 ⇒ 不建单（查不到 ≠ 没有）", async () => {
    const cnbCalls: HttpCall[] = [];
    const { code } = await runMain(
      ghOk([
        {
          number: 17,
          rule: { id: "js/redos", security_severity_level: "high" },
          most_recent_instance: {},
        },
      ]),
      (url, init) => {
        cnbCalls.push({ url, init: init ?? {} });
        return response(500, "boom");
      },
    );
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
        return response(200, [{ name: "code-scanning" }, { name: "code-scanning:cleared" }]);
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
          title: "code-scanning: js/redos · 1 处 · high",
          labels: [{ name: "提单人:ci-daily" }, { name: "code-scanning" }],
        });
      }
      return response(404, "unexpected");
    };
    const { code, logs } = await runMain(
      ghOk([
        {
          number: 17,
          rule: { id: "js/redos", security_severity_level: "high" },
          most_recent_instance: {},
        },
      ]),
      cnbFetch,
    );
    expect(code).toBe(CODE.DONE);
    const labelPost = cnbCalls.find(
      (c) => c.url.includes("/issues/200/labels") && c.init.method === "POST",
    );
    expect(labelPost).toBeTruthy();
    expect(labelPost?.init.body).toContain("提单人:ci-daily");
    expect(labelPost?.init.body).toContain("code-scanning");
    expect(logs.join("\n")).toContain("已回读");
  });
});
