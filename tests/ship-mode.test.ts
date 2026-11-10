/**
 * `pnpm ship` 的**工作模式**单元档（ISSUE #3512）：词表、模式展开、确认应答三件。
 *
 * 这里只锁纯函数与 stdin 应答器；「模式展开后整条链怎么走」（auto 全链 / confirm
 * 拒绝合并 / 与单件动作互斥）钉在 `tests/ship.test.ts` 的 main() 集成档 —— 那边
 * 共用假执行者夹具，不在这里抄第二份。
 */
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  expandMode,
  makeStdinConfirm,
  MODE_BUNDLED_FLAGS,
  SHIP_MODES,
} from "../scripts/ship-mode.mjs";
import { parseArgs } from "../scripts/ship-args.mjs";

/** 造一份 parseArgs 的返回形状（与真解析同形，缺省值齐全）。 */
function optBase(mode: string | null = null) {
  return { mode, merge: false, closeIssue: false, cleanBranch: false };
}

/** 造一个注入式确认应答器：PassThrough 作 stdin / stdout，两路输出都进 chunks。 */
function confirmWith(input: string): {
  confirm: (l: string, d?: string) => Promise<boolean>;
  output: () => string;
} {
  const input$ = new PassThrough();
  const output$ = new PassThrough();
  const chunks: Array<string> = [];
  output$.on("data", (d: Buffer) => chunks.push(String(d)));
  const confirm = makeStdinConfirm({
    input: input$,
    output: output$,
    write: (s: string) => {
      chunks.push(s);
    },
  });
  input$.end(input);
  return { confirm, output: () => chunks.join("") };
}

describe("ship-mode 词表（唯一出处）", () => {
  it("只有 auto 与 confirm 两种，打包动作与三枚旗标一一对应", () => {
    expect(SHIP_MODES).toEqual(["auto", "confirm"]);
    expect(MODE_BUNDLED_FLAGS).toEqual(["--merge", "--close-issue", "--clean-branch"]);
  });
});

describe("expandMode：模式展开 = 人亲手给了那三枚旗标", () => {
  it("auto / confirm 都把三枚动作置真", () => {
    for (const mode of SHIP_MODES) {
      const opt = expandMode(optBase(mode));
      expect(opt.merge).toBe(true);
      expect(opt.closeIssue).toBe(true);
      expect(opt.cleanBranch).toBe(true);
    }
  });

  it("不给模式（null / 词表外的值）一个字节都不动 —— 默认档是现状", () => {
    expect(expandMode(optBase(null))).toEqual(optBase(null));
    const opt = expandMode(optBase("bogus"));
    expect(opt.merge).toBe(false);
    expect(opt.closeIssue).toBe(false);
    expect(opt.cleanBranch).toBe(false);
  });

  it("解析层：两种写法（空格 / 等号）都认，词表外与重复进 modeBad", () => {
    expect(parseArgs(["--mode", "auto"]).mode).toBe("auto");
    expect(parseArgs(["--mode=confirm"]).mode).toBe("confirm");
    expect(parseArgs(["--mode"]).modeBad.length).toBeGreaterThan(0);
    expect(parseArgs(["--mode", "yolo"]).modeBad.length).toBeGreaterThan(0);
    const twice = parseArgs(["--mode", "auto", "--mode=confirm"]);
    expect(twice.modeBad.some((s: string) => s.includes("重复"))).toBe(true);
    /* 显式旗标与模式可以共存（同一批键，并集语义归既有阶段表）。 */
    const mixed = parseArgs(["--mode", "auto", "--close-issue", "2179"]);
    expect(mixed.mode).toBe("auto");
    expect(mixed.closeIssueNumbers).toEqual([2179]);
  });
});

describe("makeStdinConfirm：fail-closed（拿不到「y」就是未授权）", () => {
  it("y / yes / Y ⇒ 同意", async () => {
    const answers = ["y\n", "yes\n", "Y\n", "  YES  \n"];
    const results = await Promise.all(
      answers.map(async (answer) => {
        const { confirm } = confirmWith(answer);
        return confirm("测试动作", "detail");
      }),
    );
    expect(results).toEqual([true, true, true, true]);
  });

  it("空行 / no / 别的字 ⇒ 未授权", async () => {
    const answers = ["\n", "no\n", "ok\n", "0\n"];
    const results = await Promise.all(
      answers.map(async (answer) => {
        const { confirm } = confirmWith(answer);
        return confirm("测试动作");
      }),
    );
    expect(results).toEqual([false, false, false, false]);
  });

  it("EOF（stdin 断流）⇒ 未授权，且把「按未授权处理」念出来", async () => {
    const { confirm, output } = confirmWith("");
    const agreed = await confirm("测试动作", "detail");
    expect(agreed).toBe(false);
    expect(output()).toContain("未授权");
  });

  it("提问带动作名、细节与 [y/N] 提示", async () => {
    const { confirm, output } = confirmWith("y\n");
    await confirm("合并 PR #7", "CI=success");
    const text = output();
    expect(text).toContain("合并 PR #7");
    expect(text).toContain("CI=success");
    expect(text).toContain("[y/N]");
  });
});
