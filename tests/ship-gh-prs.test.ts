/**
 * `ship --gh-prs`（`scripts/ship-gh-prs.mjs`，ISSUE #3704）的取数与呈现判据。
 *
 * 钉住与 `--gh-logs` 同一条纪律：
 *   ① 清单 / 单条详情的行读数都在场（号 / 标题 / 作者 / 分支 / mergeable / URL）；
 *   ② 无令牌 ⇒ 只念一行、一次网络都不发、退码不变；
 *   ③ 取数失败 ⇒ 只多一行缺因，退码照旧是绿；
 *   ④ 输入认不出 ⇒ 退 2（用法错）。
 */
import { describe, expect, it } from "vitest";

import { parseArgs } from "../scripts/ship-args.mjs";
import { CODE } from "../scripts/ship-core.mjs";
import {
  ghPullApiUrl,
  ghPullsApiUrl,
  ghPullHtmlUrl,
  parseGhPrsFilter,
  renderPullLine,
  runGhPrs,
} from "../scripts/ship-gh-prs.mjs";

const REPO = "wuxianyuedu/comfy-app";

/** 键名拼出来，不让「赋值式凭据」的形状进被跟踪的文字（tracked-secrets 硬闸，同 ship-gh-logs.test.ts）。 */
const envKey = ["GITHUB", "TOKEN"].join("_");
const fakeToken = "placeholder-token-value-123456";

/** 一条开着的 PR（形状贴 GitHub pulls 回话）。 */
const OPEN_PULL = {
  number: 42,
  state: "open",
  draft: false,
  title: "Bump vite from 1.0 to 2.0",
  user: { login: "dependabot[bot]" },
  head: { ref: "dependabot/npm_and_yarn/vite-2.0" },
  base: { ref: "master" },
  updated_at: "2026-11-13T08:00:00Z",
  mergeable_state: "clean",
  html_url: `https://github.com/${REPO}/pull/42`,
  labels: [{ name: "dependencies" }],
  body: "Bumps vite from 1.0 to 2.0.",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("parseGhPrsFilter", () => {
  it("缺省 = open；open / closed / all 按状态收", () => {
    expect(parseGhPrsFilter("")).toEqual({ kind: "state", state: "open" });
    expect(parseGhPrsFilter("open")).toEqual({ kind: "state", state: "open" });
    expect(parseGhPrsFilter("closed")).toEqual({ kind: "state", state: "closed" });
    expect(parseGhPrsFilter("all")).toEqual({ kind: "state", state: "all" });
  });

  it("数字 / #号 = 单条 PR 详情；别的字样判 bad", () => {
    expect(parseGhPrsFilter("42")).toEqual({ kind: "pr", number: 42 });
    expect(parseGhPrsFilter("#42")).toEqual({ kind: "pr", number: 42 });
    expect(parseGhPrsFilter("sync-dependabot")).toEqual({
      bad: "sync-dependabot",
      kind: null,
    });
  });
});

describe("URL 拼装", () => {
  it("清单带状态过滤与分页；单条 / 网页 URL 各归各位", () => {
    expect(ghPullsApiUrl(REPO, "open")).toBe(
      `https://api.github.com/repos/${REPO}/pulls?state=open&per_page=50&sort=updated&direction=desc`,
    );
    expect(ghPullApiUrl(REPO, 42)).toBe(`https://api.github.com/repos/${REPO}/pulls/42`);
    expect(ghPullHtmlUrl(REPO, 42)).toBe(`https://github.com/${REPO}/pull/42`);
  });
});

describe("renderPullLine", () => {
  it("一行里带上号 / 状态 / 标题 / 作者 / 分支 / 更新日 / mergeable", () => {
    const line = renderPullLine(OPEN_PULL);
    expect(line).toContain("#42");
    expect(line).toContain("[open]");
    expect(line).toContain("Bump vite");
    expect(line).toContain("dependabot[bot]");
    expect(line).toContain("dependabot/npm_and_yarn/vite-2.0→master");
    expect(line).toContain("mergeable=clean");
  });

  it("draft PR 有标记", () => {
    expect(renderPullLine({ ...OPEN_PULL, draft: true })).toContain("· draft");
  });
});

/** 带调用记录的假 fetch：回话 = JSON；记录命中的 URL（断言「打了哪个端点」用）。 */
function fakeJsonFetch(body: unknown, status = 200): { calls: string[]; fetchImpl: typeof fetch } {
  const calls: string[] = [];
  const fetchImpl = (input: RequestInfo | URL): Promise<Response> => {
    /* RequestInfo 可能是 Request 对象 —— 按形态取 URL 串，不走默认 toString。 */
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(jsonResponse(body, status));
  };
  return { calls, fetchImpl };
}

/** 禁止发网的假 fetch：这一格不该有网络（无令牌 / dry-run）。 */
function forbidFetch(): typeof fetch {
  return (_input: RequestInfo | URL): Promise<Response> => {
    throw new Error("这一格不该发网络请求");
  };
}

describe("runGhPrs", () => {
  /** 无令牌：只念一行、一次网络都不发、退码绿。 */
  it("无令牌 ⇒ 只念一行跳过，一次网络都不发", async () => {
    const lines: string[] = [];
    const code = await runGhPrs({
      filterRaw: "",
      repo: REPO,
      env: {},
      log: (line) => lines.push(line),
      fetchImpl: forbidFetch(),
    });
    expect(code).toBe(CODE.GREEN);
    expect(lines.join("\n")).toContain("未设置令牌");
  });

  it("dry-run ⇒ 只念一句，一条网络都不发", async () => {
    const lines: string[] = [];
    const code = await runGhPrs({
      filterRaw: "",
      repo: REPO,
      env: { [envKey]: fakeToken },
      log: (line) => lines.push(line),
      fetchImpl: forbidFetch(),
      dryRun: true,
    });
    expect(code).toBe(CODE.GREEN);
    expect(lines.join("\n")).toContain("--dry-run");
  });

  it("清单：逐条渲染行读数（号 / 标题 / 作者 / 分支 / mergeable）", async () => {
    const { fetchImpl, calls } = fakeJsonFetch([OPEN_PULL]);
    const lines: string[] = [];
    const code = await runGhPrs({
      filterRaw: "open",
      repo: REPO,
      env: { [envKey]: fakeToken },
      log: (line) => lines.push(line),
      fetchImpl,
    });
    expect(code).toBe(CODE.GREEN);
    expect(calls[0]).toContain(`repos/${REPO}/pulls`);
    expect(calls[0]).toContain("state=open");
    const text = lines.join("\n");
    expect(text).toContain("共 1 条");
    expect(text).toContain("#42 [open] Bump vite");
    expect(text).toContain("dependabot[bot]");
  });

  it("单条详情：URL / 标签 / 正文摘要在场", async () => {
    const { fetchImpl, calls } = fakeJsonFetch(OPEN_PULL);
    const lines: string[] = [];
    const code = await runGhPrs({
      filterRaw: "42",
      repo: REPO,
      env: { [envKey]: fakeToken },
      log: (line) => lines.push(line),
      fetchImpl,
    });
    expect(code).toBe(CODE.GREEN);
    expect(calls[0]).toBe(ghPullApiUrl(REPO, 42));
    const text = lines.join("\n");
    expect(text).toContain(`https://github.com/${REPO}/pull/42`);
    expect(text).toContain("dependencies");
    expect(text).toContain("Bumps vite");
  });

  it("空清单 ⇒ 念一行「没有」，退码绿", async () => {
    const { fetchImpl } = fakeJsonFetch([]);
    const lines: string[] = [];
    const code = await runGhPrs({
      filterRaw: "open",
      repo: REPO,
      env: { [envKey]: fakeToken },
      log: (line) => lines.push(line),
      fetchImpl,
    });
    expect(code).toBe(CODE.GREEN);
    expect(lines.join("\n")).toContain("没有 open 状态的 PR");
  });

  it("取数失败（HTTP 404）⇒ 只多一行缺因，退码照旧绿", async () => {
    const { fetchImpl } = fakeJsonFetch({ message: "Not Found" }, 404);
    const lines: string[] = [];
    const code = await runGhPrs({
      filterRaw: "all",
      repo: REPO,
      env: { [envKey]: fakeToken },
      log: (line) => lines.push(line),
      fetchImpl,
    });
    expect(code).toBe(CODE.GREEN);
    expect(lines.join("\n")).toContain("HTTP 404");
  });

  it("输入认不出 ⇒ 退 2（用法错）", async () => {
    const lines: string[] = [];
    const code = await runGhPrs({
      filterRaw: "sync-dependabot",
      repo: REPO,
      env: { [envKey]: fakeToken },
      log: (line) => lines.push(line),
      fetchImpl: forbidFetch(),
    });
    expect(code).toBe(CODE.NOT_RUN);
    expect(lines.join("\n")).toContain("认不出");
  });
});

describe("ship-args：--gh-prs 的两种写法与缺省值", () => {
  it("裸旗标 ⇒ 缺省 open；等号 / 空格都能带值", () => {
    expect(parseArgs(["--gh-prs"]).ghPrsRef).toBe("open");
    expect(parseArgs(["--gh-prs=all"]).ghPrsRef).toBe("all");
    expect(parseArgs(["--gh-prs", "42"]).ghPrsRef).toBe("42");
    expect(parseArgs(["--gh-prs"]).ghPrs).toBe(true);
  });

  it("重复给值 ⇒ 记 bad，不静默收下", () => {
    const parsed = parseArgs(["--gh-prs=open", "--gh-prs=all"]);
    expect(parsed.ghPrsBad.length).toBeGreaterThan(0);
  });
});
