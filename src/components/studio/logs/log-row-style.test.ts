// @vitest-environment jsdom
/**
 * 日志行样式与**选区判定**的纯逻辑（ISSUE #262 复审）。
 *
 * 用户反馈：「日志到上限了还继续产生新日志，面板中显示的内容就不断移动，我想复制
 * 其中某一项十分困难，甚至无法选择，刚选择就刷新把我的选择弄没了」。
 *
 * 一半的解法在 store（贴底基线不再追着最新跑），另一半在这里：
 * 贴底前要问一句「用户是不是正在框选日志正文」，正在框就不动滚动位置。
 * 这条判据是纯函数（规范 17 第①层），可脱离浏览器直接断言；真实浏览器里的
 * 「框住之后内容不再自己上移」由规范 07 §7.22 的现场复核兜底。
 */
import { describe, expect, it } from "vitest";

import {
  LOG_ROW_TEXT_ATTRIBUTE,
  selectionInsideLogs,
  tokenizeRow,
  type SelectionLike,
} from "./log-row-style";

/** 造一段带行正文标记的 DOM（与 LogRow 渲染出来的结构一致）。 */
function renderRows(): { inRow: Text; outside: Text } {
  document.body.innerHTML = `
    <div class="panel">
      <div data-log-index="0">
        <span ${LOG_ROW_TEXT_ATTRIBUTE}>第一行日志内容</span>
      </div>
    </div>
    <p id="other">页面里别的文本</p>
  `;
  return {
    inRow: /* SAFETY: 类型断言已复核 */ document.querySelector(`[${LOG_ROW_TEXT_ATTRIBUTE}]`)!
      .firstChild as Text,
    outside: /* SAFETY: 类型断言已复核 */ document.querySelector("#other")!.firstChild as Text,
  };
}

/** 「用户框了某段文本」的最小选区视图。 */
function selectionOn(node: Node | null, collapsed = false): SelectionLike {
  return {
    rangeCount: node ? 1 : 0,
    anchorNode: node,
    focusNode: node,
    isCollapsed: collapsed,
  };
}

describe("selectionInsideLogs 选区是否落在日志正文里", () => {
  it("选在日志行的文本节点上 → true（复制日志时的常见形态）", () => {
    const { inRow } = renderRows();
    expect(selectionInsideLogs(selectionOn(inRow))).toBe(true);
  });

  it("选在日志行元素本身上 → true（浏览器给的是元素端点）", () => {
    const { inRow } = renderRows();
    const element = /* SAFETY: 类型断言已复核 */ (inRow.parentElement ?? inRow) as Node;
    expect(selectionInsideLogs(selectionOn(element))).toBe(true);
  });

  it("选在页面里别的文本上 → false（不该因为别处的选区就停止贴底）", () => {
    const { outside } = renderRows();
    expect(selectionInsideLogs(selectionOn(outside))).toBe(false);
  });

  it("折叠选区（只是点了一下光标）不算在框选 → false", () => {
    const { inRow } = renderRows();
    expect(selectionInsideLogs(selectionOn(inRow, true))).toBe(false);
  });

  it("取不到选区（jsdom / 无选区 API）→ false，不因此整体关掉贴底", () => {
    expect(selectionInsideLogs(null)).toBe(false);
    expect(
      selectionInsideLogs({
        rangeCount: 0,
        anchorNode: null,
        focusNode: null,
        isCollapsed: false,
      }),
    ).toBe(false);
  });
});

/* ── 词法上色里的路径区间：与「可点」那一层同源（用户贴图那行）─────────────
 *
 * 事故形状：启动器回显的命令行里 `pwsh.EXE` / `pnpm.ps1` 都在带空格的路径上
 * （`C:\Program Files\…`），而上色层自己持了一份路径正则（`[^\s]*` 吃到第一个
 * 空格就停）—— 于是画出来的紫字是 `C:\Program`，后半截 ` Files\…` 是普通字。
 *
 * 真正被点到的更糟：可点那一层（`LogRow` 的 `PathLinkedText`）是在**分片之内**做
 * 识别的，切碎的路径等于「识别不到」—— 面板给出一个指向 `C:\Program` 的按钮，
 * 而它不是一个存在的目录（点了只会得到「找不到可在文件管理器里打开的路径」）。
 *
 * 所以判据不是「上色好不好看」，而是**两层必须同源**：路径区间取自
 * `findLogPathTokens`（唯一事实来源），一条路径恒在**一个**分片里完整落地。
 */
describe("词法上色里的路径区间", () => {
  /** 用户贴图那行命令回显（两个带空格的路径 + 一堆开关）。 */
  const ECHO =
    '>>> "C:\\Program Files\\PowerShell\\7\\pwsh.EXE" -NoProfile -ExecutionPolicy Bypass -File "D:\\Program Files\\nodejs\\pnpm.ps1" -v';

  it("带空格的路径整条上色，不在第一个空格处断开", () => {
    expect(
      tokenizeRow(ECHO)
        .filter((token) => token.style !== undefined)
        .map((token) => token.text),
    ).toEqual([
      "C:\\Program Files\\PowerShell\\7\\pwsh.EXE",
      "D:\\Program Files\\nodejs\\pnpm.ps1",
    ]);
  });

  it("分片拼回去逐字等于原文（切分不许吃字，也不出重复段）", () => {
    for (const line of [
      ECHO,
      "项目根: F:\\AI\\Other\\comfy-app-t3-branch4",
      "[OK] 阶段: 壳已接手（双击 app.exe）",
      "见 https://cnb.cool/moon-read/comfy-app-t3/-/issues/1365",
    ]) {
      expect(
        tokenizeRow(line)
          .map((token) => token.text)
          .join(""),
        line,
      ).toBe(line);
    }
  });

  it("URL 与散文不上路径色（区间不越权）", () => {
    const styles = new Set(
      tokenizeRow("见 https://cnb.cool/a/b/c 与 count 1769 / 0 / 3")
        .filter((token) => token.style === "magenta-bright")
        .map((token) => token.text),
    );
    expect([...styles]).toEqual([]);
  });

  it("时间戳 / 标签 / URL 那几档的上色不受影响（路径改造别动到它们）", () => {
    expect(
      tokenizeRow("[17:43:16] INFO [OK] 阶段: 壳已接手 http://x/y").map((t) => [t.text, t.style]),
    ).toEqual([
      ["[17:43:16]", "gray"],
      [" INFO ", undefined],
      ["[OK]", "green-bright"],
      [" 阶段: 壳已接手 ", undefined],
      ["http://x/y", "blue-bright"],
    ]);
  });
});
