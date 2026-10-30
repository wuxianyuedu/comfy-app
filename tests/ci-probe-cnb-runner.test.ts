/**
 * `cnb` 起不来时，这份探针要给**一行读数**，不是一段 Node 栈（ISSUE #2690）。
 *
 * 现场读数（立案当时，本机 Windows）：
 * `node scripts/ci-probe-lock-readout.mjs report <仓库> <sn>` → `EXIT=1`，屏幕上只有
 * `Error: spawnSync cnb ENOENT` 加七八行栈 —— 因为 `readBuild` 那句 `execFileSync`
 * **不在 `try` 里**（那个 `try` 只盖 `JSON.parse`）。而 `spawnSync` 在 Windows 上不按
 * `PATHEXT` 找 `.CMD` 垫片，`cnb` 在本地正是那份垫片：把 `node_modules/.bin` 加进 PATH
 * 也照样 ENOENT。平台那一档不受起来不影响（容器里 `cnb` 是真身），所以这一格从来不在 CI 读数面上。
 *
 * 修法选的是「复用现成那一格」：`scripts/ship-exec.mjs` 的 `makeRunner()`（经
 * `pnpmInvocation(args, {name:"cnb"})` 起得来），而不是新写一份垫片解析。
 * ⚠️ 刻意**不用**同一份模块里的 `cnbJson()` —— 它把「ENOENT / 没有 `{` / 解析失败」
 * 三种折叠成同一个 `null`，而本件要的恰恰是分清这三种（每种下一动作不同）。
 *
 * 全部经**真起命令那一层的假执行者**判结果形态：实测只注 `readBuild` 的取数出口时，
 * 把 `cnbCall` 里 `r.error` 那一支压成空串，用例**照旧全绿**（它绕过了映射发生的那一层），
 * 所以出口开在 `cnbCall` 的第二个参数上 —— 变异打不中的判据等于没有判据。
 * 不读源码字面量（同一口径见 ISSUE #2660）。
 */
import { describe, expect, it } from "vitest";

import { cnbCall, formatReadingRow, readBuild } from "../scripts/ci-probe-lock-readout.mjs";

/** `ExecResult` 形态（`makeRunner` 的返回）。 */
type Spawned = {
  status: number;
  stdout: string;
  stderr: string;
  error: string | null;
};

/** 造一个「这一次平台调用长成这样」的取数出口：走真的 `cnbCall`，只假最外面那一层。 */
const callWith = (result: Spawned) => (args: Array<string>) => cnbCall(args, () => result);

/** 起不来（本机实测的那一形）。 */
const ENOENT: Spawned = {
  status: -1,
  stdout: "",
  stderr: "",
  error: "ENOENT",
};

describe("`cnb` 起不来 → 一行读数，不是一段栈", () => {
  it("映射发生在起命令那一层：假执行者报 ENOENT ⇒ `cnbCall` 给出 failure 而不是抛", () => {
    expect(() => cnbCall(["build", "get-build-status", "-v"], () => ENOENT)).not.toThrow();
    expect(cnbCall(["-v"], () => ENOENT).failure).toBe("cnb 起不来：ENOENT");
  });

  it("假执行者非零退出 ⇒ failure 带退出码，且把 stderr 一起念（只接 stdout 会没有理由）", () => {
    const r = cnbCall(["-v"], () => ({
      status: 1,
      stdout: "",
      stderr: "Error: not found",
      error: null,
    }));
    expect(r.failure).toBe("cnb 退 1");
    expect(r.text).toContain("Error: not found");
  });

  it("退 0 那一路形状与改前逐字一致：failure 空、text 只给 stdout", () => {
    expect(
      cnbCall(["-v"], () => ({
        status: 0,
        stdout: "正文",
        stderr: "进度",
        error: null,
      })),
    ).toEqual({ failure: "", text: "正文" });
  });

  it("正向：`readBuild` 不抛，且把原因落成 `note`", () => {
    /* 用 try/catch 而不是 `expect(fn).not.toThrow()` 再把结果赋给局部变量：
     * 后者在类型上是「闭包里赋值，外面不知道有没有赋上」（TS18048 实测两次红），
     * 而这一格判的恰恰是「冒成异常」与「给出一行读数」的区别 —— catch 到的东西
     * 直接当断言值念出来，红了能一眼看出是栈而不是读数。 */
    let thrown: unknown = null;
    let reading;
    try {
      reading = readBuild("moon-read/comfy-app-t3", "cnb-abc-1", callWith(ENOENT));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeNull();
    expect(reading?.status).toBe("(取不到)");
    expect(reading?.note).toBe("cnb 起不来：ENOENT");
  });

  it("那一行念得出原因（与 #2675 立起来的打印同一处判）", () => {
    const line = formatReadingRow(
      readBuild("moon-read/comfy-app-t3", "cnb-abc-1", callWith(ENOENT)),
    );
    expect(line).toContain("status=(取不到)");
    expect(line).toContain("（cnb 起不来：ENOENT）");
  });

  it("三种取不到的原因互不相同（拿读数的人能据此选下一动作）", () => {
    const rows = [
      readBuild("r", "sn-1", callWith(ENOENT)),
      readBuild(
        "r",
        "sn-2",
        callWith({
          status: 1,
          stdout: "",
          stderr: '{"message":"unauthorized"}',
          error: null,
        }),
      ),
      readBuild(
        "r",
        "sn-3",
        callWith({
          status: 0,
          stdout: "<html>502</html>",
          stderr: "",
          error: null,
        }),
      ),
    ];
    const notes = rows.map((x) => x.note);
    expect(new Set(notes).size).toBe(3);
    expect(notes[0]).toContain("起不来");
    expect(notes[1]).toContain("退 1");
    expect(notes[2]).toContain("响应不是 JSON");
  });

  it("成功那一路形状没被这次改动带偏：`note` 仍是空串、`status` 取原值", () => {
    const r = readBuild(
      "r",
      "sn-5",
      callWith({
        status: 0,
        stdout: JSON.stringify({
          status: 200,
          data: { status: "success", pipelinesStatus: {} },
        }),
        stderr: "",
        error: null,
      }),
    );
    expect(r.status).toBe("success");
    expect(r.note).toBe("");
    expect(formatReadingRow(r)).not.toContain("（）");
  });
});
