/**
 * 回归判据：「这份检出是谁」的取值链（ISSUE #2355）。
 *
 * 这一格过去是三个读者各自回答一遍（`ship` 念「未配」、`ship-claim` 直接退 2、
 * `env-init` 补一个空值），照提示做过一遍的人最后仍然没有名字。本用例钉四件事：
 *
 *   · 顺位：人填的（进程环境 / `.env`）→ 平台运行身份 → `git config user.name` → `cnb`；
 *   · **不取平台账号昵称**：`CNB_BUILD_USER_NICKNAME` 是人，不是这份检出的名字；
 *   · `env-init` 往 `.env` 里写的是**取到的值**，且与 `ship` 念的同源；
 *   · 机器自起的账用自己的名字（`machineHandle`），宿主有 NPC 名时带上它。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEV_HANDLE_ENV_KEY,
  HANDLE_SOURCES,
  PLATFORM_HANDLE_KEYS,
  SETTLED_FALLBACK,
  devHandle,
  devHandleForEnvFile,
  explicitDevHandle,
  machineHandle,
  resolveDevHandle,
} from "../scripts/dev-handle.mjs";
import { readDevHandleWithSource } from "../scripts/ship-ticket.mjs";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-handle-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** 写一份 `.env`（只在需要时）。 */
function writeEnv(text: string): void {
  fs.writeFileSync(path.join(root, ".env"), text, "utf8");
}

describe("resolveDevHandle：取值链的第一个非空者胜出", () => {
  it("① 进程环境优先于 `.env`，且头尾空白吃掉", () => {
    writeEnv(`${DEV_HANDLE_ENV_KEY}="from-file"\n`);
    const r = resolveDevHandle({
      root,
      env: { [DEV_HANDLE_ENV_KEY]: "  from-env  " },
    });
    expect(r).toEqual({
      name: "from-env",
      source: HANDLE_SOURCES.processEnv,
      explicit: true,
    });
  });

  it("① 其次才是本检出的 `.env`（引号 / 行尾注释都算对）", () => {
    writeEnv(`${DEV_HANDLE_ENV_KEY}="yuedu-win" # 留痕\n`);
    expect(resolveDevHandle({ root, env: {} })).toEqual({
      name: "yuedu-win",
      source: HANDLE_SOURCES.dotenv,
      explicit: true,
    });
  });

  it("② 没填 ⇒ 取平台给的运行身份，并标记成「取的」而不是「你填的」", () => {
    const r = resolveDevHandle({ root, env: { CNB_NPC_NAME: "CodeBuddy" } });
    expect(r.name).toBe("CodeBuddy");
    expect(r.source).toBe("CNB_NPC_NAME");
    expect(r.explicit).toBe(false);
    expect(HANDLE_SOURCES.explicit.has(r.source)).toBe(false);
  });

  it("② NPC 名先于 token 用户名：前者是「这次会话是谁」，后者只是拿谁的 token", () => {
    expect(
      resolveDevHandle({
        root,
        env: { CNB_NPC_NAME: "CodeBuddy", CNB_TOKEN_USER_NAME: "cnb" },
      }).source,
    ).toBe("CNB_NPC_NAME");
    expect(
      resolveDevHandle({ root, env: { CNB_TOKEN_USER_NAME: "cnb" } }).name,
    ).toBe("cnb");
  });

  it("负控制：平台账号**昵称**不参与取值（它是人，不是这份检出的名字）", () => {
    // 这一条是 #2314 / #2310 / #2294 的根因：机器建的单挂着 `提单人:月读`。
    expect(PLATFORM_HANDLE_KEYS).not.toContain("CNB_BUILD_USER_NICKNAME");
    const r = resolveDevHandle({
      root,
      env: { CNB_BUILD_USER_NICKNAME: "月读", CNB_BUILD_USER: "月读" },
    });
    expect(r.name).not.toBe("月读");
  });

  it("④ 谁都取不到 ⇒ 兜底 `cnb`，**不抛、不返回空串**", () => {
    const r = resolveDevHandle({ root, env: {} });
    // 本机可能配了 `git config user.name`（③ 那一档），所以只钉「一定有值且说得清来源」。
    expect(r.name.trim()).not.toBe("");
    expect(["git config user.name", "兜底"]).toContain(r.source);
    expect(SETTLED_FALLBACK).toBe("cnb");
    // 没有 `.env` 也不许抛（CI / 干净检出是常态）。
    expect(() =>
      resolveDevHandle({ root: path.join(root, "none"), env: {} }),
    ).not.toThrow();
  });

  it("`devHandle` 是同一个答案的短形态（不许出现第二套口径）", () => {
    writeEnv(`${DEV_HANDLE_ENV_KEY}="same"\n`);
    expect(devHandle({ root, env: {} })).toBe(
      resolveDevHandle({ root, env: {} }).name,
    );
  });
});

describe("devHandleForEnvFile：写进 `.env` 的是取到的值，不是空值", () => {
  it("进程环境给了就写它；否则走平台身份 / git 名 / 兜底", () => {
    expect(
      devHandleForEnvFile({ root, env: { [DEV_HANDLE_ENV_KEY]: "manual" } }),
    ).toEqual({ name: "manual", source: HANDLE_SOURCES.processEnv });
    expect(
      devHandleForEnvFile({ root, env: { CNB_NPC_NAME: "CodeBuddy" } }),
    ).toEqual({ name: "CodeBuddy", source: "CNB_NPC_NAME" });
    expect(devHandleForEnvFile({ root, env: {} }).name.trim()).not.toBe("");
  });

  it("不读 `.env` 自己：正要写它，读到空值没有意义（也不许把旧值抄回来当「取的」）", () => {
    writeEnv(`${DEV_HANDLE_ENV_KEY}="stale"\n`);
    // 这一档只看进程环境与平台身份 ⇒ 拿不到 `.env` 里那个旧值。
    expect(
      devHandleForEnvFile({ root, env: { CNB_NPC_NAME: "CodeBuddy" } }).name,
    ).toBe("CodeBuddy");
  });
});

describe("machineHandle：机器自起的账用自己的名字", () => {
  it("宿主没给 NPC 名 ⇒ 就是前缀本身（`ci-daily` 而不是某个人的昵称）", () => {
    expect(machineHandle("ci-daily", {})).toBe("ci-daily");
  });

  it("宿主给了 NPC 名 ⇒ 带上它，仍以「这是机器的账」打头", () => {
    expect(machineHandle("ci-daily", { CNB_NPC_NAME: "CodeBuddy" })).toBe(
      "ci-daily:CodeBuddy",
    );
    expect(machineHandle("ci-pr", { CNB_NPC_NAME: " CodeBuddy " })).toBe(
      "ci-pr:CodeBuddy",
    );
  });

  it("负控制：传进平台账号昵称也不改变结果（不取人的名字）", () => {
    expect(
      machineHandle("ci-daily", {
        CNB_BUILD_USER_NICKNAME: "月读",
        CNB_BUILD_USER: "月读",
      }),
    ).toBe("ci-daily");
  });
});

describe("readDevHandleWithSource：ship 念的那一格与取值链同源", () => {
  it("把来源一起带出来（`--whoami` 与阶段 0 靠它区分「填的 / 取的」）", () => {
    const r = readDevHandleWithSource({
      root,
      env: { CNB_NPC_NAME: "CodeBuddy" },
    });
    expect(r).toEqual({
      name: "CodeBuddy",
      source: "CNB_NPC_NAME",
      explicit: false,
    });
  });
});

/* ── 链接 worktree 的 `.env` 回落（ISSUE #2833）──────────────────────────────
 * 现场：为隔离并行工作流用 `git worktree add` 挂分支收尾时，worktree 里**天然没有**
 * `.gitignore` 掉的 `.env`，取值链跌到 `git config user.name` —— 「我是谁」答错人，
 * 关单收尾的自动释放被跳过。修法：本检出根读不到该键时，顺着 `git rev-parse
 * --git-common-dir` 找主检出的 `.env` 再读一次；source 说出来路，仍算「人填的」。
 * 判据用**真 git**（spawn 那一刀不在注入面上，mock 它等于没测到 common-dir 的判据）。 */
describe("链接 worktree 的 .env 回落（ISSUE #2833）", () => {
  let mainRoot: string;
  let wtRoot: string;
  const made: Array<string> = [];

  function git(cwd: string, args: Array<string>): void {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) {
      throw new Error(`git ${args.join(" ")} 失败：${r.stderr}`);
    }
  }

  beforeEach(() => {
    mainRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dev-handle-main-"));
    wtRoot = path.join(mainRoot, "..", path.basename(mainRoot) + "-wt");
    made.push(mainRoot, wtRoot);
    git(mainRoot, ["init", "-q"]);
    git(mainRoot, ["config", "user.email", "t@example.test"]);
    git(mainRoot, ["config", "user.name", "t"]);
    fs.writeFileSync(path.join(mainRoot, "a.txt"), "x", "utf8");
    git(mainRoot, ["add", "a.txt"]);
    git(mainRoot, ["commit", "-q", "-m", "init"]);
    git(mainRoot, ["worktree", "add", "-q", wtRoot]);
  });

  afterEach(() => {
    for (const dir of made) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    made.length = 0;
  });

  it("worktree 根没有 .env ⇒ 读主检出的，source 说出「主检出」，且算人填的", () => {
    fs.writeFileSync(path.join(mainRoot, ".env"), "COMFYAPP_DEV_HANDLE=e-win\n", "utf8");
    const r = resolveDevHandle({ root: wtRoot, env: {} });
    expect(r.name).toBe("e-win");
    expect(r.source).toBe(HANDLE_SOURCES.dotenvMain);
    expect(r.explicit).toBe(true);
    /* 两个读「人填过没有」的口子必须看到同一个 `.env` 面（分叉 = 一半口子还在漏）。 */
    expect(explicitDevHandle({ root: wtRoot, env: {} })).toBe("e-win");
  });

  it("主检出自己不受影响：source 仍是 .env", () => {
    fs.writeFileSync(path.join(mainRoot, ".env"), "COMFYAPP_DEV_HANDLE=e-win\n", "utf8");
    const r = resolveDevHandle({ root: mainRoot, env: {} });
    expect(r.source).toBe(HANDLE_SOURCES.dotenv);
    expect(r.explicit).toBe(true);
  });

  it("两边都没有 ⇒ 照旧跌取值链（不因回落档改变既有顺位）", () => {
    const r = resolveDevHandle({ root: wtRoot, env: {} });
    expect(r.name).toBe("t"); // 临时仓的 local git config user.name
    expect(r.source).toBe("git config user.name");
    expect(r.explicit).toBe(false);
  });

  it("worktree 里进程环境仍然最优先（回落档排在人填之后）", () => {
    fs.writeFileSync(path.join(mainRoot, ".env"), "COMFYAPP_DEV_HANDLE=e-win\n", "utf8");
    const r = resolveDevHandle({ root: wtRoot, env: { COMFYAPP_DEV_HANDLE: "proc-win" } });
    expect(r.name).toBe("proc-win");
    expect(r.source).toBe(HANDLE_SOURCES.processEnv);
  });
});
