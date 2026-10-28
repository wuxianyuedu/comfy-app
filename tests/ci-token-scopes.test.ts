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
const SCRIPT = path.join(ROOT, "scripts", "ci-token-scopes.mjs");

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
    const key = args.filter((a) => !a.startsWith("-")).slice(0, 2).join(" ");
    const out = mapping[key] ?? fallback;
    return { ok: !out.includes("10023"), status: out.includes("10023") ? 1 : 0, out };
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
    expect(classifyReply(envelope(200, { errcode: 404, errmsg: "not found" }))).toEqual({
      state: "granted",
      status: 200,
    });
  });

  it("程序根本没起来（`cnb` 不在 / 空输出）⇒ unknown，不是 granted", () => {
    expect(classifyReply("").state).toBe("unknown");
    expect(classifyReply("Error: spawn cnb ENOENT").state).toBe("unknown");
  });

  it("说了「缺 scope」但没写出名字 ⇒ denied，且如实标出「原话里没写出来」", () => {
    const r = classifyReply("Missing required scopes");
    expect(r.state).toBe("denied");
    expect(r.scope).toContain("没写出");
  });

  it("403 但原话不是「缺 scope」⇒ 不读成缺权限（那是另一种授权错误）", () => {
    const r = classifyReply(envelope(403, { errcode: 10023, errmsg: "scope mismatch" }));
    expect(r.state).toBe("granted");
    expect(r.status).toBe(403);
  });
});

describe("probeAll：每一条探针都只读，且仓库占位真的被替换", () => {
  it("表里没有一条写命令（这一格会在 PR / 每日 / 桌包三种触发口上跑）", () => {
    const WRITE = /^(create|put|post|patch|delete|update|add|close|open|transfer|archive|set)/i;
    for (const probe of PROBES) {
      const verb = probe.cmd[1] ?? "";
      expect(WRITE.test(verb), `${probe.cmd.join(" ")} 看起来是写命令`).toBe(false);
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
      expect(args.filter((a) => a === "--repo" || a === "--slug").length).toBe(1);
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
      rows(fakeRun({ "git-settings get-pipeline-settings": denied("repo-manage:r") })),
      { repo: "a/b", event: "pull_request", branch: "feat/x" },
    ).join("\n");
    expect(text).toContain("未获授权 · 平台点名缺 repo-manage:r");
    expect(text).toContain("事件=pull_request");
    expect(text).toContain("红了不构成任何结论");
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
  const invoke = (argv: string[], env: Record<string, string | undefined> = {}) => {
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
