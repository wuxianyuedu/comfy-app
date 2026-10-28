/**
 * `scripts/ci-token-scopes.mjs` 的契约（ISSUE #2551）。
 *
 * 这一格是「**这一跑的 `CNB_TOKEN` 够得着哪些能力**」的执行者。它最危险的失效形态有两种，
 * 本文件各有一组用例对着：
 *
 *   ① **把「没量到」读成「够得着」**（`cnb` 不在、网络断、信封里没 `status` ⇒ 那是没有结论，
 *      不是授权面完整 —— 与 §13.6.4.1 那条「取不到 ≠ 测出来是好的」同一纪律）；
 *   ② **把令牌值打进日志**（硬规则 17：这一格打的是「哪些能力够得着」，一个字节的凭据都不打）。
 *
 * 另外两条边界也各有对象：业务层 404（对象不存在）不许读成缺权限；缺权限本身**不许**变成红
 * （平台按「事件 + ref」分配，`repo-manage:r` 缺失是预期形态）。
 *
 * 全部用例**不连平台**：探针的执行者是注入的 `run`，夹具是 `cnb … -v` 的真实信封形状。
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CODE,
  OIDC_PROBE,
  PROBES,
  classifyReply,
  formatReadout,
  invocationFor,
  main,
  probeAll,
} from "../scripts/ci-token-scopes.mjs";

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "ci-token-scopes.mjs");
const CONFIG = path.join(ROOT, ".cnb.yml");

type RunResult = { ok: boolean; status: number; out: string };
type Run = (cmd: string, args: string[]) => RunResult;

/** 平台信封（`cnb … -v` 的形状）：`status` 是**取到答复**的意思，与「有没有权限」无关。 */
const envelope = (status: number, data: unknown): string =>
  JSON.stringify({ status, trace: null, header: {}, data });

const granted = (): string => envelope(200, { name: "master" });
const denied = (scope: string): string =>
  envelope(403, {
    errcode: 10023,
    errmsg: `The token's authorization scope does not match this request. Missing required scopes: ${scope}`,
  });

/** 按参数里的子命令分流；`mapping` 没点到的走 `fallback`。 */
function fakeRun(mapping: Record<string, string>, fallback = granted()): Run {
  return (_cmd, args) => {
    const key = args
      .filter((a) => !a.startsWith("-"))
      .slice(0, 2)
      .join(" ");
    const out = mapping[key] ?? fallback;
    return {
      ok: !out.includes("10023"),
      status: out.includes("10023") ? 1 : 0,
      out,
    };
  };
}

describe("classifyReply：三句话的判据顺序", () => {
  it("原话点名缺哪一枚 ⇒ denied，且把那一枚抄下来", () => {
    expect(classifyReply(denied("repo-manage:r"))).toEqual({
      state: "denied",
      scope: "repo-manage:r",
    });
  });

  it("信封 200 ⇒ granted（业务层的 404 也走这一档：平台认了这次请求）", () => {
    expect(
      classifyReply(envelope(200, { errcode: 404, errmsg: "not found" })),
    ).toEqual({
      state: "granted",
      status: 200,
    });
  });

  it("程序根本没起来（`cnb` 不在 / 空输出）⇒ unknown，不是 granted", () => {
    expect(classifyReply("").state).toBe("unknown");
    expect(classifyReply("Error: spawn cnb ENOENT").state).toBe("unknown");
  });

  it("「没拿到答复」的四种成因各自念得出来（否则读数让人猜，ISSUE #2551 第四跑）", () => {
    /* 这一格存在的意义就是让人看出「是哪一种没量到」，所以那句话不许只有一种形状。 */
    expect(classifyReply("", { error: "ENOENT" }).why).toContain("起不来");
    expect(classifyReply("", { status: 1 }).why).toContain("没有输出");
    expect(classifyReply("not an envelope", { status: 0 }).why).toContain(
      "认不出形状",
    );
    expect(
      classifyReply(
        envelope(403, { errcode: 10023, errmsg: "scope mismatch" }),
        { status: 0 },
      ).why,
    ).toContain("403");
  });

  it("说了「缺 scope」但没写出名字 ⇒ denied，且如实标出「原话里没写出来」", () => {
    const r = classifyReply("Missing required scopes");
    expect(r.state).toBe("denied");
    expect(r.scope).toContain("没写出");
  });

  it("非 200 而原话里没有「缺 scope」⇒ unknown（既不是缺权限，也不是够得着），并把平台那句话带出来", () => {
    const r = classifyReply(
      envelope(403, { errcode: 10023, errmsg: "scope mismatch" }),
    );
    expect(r.state).toBe("unknown");
    expect(r.status).toBe(403);
    // 下一动作要靠这句原话才读得出来 —— 只念「没拿到答复」等于什么都没说。
    expect(r.why).toContain("scope mismatch");
    // 中文引号 / 双引号都不许漏成 JSON 片段（读数里那不是给人看的形状）。
    expect(r.why).not.toContain('"');
  });

  it("CI 上的现场：403 + 授权范围不匹配（没给 scope 名）⇒ unknown，不是获授权", () => {
    const raw = envelope(403, {
      errcode: 10023,
      errmsg: "The token's authorization scope does not match this request.",
    });
    const r = classifyReply(raw);
    expect(r.state).toBe("unknown");
    expect(r.why).toContain("403");
  });
});

describe("probeAll：每一条探针都只读，且仓库占位真的被替换", () => {
  it("表里没有一条写命令（这一格会在 PR / 每日 / 桌包三种触发口上跑）", () => {
    const WRITE =
      /^(create|put|post|patch|delete|update|add|close|open|transfer|archive|set)/i;
    for (const probe of PROBES) {
      const verb = probe.cmd[1] ?? "";
      expect(WRITE.test(verb), `${probe.cmd.join(" ")} 看起来是写命令`).toBe(
        false,
      );
    }
  });

  it("`--slug` / `--repo` 里的 `*` 被换成这个仓库，已有的不重复追加", () => {
    const seen: string[][] = [];
    const run: Run = (_cmd, args) => {
      seen.push(args);
      return { ok: true, status: 0, out: granted() };
    };
    probeAll({ repo: "a/b", run });
    for (const args of seen) {
      expect(args).not.toContain("*");
      expect(args.filter((a) => a === "--repo" || a === "--slug").length).toBe(
        1,
      );
      // 每条都带 `-v`：不带的时候平台只回摘要，403 的原话就没有 `errcode` 可读。
      expect(args).toContain("-v");
    }
  });

  it("OIDC 那一问默认不发；`oidc: true` 才进清单", () => {
    const run: Run = () => ({ ok: true, status: 0, out: granted() });
    expect(probeAll({ repo: "a/b", run }).length).toBe(PROBES.length);
    const withOidc = probeAll({ repo: "a/b", run, oidc: true });
    expect(withOidc.length).toBe(PROBES.length + 1);
    expect(withOidc.at(-1)?.domain).toBe(OIDC_PROBE.domain);
  });
});

describe("formatReadout：分组与「未获授权」的措辞", () => {
  const rows = (run: Run) => probeAll({ repo: "a/b", run });

  it("缺权限读成「未获授权 · 平台点名缺 X」，不是红", () => {
    const text = formatReadout(
      rows(
        fakeRun({
          "git-settings get-pipeline-settings": denied("repo-manage:r"),
        }),
      ),
      { repo: "a/b", event: "pull_request", branch: "feat/x" },
    ).join("\n");
    expect(text).toContain("未获授权 · 平台点名缺 repo-manage:r");
    expect(text).toContain("事件=pull_request");
    expect(text).toContain("红了不构成任何结论");
  });

  it("一条明确答复都没有的那一族念「没量到」，不许念成「获授权」（取不到 ≠ 够得着）", () => {
    const noReply: Run = () => ({
      ok: false,
      status: 1,
      out: envelope(403, { errcode: 10023, errmsg: "scope mismatch" }),
    });
    const lines = formatReadout(rows(noReply), {
      repo: "a/b",
      event: "pull_request",
      branch: "master",
    });
    const groupLines = lines.filter((l) => /^ {2}\S+\s{2,}/.test(l));
    expect(groupLines.length).toBeGreaterThan(5);
    for (const line of groupLines) {
      expect(line, `「${line}」把「没量到」念成了别的结论`).toContain("没量到");
    }
  });

  it("全部答「平台认了」⇒ 每一族念「获授权」，一项「缺 X」都不出现", () => {
    const lines = formatReadout(rows(fakeRun({})), {
      repo: "a/b",
      event: "push",
      branch: "master",
    });
    /* 族那一行是「两空格 + 族名 + 空白 + 结论」；探针行是四空格，别混进来。 */
    const groupLines = lines.filter((l) => /^ {2}\S+\s{2,}/.test(l));
    expect(groupLines.length).toBeGreaterThan(5);
    for (const line of groupLines) expect(line).toContain("获授权");
    // 「缺 <scope>」只由 *探针行* 说出来；答得出答复的那些探针一条都不该念它。
    expect(lines.filter((l) => l.includes("→ 缺 ")).length).toBe(0);
  });
});

describe("main：读数档的退码与「不打凭据」", () => {
  const heard: string[] = [];
  const run: Run = fakeRun({
    "git-settings get-pipeline-settings": denied("repo-manage:r"),
  });
  const invoke = (
    argv: string[],
    env: Record<string, string | undefined> = {},
  ) => {
    heard.length = 0;
    return main({
      argv,
      env: { CNB_REPO_SLUG: "a/b", CNB_TOKEN: "tk-must-never-appear", ...env },
      run,
      log: (s: string) => heard.push(s),
    });
  };

  it("缺权限不构成红：默认退 0（--strict 也不该因为「缺 repo-manage:r」退非零）", () => {
    expect(invoke([])).toBe(CODE.OK);
    expect(invoke(["--strict"])).toBe(CODE.OK);
  });

  it("平台那一跳不带 --strict：`--strict` 全是 403（PR 上的现场）时退 2 是它自己坏了 —— 所以平台的 .cnb.yml 不许带它", () => {
    /* ISSUE #2551 的第一跑读数（`cnb-vv9-1k60eb6vl`）：PR 那一族的令牌连
     * `repo-cnb-history:r` 都没有 ⇒ 14 条探针全 403、原话不带 `Missing required scopes`
     * ⇒ 全落 unknown ⇒ 带了 `--strict` 就红。那不是这一格坏了，那是它要量的东西。
     * 于是判据分两层：行为（`--strict` 确实退 2，留给手工自查）与**接线**（平台不许带）。 */
    const allDenied403: Run = () => ({
      ok: false,
      status: 1,
      out: envelope(403, {
        errcode: 10023,
        errmsg: "The token's authorization scope does not match this request.",
      }),
    });
    heard.length = 0;
    const code = main({
      argv: ["--strict"],
      env: { CNB_REPO_SLUG: "a/b" },
      run: allDenied403,
      log: (s) => heard.push(s),
    });
    expect(code).toBe(CODE.NO_FACT);

    const config = readFileSync(CONFIG, "utf8");
    const lines = config
      .split("\n")
      .filter((l) => l.includes("ci-token-scopes.mjs"));
    expect(lines.length, "三个入口各有一格，`.cnb.yml` 里应当出现三次").toBe(3);
    for (const line of lines) {
      expect(
        line,
        "平台那一跳带上 `--strict` 之后，PR 上会有一条永远红且没人能修的格子（ISSUE #2551）",
      ).not.toContain("--strict");
    }
  });

  it("一条探针都没拿到答复 ⇒ --strict 退 2（这一格自己坏了），默认仍退 0", () => {
    const dead: Run = () => ({ ok: false, status: -1, out: "" });
    heard.length = 0;
    const argv = ["--strict"];
    const code = main({
      argv,
      env: { CNB_REPO_SLUG: "a/b" },
      run: dead,
      log: (s: string) => heard.push(s),
    });
    expect(code).toBe(CODE.NO_FACT);
    expect(heard.join("\n")).toContain("自己坏了");
  });

  it("认不出仓库 ⇒ 没量到任何东西，且不乱猜一个仓库名", () => {
    heard.length = 0;
    const code = main({
      argv: ["--strict"],
      env: {},
      run,
      log: (s: string) => heard.push(s),
    });
    expect(code).toBe(CODE.NO_FACT);
    expect(heard.join("\n")).toContain("认不出仓库");
  });

  it("令牌值一个字节都不进日志（env 里有 CNB_TOKEN，读数里不许出现它）", () => {
    const text: string[] = [];
    main({
      argv: ["--json"],
      env: { CNB_REPO_SLUG: "a/b", CNB_TOKEN: "tk-must-never-appear" },
      run,
      log: (s: string) => text.push(s),
    });
    expect(text.join("\n")).not.toContain("tk-must-never-appear");
  });

  it("`--only` 只跑点名的族", () => {
    heard.length = 0;
    invoke(["--only", "repo-issue"]);
    const text = heard.join("\n");
    expect(text).toContain("repo-issue");
    expect(text).not.toContain("repo-manage");
  });
});

describe("起 `cnb` 的形态：CI 上那条「全部没拿到答复」的根因", () => {
  /* 平台**必须显式传**（ISSUE #2551 的第三跑读数）：判据自己跑在两边的宿主上
   * （本地 POSIX、平台 Windows），此前这几条读的是 `process.platform` —— 于是
   * 「POSIX 上怎么起」这条断言在 Windows 节点上恒假（`expected 'powershell'
   * to be 'cnb'`）。用例问的那件事与跑它的机器无关，判据就不该问机器。 */
  it("POSIX 上原样起（不套宿主、不改参数）", () => {
    const inv = invocationFor("cnb", ["git", "get-head"], {
      platform: "linux",
    });
    expect(inv.command).toBe("cnb");
    expect(inv.argv).toEqual(["git", "get-head"]);
  });

  it("非 `cnb` 的命令一律原样（这一格只起它，别顺手改了别的调用）", () => {
    for (const platform of ["win32", "linux"] as const) {
      expect(invocationFor("node", ["-v"], { platform }).command).toBe("node");
      expect(invocationFor("node", ["-v"], { platform }).argv).toEqual(["-v"]);
    }
  });

  it("Windows 上的形态来自盘上那三个垫片之一，且原始参数一个不改", () => {
    /* 这条不断言「一定不交裸名字」：三种垫片一个都找不到时它**必须**退回原样起
     * （那时 spawn 给一个可读的 ENOENT，读数记成「没拿到答复」，不冒充结论）。
     * 它钉的是另一件更要紧的事 —— 探针参数不被任何一路改写。 */
    const inv = invocationFor("cnb", ["git", "get-head"], {
      platform: "win32",
    });
    expect(inv.argv.slice(-2)).toEqual(["git", "get-head"]);
  });

  it("源码里不许回到裸 spawnSync 起 cnb —— 那是 CI 上 14 条探针全空的根因（ISSUE #2551）", () => {
    /* Windows 上 `cnb` 是三个垫片，`spawnSync("cnb")` 必 ENOENT / EINVAL，
     * 而失败形态是「没拿到答复」—— 读数看起来像权限问题，实际是这一格起不来。
     * 判据读源码：`run()` 必须经 `invocationFor()`。 */
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).toContain("invocationFor(cmd, args)");
    expect(src).not.toMatch(/spawnSync\(cmd,\s*args/);
  });
});

describe("入口本身：能被 node 直接执行（`cnb` 不在也不许抛栈）", () => {
  it("认不出仓库时打一行原因、按档退码，而不是抛栈", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--strict"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, CNB_REPO_SLUG: "", PATH: "" },
    });
    expect(`${r.stdout}${r.stderr}`).not.toContain("at ");
    expect(r.status).toBe(CODE.NO_FACT);
  });
});
