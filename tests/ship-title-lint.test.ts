/**
 * ship 标题形态合规（ISSUE #4527）的判据。这一格失效是**静默**的：形态写错的标题
 * 照样落进 PR 页面与 squash 历史；#号认领形态写错时关单格静默跳过（#4524 现场：
 * `（#4519/#4520）` 斜杠分隔 ⇒ 关单退 2，靠人工 patch 标题才补关）。所以这里判
 * 「纯函数对每种违规形状红、对合规形状绿」，且认领形态的判定与 ship-close **同一份**
 * —— 斜杠样例钉住「标题里看得见 #号 ≠ 关单格认得出认领」这个根因。
 */
import { describe, expect, it, vi } from "vitest";

import { claimNumbersFromTitle } from "../scripts/ship/ship-close.mjs";
import { pickTitle, titleLintViolations } from "../scripts/ship/ship-title.mjs";

describe("标题形态合规：合规形状全绿", () => {
  it("类型(范围): 描述，无单号", () => {
    expect(titleLintViolations("fix(cli): 修正参数解析")).toEqual([]);
  });

  it("无范围、[WIP] 前缀、全角括号、空格/逗号分隔多号，都合规", () => {
    expect(titleLintViolations("feat: 支持标题合规检查")).toEqual([]);
    expect(titleLintViolations("[WIP] feat(pipeline): 支持自定义构建缓存")).toEqual([]);
    expect(titleLintViolations("feat(dx): 标题先过合规检查（#4519 #4520）")).toEqual([]);
    expect(titleLintViolations("fix(deps): 收口依赖同步（#4109，#4116）")).toEqual([]);
    expect(titleLintViolations("fix(x): 引用编号 (#2648) 也是括号认领形态")).toEqual([]);
  });

  it("72 字符恰好合规、73 字符红（上限是硬的）", () => {
    const prefix = "feat(ship): ";
    const ok = `${prefix}${"好".repeat(72 - prefix.length)}`;
    expect(titleLintViolations(ok)).toEqual([]);
    expect(titleLintViolations(`${ok}好`).some((v) => v.includes("72"))).toBe(true);
  });
});

describe("标题形态合规：违规形状逐条红", () => {
  it("空标题", () => {
    expect(titleLintViolations("")).toHaveLength(1);
    expect(titleLintViolations("   ")).toHaveLength(1);
  });

  it("缺类型前缀 / 类型不在词表 / 冒号后没描述", () => {
    expect(titleLintViolations("更新一下代码").some((v) => v.includes("类型"))).toBe(true);
    expect(titleLintViolations("update: 更新代码").some((v) => v.includes("类型"))).toBe(true);
    expect(titleLintViolations("fix:").some((v) => v.includes("类型"))).toBe(true);
  });

  it("斜杠分隔的认领（#4524 现场）—— #号在标题里、关单格却认不得 ⇒ 红", () => {
    const title = "feat(dx): 标题先过合规检查（#4519/#4520）";
    /* 根因自证：同一份判定里，斜杠形态提取不出认领号 —— 这正是关单格静默跳过的原因。 */
    expect(claimNumbersFromTitle(title)).toEqual([]);
    const violations = titleLintViolations(title);
    expect(violations.some((v) => v.includes("#4519"))).toBe(true);
    expect(violations.some((v) => v.includes("#4520"))).toBe(true);
  });

  it("裸写 #号（引用形态）也红 —— 编号要么进认领括号、要么进正文", () => {
    const violations = titleLintViolations("fix(reliability): 收紧 #3910 外部请求超时");
    expect(violations.some((v) => v.includes("#3910"))).toBe(true);
  });
});

describe("pickTitle 的接线：违规当场退 2，不往下走", () => {
  const fakeRun = () => ({ stdout: "任意标题行", status: 0, stderr: "", error: null });

  it("合规标题原样返回（来源 flag）", () => {
    const t = pickTitle({
      run: fakeRun,
      log: () => undefined,
      baseRef: null,
      explicit: "fix(cli): 修正参数解析",
    });
    expect(t.title).toBe("fix(cli): 修正参数解析");
    expect(t.source).toBe("flag");
  });

  it("不合规标题 ⇒ process.exit(2)（NOT_RUN：这一跳没有结论）", () => {
    /* mock 让 exit 抛哨兵而不是真退（返回 never 的合法写法是抛，不是断言转型）；
     * pickTitle 不接这个错 ⇒ 哨兵从它身上冒出来 = 「走到 exit 那一行」的证明。 */
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit 哨兵");
    });
    const lines: Array<string> = [];
    expect(() =>
      pickTitle({
        run: fakeRun,
        log: (s: string) => lines.push(s),
        baseRef: null,
        explicit: "更新一下代码",
      }),
    ).toThrow("process.exit 哨兵");
    /* 断言在 mockRestore 之前：restore 会把 mock 的调用记录一并清掉，
     * 先 restore 再断言看到的是「0 次」—— 不是没调，是账被抹了。 */
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(lines.some((l) => l.includes("标题不合规"))).toBe(true);
    exitSpy.mockRestore();
  });
});
