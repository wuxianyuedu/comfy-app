/**
 * `scripts/ci-ga-daily-failure-issue.mjs` 的契约：GA 每日镜像档跑红 ⇒ CNB 出现一张按格名去重的单。
 *
 * 与 CNB 侧 `ci-daily-failure-issue.test.ts` 同一族，但判的是**这一跑自己**（jobs API），
 * 所以两种危险失效的形状不同：
 *   ① 把「没拿到读数」写成红 —— jobs 取不到 / 认不出红格 / 开着的单取不到，一律零写入退 2；
 *   ② 把红写成静默 —— `--no-block` 只许改退码，那句红话必须原样打出来（不许改成静默 return）；
 *   ③ 把同一格写成每天一张 —— 去重键只认格名，run 号 / sha 不进键。
 * 判决链不在这重写：jobs / issue 列表都是注入的假 fetch 给出的形状。
 */
import process from "node:process";
import { describe, expect, it } from "vitest";

import {
  AUTO_PRIORITY,
  CODE,
  TITLE_PREFIX,
  composeBody,
  decideAction,
  failedStepsFromJobs,
  issueTitle,
  main,
  titleKey,
} from "../scripts/ci-ga-daily-failure-issue.mjs";

/** 请求的 init 只用到 `method` / `body`（其余头由实现自己加，用例不判它们）。 */
type Init = { body?: string; method?: string };

/** 假 fetch —— 与 `FetchLike` 同形：给 URL 与 init，回一个「够用的应答」。 */
type FetchLike = (url: string, init?: Init) => Promise<ResponseLike>;

/** 应答只给实现真会读的四个面：`ok` / `status` / `headers.get` / `text()`。 */
type ResponseLike = {
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

/**
 * 一次应答的最小形状。`cnbCall` / `ghGet` 读的是 `res.text()` 再自行 `JSON.parse`
 * （它们要据正文判断失败类别），所以三种读法都要给：少一个就落进「读不到」分支，
 * 用例会以为实现没写。
 */
function res(status: number, json: unknown, headers: Record<string, string> = {}): ResponseLike {
  const text = json === null ? "" : JSON.stringify(json);
  return {
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(json),
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  };
}

/**
 * 读一份 JSON 正文里本文件关心的两个字符串字段（`title` / `priority` / `body`）。
 * 刻意不做类型断言：`JSON.parse` 给的是 any，逐字段按 `typeof` 收窄就没有 any 往外流。
 */
function readFields(raw: string | undefined, keys: string[]): Record<string, string | undefined> {
  const parsed: unknown = JSON.parse(raw ?? "{}");
  const out: Record<string, string | undefined> = {};
  if (typeof parsed !== "object" || parsed === null) {
    return out;
  }
  for (const key of keys) {
    const value: unknown = Reflect.get(parsed, key);
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

const RUN_ID = "1234567890";
const SHA = "abcdef0123456789";
const GH_REPO = "wuxianyuedu/comfy-app";
const SLUG = "moon-read/comfy-app-t3";

/** jobs API 的应答：只给结论，不给日志（脚本也不读日志）。 */
function jobsJson(steps: Array<{ conclusion: string; name: string; status?: string }>) {
  return { jobs: [{ steps }] };
}

/**
 * 一路假 fetch：`gh` 是 GitHub 侧的全部应答，`cnb` 是 CNB 侧的。
 * 记下每一次调用，用例据此判「零写入」。
 */
function fakeFetch(opts: {
  cnb?: (method: string, path: string, init: Init) => ResponseLike;
  gh?: (path: string) => ResponseLike;
}) {
  const calls: string[] = [];
  const ghFetch: FetchLike = (url) => {
    const path = new URL(url).pathname;
    calls.push(`GH ${path}`);
    const answer = opts.gh;
    return Promise.resolve(answer ? answer(path) : res(500, { message: "no gh handler" }));
  };
  const cnbFetch: FetchLike = (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    calls.push(`CNB ${method} ${path}`);
    const answer = opts.cnb;
    return Promise.resolve(
      answer ? answer(method, path, init ?? {}) : res(500, { message: "no cnb handler" }),
    );
  };
  return { calls, ghFetch, cnbFetch };
}

/** 正常 CNB 侧：标签已在、无旧单、建单号从 3435 起、贴标签与回读都通。 */
function cnbHappy() {
  let created = 0;
  return (method: string, path: string): ResponseLike => {
    if (method === "GET" && path.startsWith(`/${SLUG}/-/labels`)) {
      return res(200, [{ name: "提单人:ci-ga-daily" }]);
    }
    if (method === "GET" && path.startsWith(`/${SLUG}/-/issues`)) {
      return res(200, []);
    }
    if (method === "POST" && path === `/${SLUG}/-/issues`) {
      created += 1;
      return res(201, { number: 3435 + created });
    }
    if (method === "POST" && path.endsWith("/labels")) {
      return res(200, { ok: true });
    }
    if (method === "POST" && path.endsWith("/comments")) {
      return res(200, { id: 1 });
    }
    return res(404, { message: `unexpected ${method} ${path}` });
  };
}

function env(extra: Record<string, string> = {}) {
  return {
    GITHUB_TOKEN: "ghs_fake",
    CNB_ISSUE_TOKEN: "cnb_fake",
    GITHUB_REPOSITORY: GH_REPO,
    GITHUB_RUN_ID: RUN_ID,
    GITHUB_SHA: SHA,
    CNB_REPO_SLUG: SLUG,
    ...extra,
  };
}

function logs() {
  const lines: string[] = [];
  return { lines, log: (s: string) => lines.push(s) };
}

describe("failedStepsFromJobs", () => {
  it("只认 conclusion=failure 的格（skipped / success / in_progress 都不算红）", () => {
    const json = jobsJson([
      { name: "检出", conclusion: "success" },
      { name: "全量E2E", conclusion: "failure" },
      { name: "单元测试", conclusion: "skipped" },
      { name: "环境证据", conclusion: "success", status: "in_progress" },
    ]);
    expect(failedStepsFromJobs(json)).toEqual(["全量E2E"]);
  });

  it("同名去重并保留出现顺序；空格名跳过", () => {
    const json = jobsJson([
      { name: "单元测试", conclusion: "failure" },
      { name: "  ", conclusion: "failure" },
      { name: "全量E2E", conclusion: "failure" },
      { name: "单元测试", conclusion: "failure" },
    ]);
    expect(failedStepsFromJobs(json)).toEqual(["单元测试", "全量E2E"]);
  });

  it("形状不对给空数组（由调用方按「没结论」处置，不在这里判红）", () => {
    expect(failedStepsFromJobs({})).toEqual([]);
    expect(failedStepsFromJobs(null)).toEqual([]);
    expect(failedStepsFromJobs({ jobs: "x" })).toEqual([]);
  });
});

/**
 * #3563 之后的真实拓扑：立案跑在**下游 job**（`daily-failure-issue`，`needs: daily`），
 * 所以 jobs API 的应答里有**两个** job —— 上游 `daily` 已 `completed`（红格的 conclusion
 * 是终值），立案 job 自己还在飞。上面的 `jobsJson` 只造一个 job，盖不到「红格在**别的**
 * job 里」这一形，而那正是这次修法成立的前提。
 *
 * ⚠️ 这里造的是**拓扑**，不是某一次 API 应答的逐字快照：#3563 那一跑（run 42915112854）
 * 的应答正文已经取不到了，能复核的只有脚本自己打印的「红格 0 个」。所以本组用例钉的是
 * 「下游 job 形态下读得到上游的红」，不声称复现了当时 API 到底回了什么。
 */
function downstreamRun(redStep: string) {
  return {
    jobs: [
      {
        conclusion: "failure",
        name: "daily",
        status: "completed",
        steps: [
          { conclusion: "success", name: "检出", status: "completed" },
          { conclusion: "failure", name: redStep, status: "completed" },
          {
            conclusion: "success",
            name: "环境证据（失败时：dmesg 的 OOM 行 + 内存读数）",
            status: "completed",
          },
        ],
      },
      {
        conclusion: null,
        name: "daily-failure-issue",
        status: "in_progress",
        steps: [
          { conclusion: "success", name: "检出（立案脚本在仓库里）", status: "completed" },
          {
            conclusion: "success",
            name: "装 Node（engines 下限 26.12.1；脚本只吃 node:*）",
            status: "completed",
          },
          {
            conclusion: null,
            name: "失败立案（补洞：GA 每日档跑红 ⇒ CNB 单，按格名去重）",
            status: "in_progress",
          },
        ],
      },
    ],
  };
}

describe("下游 job 拓扑（#3563）：红格在上游那个 job 里", () => {
  it("跨 job 取到上游的红格；立案 job 自己那三步不算红", () => {
    const red = "单元测试（排最后：唯一会因机器负载而红的一档，同 CNB 口径）";
    expect(failedStepsFromJobs(downstreamRun(red))).toEqual([red]);
  });

  it("main 在这一形下真的建单（而不是「红格 0 个」零写入）", async () => {
    const red = "全量E2E（cnb 同款判据一字不改）";
    /** 建单 POST 的正文 —— 回读读的就是这份。 */
    const seen: { posted?: Record<string, string | undefined> } = {};
    const { calls, ghFetch, cnbFetch } = fakeFetch({
      gh: () => res(200, downstreamRun(red)),
      cnb: (method, path) => {
        if (method === "GET" && path.startsWith(`/${SLUG}/-/labels`)) {
          return res(200, [{ name: "提单人:ci-ga-daily" }]);
        }
        if (method === "GET" && path === `/${SLUG}/-/issues/3500`) {
          return res(200, {
            labels: [{ name: "提单人:ci-ga-daily" }],
            number: 3500,
            title: seen.posted?.title ?? "",
          });
        }
        if (method === "GET" && path.startsWith(`/${SLUG}/-/issues`)) {
          return res(200, []);
        }
        if (method === "POST" && path === `/${SLUG}/-/issues`) {
          return res(201, { number: 3500 });
        }
        if (method === "POST" && path.endsWith("/labels")) {
          return res(200, {});
        }
        return res(404, { message: `${method} ${path}` });
      },
    });
    const wrapped: FetchLike = (url, init) => {
      if ((init?.method ?? "").toUpperCase() === "POST" && url.endsWith("/issues")) {
        seen.posted = readFields(init?.body, ["body", "priority", "title"]);
      }
      return cnbFetch(url, init);
    };
    const { lines, log } = logs();
    const code = await main({ argv: [], env: env(), ghFetch, cnbFetch: wrapped, log });
    expect(code).toBe(CODE.DONE);
    expect(seen.posted?.title ?? "").toContain(titleKey(red));
    /* 反面锚：#3563 的失效形态是「读得到 jobs 却零写入」。这里必须真发过建单那一跳，
     * 且屏幕上不许出现那句「红格 0 个」—— 否则用例绿而事故重演。 */
    expect(calls.some((c) => c === `CNB POST /${SLUG}/-/issues`)).toBe(true);
    expect(lines.join("\n")).not.toContain("红格 0 个");
  });
});

describe("titleKey / issueTitle", () => {
  it("去重键只有格名：run 号与 sha 进标题、不进键", () => {
    const a = issueTitle({ runId: "1", sha: "aaaaaaaa11", step: "全量E2E" });
    const b = issueTitle({ runId: "2", sha: "bbbbbbbb22", step: "全量E2E" });
    expect(a).not.toBe(b);
    expect(a.startsWith(TITLE_PREFIX)).toBe(true);
    expect(a.includes(titleKey("全量E2E"))).toBe(true);
    expect(b.includes(titleKey("全量E2E"))).toBe(true);
  });

  it("缺 run / sha 时标题仍成形（空值不写成 undefined）", () => {
    const t = issueTitle({ runId: "", sha: "", step: "单元测试" });
    expect(t).not.toContain("undefined");
    expect(t.includes(titleKey("单元测试"))).toBe(true);
  });
});

describe("decideAction", () => {
  it("没有红格 ⇒ no-fact（不是「没有红」）", () => {
    const d = decideAction({ failedSteps: [], existing: [] });
    expect(d.action).toBe("no-fact");
    expect(d.stages).toEqual([]);
  });

  it("开着的单列表取不到 ⇒ no-fact（查不到 ≠ 没有）", () => {
    const d = decideAction({ failedSteps: ["全量E2E"], existing: null });
    expect(d.action).toBe("no-fact");
  });

  it("无旧单 ⇒ 建单；有旧单（标题带同一串键）⇒ 追加，不新建", () => {
    const fresh = decideAction({ failedSteps: ["全量E2E", "单元测试"], existing: [] });
    expect(fresh.action).toBe("write");
    expect(fresh.stages).toEqual([{ step: "全量E2E" }, { step: "单元测试" }]);

    const existing = [
      {
        labels: [],
        number: 3400,
        title: `ci(ga-daily): run 9 · sha deadbeef · ${titleKey("全量E2E")}`,
      },
    ];
    const dedup = decideAction({ failedSteps: ["全量E2E"], existing });
    expect(dedup.stages).toEqual([{ step: "全量E2E", number: 3400 }]);
  });

  it("人工写的单只要标题带同一串键，就进入这一族", () => {
    const existing = [
      { labels: [], number: 3435, title: `GA 每日档 ${titleKey("全量E2E")}（人工立的）` },
    ];
    expect(decideAction({ failedSteps: ["全量E2E"], existing }).stages).toEqual([
      { step: "全量E2E", number: 3435 },
    ]);
  });
});

describe("composeBody", () => {
  it("只含事实：症状 / run URL / sha / 根因未判定 / 出口；不代写因果", () => {
    const body = composeBody({
      ghRepo: GH_REPO,
      runId: RUN_ID,
      sha: SHA,
      step: "全量E2E",
      handle: "ci-ga-daily",
    });
    expect(body).toContain(`https://github.com/${GH_REPO}/actions/runs/${RUN_ID}`);
    expect(body).toContain(SHA);
    expect(body).toContain("「全量E2E」");
    expect(body).toContain("根因");
    expect(body).toContain("未判定");
    expect(body).toContain("base-check.mjs");
    expect(body).toContain("log-failed");
    // 机器只报事实：不许出现「因为 / 导致 / 应该是」这类因果句
    expect(/因为|导致|应该是/.test(body)).toBe(false);
  });
});

describe("main：零写入的四种情形", () => {
  it("缺 token / run id ⇒ 退 2 且一次网络都不发", async () => {
    const { calls, ghFetch, cnbFetch } = fakeFetch({});
    const { lines, log } = logs();
    const code = await main({ argv: [], env: { GITHUB_RUN_ID: RUN_ID }, ghFetch, cnbFetch, log });
    expect(code).toBe(CODE.NO_FACT);
    expect(calls).toEqual([]);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("jobs 取不到 ⇒ 退 2，CNB 侧一步都不走", async () => {
    const { calls, ghFetch, cnbFetch } = fakeFetch({ gh: () => res(500, {}) });
    const { log } = logs();
    const code = await main({ argv: [], env: env(), ghFetch, cnbFetch, log });
    expect(code).toBe(CODE.NO_FACT);
    expect(calls.filter((c) => c.startsWith("CNB"))).toEqual([]);
  });

  it("读得到 jobs 却没有红格 ⇒ 退 2 且零写入", async () => {
    const { calls, ghFetch, cnbFetch } = fakeFetch({
      gh: () => res(200, jobsJson([{ name: "检出", conclusion: "success" }])),
      cnb: cnbHappy(),
    });
    const { log } = logs();
    const code = await main({ argv: [], env: env(), ghFetch, cnbFetch, log });
    expect(code).toBe(CODE.NO_FACT);
    expect(calls.some((c) => c.startsWith("CNB POST"))).toBe(false);
  });

  it("开着的单取不到 ⇒ 退 2 且不建单（不据「查不到」新建）", async () => {
    const { calls, ghFetch, cnbFetch } = fakeFetch({
      gh: () => res(200, jobsJson([{ name: "全量E2E", conclusion: "failure" }])),
      cnb: (method, path) => {
        if (method === "GET" && path.startsWith(`/${SLUG}/-/issues`)) return res(500, {});
        return res(404, {});
      },
    });
    const { log } = logs();
    const code = await main({ argv: [], env: env(), ghFetch, cnbFetch, log });
    expect(code).toBe(CODE.NO_FACT);
    expect(calls.some((c) => c.startsWith("CNB POST"))).toBe(false);
  });
});

describe("main：该写就写", () => {
  it("无旧单 ⇒ 建单（标题带去重键、优先级 P1、补标签后回读通过）", async () => {
    /** 建单 POST 的正文（回读读的就是这份：回读对不上 = 没写成）。 */
    const seen: { posted?: Record<string, string | undefined> } = {};
    const { ghFetch, cnbFetch } = fakeFetch({
      gh: () => res(200, jobsJson([{ name: "全量E2E", conclusion: "failure" }])),
      cnb: (method, path) => {
        if (method === "GET" && path.startsWith(`/${SLUG}/-/labels`)) {
          return res(200, [{ name: "提单人:ci-ga-daily" }]);
        }
        if (method === "GET" && path === `/${SLUG}/-/issues/3500`) {
          // 回读那一格只该看到建单时真发出去的标题与标签
          return res(200, {
            labels: [{ name: "提单人:ci-ga-daily" }],
            number: 3500,
            title: seen.posted?.title ?? "",
          });
        }
        if (method === "GET" && path.startsWith(`/${SLUG}/-/issues`)) {
          return res(200, []);
        }
        if (method === "POST" && path === `/${SLUG}/-/issues`) {
          return res(201, { number: 3500 });
        }
        if (method === "POST" && path.endsWith("/labels")) {
          return res(200, {});
        }
        return res(404, { message: `${method} ${path}` });
      },
    });
    /** 只在建单那一次 POST 上截正文，其余原样转给假 CNB。 */
    const wrapped: FetchLike = (url, init) => {
      if ((init?.method ?? "").toUpperCase() === "POST" && url.endsWith("/issues")) {
        seen.posted = readFields(init?.body, ["body", "priority", "title"]);
      }
      return cnbFetch(url, init);
    };
    const { log } = logs();
    const code = await main({ argv: [], env: env(), ghFetch, cnbFetch: wrapped, log });
    expect(code).toBe(CODE.DONE);
    expect(seen.posted?.title ?? "").toContain(titleKey("全量E2E"));
    expect(seen.posted?.priority).toBe(AUTO_PRIORITY);
  });

  it("建单正文真的带上失败日志读数（#3584：立案时把红的那部分粘进单子）", async () => {
    const seen: { posted?: Record<string, string | undefined> } = {};
    const { ghFetch, cnbFetch } = fakeFetch({
      gh: () => res(200, jobsJson([{ name: "全量E2E", conclusion: "failure" }])),
      cnb: (method, path) => {
        if (method === "GET" && path.startsWith(`/${SLUG}/-/labels`)) {
          return res(200, [{ name: "提单人:ci-ga-daily" }]);
        }
        if (method === "GET" && path === `/${SLUG}/-/issues/3500`) {
          return res(200, {
            labels: [{ name: "提单人:ci-ga-daily" }],
            number: 3500,
            title: seen.posted?.title ?? "",
          });
        }
        if (method === "GET" && path.startsWith(`/${SLUG}/-/issues`)) return res(200, []);
        if (method === "POST" && path === `/${SLUG}/-/issues`) return res(201, { number: 3500 });
        if (method === "POST" && path.endsWith("/labels")) return res(200, {});
        return res(404, { message: `${method} ${path}` });
      },
    });
    const wrapped: FetchLike = (url, init) => {
      if ((init?.method ?? "").toUpperCase() === "POST" && url.endsWith("/issues")) {
        seen.posted = readFields(init?.body, ["body", "title"]);
      }
      return cnbFetch(url, init);
    };
    const { log } = logs();
    /* 日志读数由用例注入（与真跑共用同一个 `renderLogReadout` 产物）：这一条钉的是
     * 「取到的读数有没有真的进 POST 正文」，不是再测一遍日志取数那一跳。 */
    const code = await main({
      argv: [],
      env: env(),
      ghFetch,
      cnbFetch: wrapped,
      log,
      logReading: {
        ghRepo: GH_REPO,
        jobs: [{ conclusion: "failure", id: 9, name: "daily" }],
        ok: true,
        runId: RUN_ID,
        text: "##[error]FAIL  tests/full-suite-run.test.ts\n##[endgroup]",
      },
    });
    expect(code).toBe(CODE.DONE);
    expect(seen.posted?.body ?? "").toContain("## 失败日志（平台原样摘录，已脱敏）");
    expect(seen.posted?.body ?? "").toContain("##[error]FAIL  tests/full-suite-run.test.ts");
    expect(seen.posted?.body ?? "").toContain("## 当场读数（出处）");
  });

  it("日志取不到也照建单，正文只多一节「取不到 + 出口」", async () => {
    const seen: { posted?: Record<string, string | undefined> } = {};
    const { ghFetch, cnbFetch } = fakeFetch({
      gh: () => res(200, jobsJson([{ name: "全量E2E", conclusion: "failure" }])),
      cnb: (method, path) => {
        if (method === "GET" && path.startsWith(`/${SLUG}/-/labels`)) {
          return res(200, [{ name: "提单人:ci-ga-daily" }]);
        }
        if (method === "GET" && path === `/${SLUG}/-/issues/3500`) {
          return res(200, {
            labels: [{ name: "提单人:ci-ga-daily" }],
            number: 3500,
            title: seen.posted?.title ?? "",
          });
        }
        if (method === "GET" && path.startsWith(`/${SLUG}/-/issues`)) return res(200, []);
        if (method === "POST" && path === `/${SLUG}/-/issues`) return res(201, { number: 3500 });
        if (method === "POST" && path.endsWith("/labels")) return res(200, {});
        return res(404, {});
      },
    });
    const wrapped: FetchLike = (url, init) => {
      if ((init?.method ?? "").toUpperCase() === "POST" && url.endsWith("/issues")) {
        seen.posted = readFields(init?.body, ["body", "title"]);
      }
      return cnbFetch(url, init);
    };
    const { log } = logs();
    const code = await main({
      argv: [],
      env: env(),
      ghFetch,
      cnbFetch: wrapped,
      log,
      logReading: {
        ghRepo: GH_REPO,
        jobs: [],
        ok: false,
        reason: "job 清单 HTTP 403（令牌缺 actions: read）",
        runId: RUN_ID,
        text: "",
      },
    });
    expect(code).toBe(CODE.DONE);
    expect(seen.posted?.body ?? "").toContain("取不到");
    expect(seen.posted?.body ?? "").toContain("HTTP 403");
    expect(seen.posted?.body ?? "").toContain("--log-failed");
  });

  it("有旧单 ⇒ 追加评论、不新建", async () => {
    const calls: string[] = [];
    /** @type {string[]} */
    const commentBodies: string[] = [];
    const { ghFetch, cnbFetch } = fakeFetch({
      gh: () => res(200, jobsJson([{ name: "单元测试", conclusion: "failure" }])),
      cnb: (method, path, init) => {
        calls.push(`${method} ${path}`);
        if (method === "GET" && path.startsWith(`/${SLUG}/-/labels`)) {
          return res(200, [{ name: "提单人:ci-ga-daily" }]);
        }
        // 回读按 marker（run 号）在正文里找 —— 假回读也得给出真发布过的正文。
        // 这一支必须排在「开着的单」之前：它同以 `/-/issues` 开头。
        if (method === "GET" && path.includes("/comments")) {
          return res(
            200,
            commentBodies.map((body, i) => ({ id: i + 1, body })),
          );
        }
        if (method === "POST" && path.endsWith("/comments")) {
          commentBodies.push(readFields(init?.body, ["body"]).body ?? "");
          return res(200, { id: 9 });
        }
        if (method === "GET" && path.startsWith(`/${SLUG}/-/issues`)) {
          return res(200, [
            {
              labels: [],
              number: 3400,
              title: `ci(ga-daily): run 1 · sha 11111111 · ${titleKey("单元测试")}`,
            },
          ]);
        }
        return res(404, { message: `${method} ${path}` });
      },
    });
    const { log } = logs();
    const code = await main({ argv: [], env: env(), ghFetch, cnbFetch, log });
    expect(code).toBe(CODE.DONE);
    expect(
      calls.some(
        (c) =>
          c.startsWith("CNB POST") && c.includes(`/${SLUG}/-/issues`) && !c.includes("/comments"),
      ),
    ).toBe(false);
    expect(calls.some((c) => /POST .*\/issues\/3400\/comments$/.test(c))).toBe(true);
  });

  it("--dry-run ⇒ 只打印计划，一条都不写", async () => {
    const { calls, ghFetch, cnbFetch } = fakeFetch({
      gh: () => res(200, jobsJson([{ name: "全量E2E", conclusion: "failure" }])),
      cnb: cnbHappy(),
    });
    const { lines, log } = logs();
    const code = await main({ argv: ["--dry-run"], env: env(), ghFetch, cnbFetch, log });
    expect(code).toBe(CODE.DONE);
    expect(calls.some((c) => c.startsWith("CNB POST"))).toBe(false);
    expect(lines.join("\n")).toContain("DRY-RUN");
  });
});

describe("main：--no-block 只改退码，不改话术", () => {
  it("jobs 取不到时退 0，但红话与手工出口原样打出来（不许静默 return）", async () => {
    const { ghFetch, cnbFetch } = fakeFetch({ gh: () => res(500, {}) });
    const { lines, log } = logs();
    const code = await main({ argv: ["--no-block"], env: env(), ghFetch, cnbFetch, log });
    expect(code).toBe(CODE.DONE);
    const text = lines.join("\n");
    expect(text).toContain("没结论");
    expect(text).toContain("不拦路");
    expect(text).toContain("--log-failed");
  });

  it("写单失败时退 1（不带 --no-block），带时退 0 且念出失败原因与出口", async () => {
    const failing = fakeFetch({
      gh: () => res(200, jobsJson([{ name: "全量E2E", conclusion: "failure" }])),
      cnb: (method, path) => {
        if (method === "GET" && path.startsWith(`/${SLUG}/-/labels`)) {
          return res(200, [{ name: "提单人:ci-ga-daily" }]);
        }
        if (method === "GET" && path.startsWith(`/${SLUG}/-/issues`)) return res(200, []);
        if (method === "POST" && path === `/${SLUG}/-/issues`)
          return res(403, { message: "forbidden" });
        return res(404, {});
      },
    });
    const plain = logs();
    const plainCode = await main({
      argv: [],
      env: env(),
      ghFetch: failing.ghFetch,
      cnbFetch: failing.cnbFetch,
      log: plain.log,
    });
    expect(plainCode).toBe(CODE.WRITE_FAILED);

    const blockedFetch = fakeFetch({
      gh: () => res(200, jobsJson([{ name: "全量E2E", conclusion: "failure" }])),
      cnb: failingFetchHandler,
    });
    const blocked = logs();
    const blockedCode = await main({
      argv: ["--no-block"],
      env: env(),
      ghFetch: blockedFetch.ghFetch,
      cnbFetch: blockedFetch.cnbFetch,
      log: blocked.log,
    });
    expect(blockedCode).toBe(CODE.DONE);
    expect(blocked.lines.join("\n")).toContain("不拦路");
    expect(blocked.lines.join("\n")).toContain("--new-issue");
  });
});

/** 上面「写单被拒」那一档的 CNB 侧（独立函数以便两处复用同一形状）。 */
function failingFetchHandler(method: string, path: string) {
  if (method === "GET" && path.startsWith(`/${SLUG}/-/labels`)) {
    return res(200, [{ name: "提单人:ci-ga-daily" }]);
  }
  if (method === "GET" && path.startsWith(`/${SLUG}/-/issues`)) return res(200, []);
  if (method === "POST" && path === `/${SLUG}/-/issues`) return res(403, { message: "forbidden" });
  return res(404, {});
}

describe("入口自证", () => {
  it("直接执行时用 process.argv 跑 main（`if import.meta` 那一行不许被删）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "scripts", "ci-ga-daily-failure-issue.mjs"),
      "utf8",
    );
    expect(src).toContain("ci-ga-daily-failure-issue.mjs");
    expect(src).toMatch(/if \(process\.argv\[1\]/);
  });
});
