/**
 * 平台侧「装依赖」这一跳的**跳过判据**（ISSUE #1981 收尾）。
 *
 * 为什么这条判据必须有：`.cnb.yml` 里那一步的逻辑**一条判据都测不到它**（配置只在
 * 平台上跑，本地一个执行者都没有）—— 这条链上已经为此付过两次学费（§13.5.3.5 里
 * 那两段就地 PowerShell 都红过）。所以判定收在 `scripts/ci-install-deps.mjs`，
 * 这里用注入的「变更清单 + 盘上有没有 node_modules」直接跑它，不碰真网络、不碰真安装。
 *
 * 判的是三个方向，每一个都有自己的失效形态：
 *
 *   ① **该装的时候必须装** —— 依赖面被碰、`node_modules` 不在、拿不到变更清单。
 *      失效形态最贵：拿一个陈旧的 `node_modules` 去跑门禁，红法全在别处（§13.5.13 同族）。
 *   ② **不该装的时候必须跳过** —— 一行 `src/` 都不碰的 PR 不该为一跳空操作付钱。
 *      失效形态是「收窄看起来做了、其实一次都没生效」。
 *   ③ **「退 0 但清单为空」不等于「没变」** —— PR 事件上三点 diff 的空集形态退 0，
 *      照「退 0 就采信」会把它读成「什么都没变」（见 `changedFiles` 里那段 ⚠️）。
 *
 * 口径见规范 §13.5.20。
 */
import { describe, expect, it } from "vitest";

import {
  DEP_FILES,
  changedFiles,
  decideInstall,
  main,
} from "../scripts/ci-install-deps.mjs";

/** 造一个「git 调用」替身：按参数给出退出码与 stdout。 */
const gitStub =
  (byArgs: Record<string, { status: number; stdout: string }>) =>
  (args: string[]) =>
    byArgs[args.join(" ")] ?? { status: 1, stdout: "" };

/** 造一个「安装」替身：只记有没有被调用。 */
function installStub() {
  let calls = 0;
  return {
    run: () => {
      calls += 1;
      return 0;
    },
    get calls() {
      return calls;
    },
  };
}

describe("依赖面清单", () => {
  it("覆盖 pnpm install 读的那几份（判窄了 = 拿陈旧 node_modules 跑门禁）", () => {
    for (const f of [
      "pnpm-lock.yaml",
      "package.json",
      "pnpm-workspace.yaml",
      "next.config.js",
    ]) {
      expect(DEP_FILES, `${f} 应在依赖面里`).toContain(f);
    }
  });
});

describe("decideInstall：该装 / 该跳过的三个方向", () => {
  it("依赖面被碰过 ⇒ 装（并点名碰了哪几个）", () => {
    const v = decideInstall({
      files: ["README.md", "pnpm-lock.yaml"],
      installed: true,
    });
    expect(v.install).toBe(true);
    expect(v.why).toContain("pnpm-lock.yaml");
  });

  it("node_modules 不在 ⇒ 装（跳过的前提是它真在）", () => {
    expect(decideInstall({ files: [], installed: false }).install).toBe(true);
  });

  it("拿不到变更清单 ⇒ 装（「不知道」不是「没变」）", () => {
    const v = decideInstall({ files: null, installed: true });
    expect(v.install).toBe(true);
    expect(v.why).toContain("不知道");
  });

  it("只改了无关文件且 node_modules 在 ⇒ 跳过", () => {
    const v = decideInstall({
      files: ["src/lib/a.ts", "docs/README.md", "changelog.d/x.md"],
      installed: true,
    });
    expect(v.install).toBe(false);
  });
});

describe("changedFiles：清单为空与「命令退 0」不是同一件事", () => {
  it("三点 diff 退 0 但回空 ⇒ 继续试下一条，最终回 null（交给 decideInstall 去装）", () => {
    /* PR 事件上 `origin/<target>...HEAD` 在「源分支就基于目标分支」时是这个形状 ——
     * 照「退 0 就采信」会把它读成「什么都没变」，于是依赖面被碰过的那次 PR 跳过安装。 */
    const files = changedFiles(
      gitStub({
        "diff --name-only origin/master...HEAD": { status: 0, stdout: "" },
      }),
    );
    expect(files).toBeNull();
  });

  it("命中时保留清单并按 POSIX 分隔符归一（Windows 输出是反斜杠）", () => {
    const files = changedFiles(
      gitStub({
        "diff --name-only origin/master...HEAD": {
          status: 0,
          stdout: "pnpm-lock.yaml\r\nsrc\\lib\\a.ts\r\n",
        },
      }),
    );
    expect(files).toEqual(["pnpm-lock.yaml", "src/lib/a.ts"]);
  });
});

describe("main：装 / 跳过两条出口的退出码", () => {
  it("跳过时不调用安装，且退 0", () => {
    const inst = installStub();
    const code = main({
      run: gitStub({
        "diff --name-only origin/master...HEAD": {
          status: 0,
          stdout: "docs/README.md\n",
        },
      }),
      install: inst.run,
    });
    expect(code).toBe(0);
    /* `node_modules` 在本仓是装好的（判据自己也跑在它上面），所以这一格走到「跳过」。 */
    expect(inst.calls).toBe(0);
  });

  it("要装时调用一次安装，退出码原样透出", () => {
    let calls = 0;
    const code = main({
      run: gitStub({
        "diff --name-only origin/master...HEAD": {
          status: 0,
          stdout: "pnpm-lock.yaml\n",
        },
      }),
      install: () => {
        calls += 1;
        return 1;
      },
    });
    expect(calls).toBe(1);
    expect(code).toBe(1);
  });
});
