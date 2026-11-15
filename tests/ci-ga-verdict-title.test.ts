/**
 * `scripts/ci-ga-verdict-title.mjs` 的判据（ISSUE #3981）。
 *
 * 钉住四件最容易静默失效的事：
 *   ① 两条触发形态（自动档 payload / 按需档 API）**写同一个键** `GA_PR_TITLE` ——
 *      分成两个键就是「按需档的回调又变回无标题」那种只修一半的形态；
 *   ② 取到标题 ⇒ 写进 `GITHUB_ENV`（下一步 `env.GA_PR_TITLE` 才读得到）；
 *   ③ 取不到（没 env 文件 / 号不是数字 / 没令牌 / 平台非 200 / 请求抛异常 / 标题空）
 *      ⇒ 退 2 并且**不写**任何键 —— 「没拿到」不是「拿到了空标题」；
 *   ④ 这一步只搬标题：它一次也不改 `GA_VERDICT`、不碰回调的退码口径。
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { main, TITLE_ENV_KEY, titleFromPull } from "../scripts/ci-ga-verdict-title.mjs";

/** 每个用例一份自己的 env 文件（写进系统临时目录，不碰仓库里的任何东西）。 */
const envFiles: string[] = [];
afterEach(() => {
  envFiles.length = 0;
});

function newEnvFile(seed = ""): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ga-title-"));
  const file = path.join(dir, "github_env");
  writeFileSync(file, seed, "utf8");
  envFiles.push(file);
  return file;
}

const collect = (into: string[]) => (line: string) => {
  into.push(line);
};

/** 注入面用的最小 fetch 形状（不给 `typeof fetch` 逼假件去造整个 `Response`）。 */
type FetchLike = (
  url: string,
  init?: unknown,
) => Promise<{ json: () => Promise<unknown>; ok: boolean; status: number }>;

/** 构造一个最小 fetch 假件（返回固定应答，不做断言）。 */
const fakeFetch =
  (body: unknown, status = 200): FetchLike =>
  () =>
    Promise.resolve({
      json: () => Promise.resolve(body),
      ok: status >= 200 && status < 300,
      status,
    });

const PR_ENV = {
  CNB_PULL_REQUEST_IID: "3981",
  CNB_REPO_SLUG: "moon-read/comfy-app-t3",
  CNB_TRIGGER_TOKEN: "token",
};

describe("从平台应答取标题", () => {
  it("认 `data.title`，两头空白剪掉", () => {
    expect(titleFromPull({ data: { title: "  feat: x  " } })).toBe("feat: x");
  });

  it("形状不对 / 缺字段 / 非字符串 ⇒ 空串（不抛，也不猜）", () => {
    expect(titleFromPull({})).toBe("");
    expect(titleFromPull({ data: { title: 42 } })).toBe("");
    expect(titleFromPull(null)).toBe("");
  });
});

describe("两条触发形态写同一个键", () => {
  it("自动档：env 里已有标题 ⇒ 不发起请求，直接落盘", async () => {
    const envFile = newEnvFile();
    let called = 0;
    const code = await main({
      env: { ...PR_ENV, GITHUB_ENV: envFile, [TITLE_ENV_KEY]: "feat(ci): 自动档" },
      fetchImpl: () => {
        called += 1;
        return Promise.reject(new Error("不该发起请求"));
      },
      log: collect([]),
    });
    expect(code).toBe(0);
    expect(called, "payload 已给出标题时不该再去读平台").toBe(0);
    expect(readFileSync(envFile, "utf8")).toBe(`${TITLE_ENV_KEY}=feat(ci): 自动档\n`);
  });

  it("按需档：env 没有 ⇒ 站内读 `GET /{repo}/-/pulls/{n}` 再落盘", async () => {
    const envFile = newEnvFile();
    const urls: string[] = [];
    const code = await main({
      env: { ...PR_ENV, GITHUB_ENV: envFile },
      fetchImpl: (url) => {
        urls.push(String(url));
        return fakeFetch({ data: { title: "feat(ci): 按需档" } })(String(url));
      },
      log: collect([]),
    });
    expect(code).toBe(0);
    expect(urls).toEqual(["https://api.cnb.cool/moon-read/comfy-app-t3/-/pulls/3981"]);
    expect(readFileSync(envFile, "utf8")).toBe(`${TITLE_ENV_KEY}=feat(ci): 按需档\n`);
  });
});

describe("取不到 ⇒ 2 且一个键都不写（没拿到 ≠ 拿到了空标题）", () => {
  const noWrite = async (env: Record<string, string>, fetchImpl?: FetchLike) => {
    const envFile = newEnvFile();
    const lines: string[] = [];
    const code = await main({
      env: { ...env, GITHUB_ENV: envFile },
      fetchImpl,
      log: collect(lines),
    });
    expect(code).toBe(2);
    expect(readFileSync(envFile, "utf8"), "取不到标题时不该往 GITHUB_ENV 写任何键").toBe("");
    return lines;
  };

  it("没有 GITHUB_ENV（不在 actions runner 上）", async () => {
    const lines: string[] = [];
    expect(await main({ env: { ...PR_ENV }, log: collect(lines) })).toBe(2);
    expect(lines.join(" ")).toContain("GITHUB_ENV");
  });

  it("PR 号不是纯数字 / 缺令牌 / 平台非 200 / 请求抛异常 / 标题空白", async () => {
    expect((await noWrite({ ...PR_ENV, CNB_PULL_REQUEST_IID: "HEAD" })).join(" ")).toContain(
      "PR 号",
    );
    expect((await noWrite({ ...PR_ENV, CNB_TRIGGER_TOKEN: "" })).join(" ")).toContain("令牌");
    expect((await noWrite(PR_ENV, fakeFetch({}, 403))).join(" ")).toContain("403");
    const throwing: FetchLike = () => Promise.reject(new Error("network down"));
    expect((await noWrite(PR_ENV, throwing)).join(" ")).toContain("network down");
    await noWrite(PR_ENV, fakeFetch({ data: { title: "   " } }));
  });
});
