/**
 * `ui/select` 在 base-ui 之上做过的那几处**有意改动**（文件头带 `ui-customized` 标记）。
 *
 * 故事面能看见它长什么样，但看不见「我们把基元的哪个默认关掉了」—— 而那正是
 * 三处事故的全部所在：
 *
 * 1. **层级必须给在定位层（Positioner）上**，默认 `z-popup`：Popup 自己的
 *    `z-*` 只在 positioner 建立的 stacking context **内部**生效，改它解决不了
 *    「模态遮罩里的下拉画得出来却收不到指针事件」（ISSUE #262）。所以这条
 *    判的不是样式好看，是**能不能点**。
 * 2. **`alignItemWithTrigger` 默认 `false`**：base-ui 的原生默认是 `true`，它把
 *    已选项对齐到触发器 ⇒ 弹层位置随选中项上下移动，选中末尾项时弹层被顶出
 *    视口（工作流库页头筛选下拉的用户实测）。`ui/select-menu` 那份用例钉的是
 *    **包装件**的用法，这件是基座 —— 基座的默认值漂了会一起带走 33 处消费点。
 * 3. **`size` 两档**住在 `data-size` 上（`data-[size=sm]:h-7` 与
 *    `data-[size=default]:h-8` 全靠这个属性命中）。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

const OPTIONS = /* SAFETY: 类型断言已复核 */ ["png", "jpg", "webp"] as const;

function Demo({
  defaultValue = "png",
  onValueChange,
  size = "default",
  positionerClassName,
  alignItemWithTrigger,
}: {
  defaultValue?: string;
  /* 实参形状从基元的 props 类型上取，不在这里手抄一份：base-ui 的回传是
     `(value: string | null, eventDetails) => void`，自己写 `(value: string) => void`
     在 `tsc` 那一层就是不兼容的。 */
  onValueChange?: React.ComponentProps<typeof Select>["onValueChange"];
  size?: "sm" | "default";
  positionerClassName?: string;
  alignItemWithTrigger?: boolean;
}) {
  return (
    <Select defaultValue={defaultValue} onValueChange={onValueChange}>
      <SelectTrigger size={size} aria-label="输出格式">
        <SelectValue placeholder="选一个格式" />
      </SelectTrigger>
      <SelectContent
        positionerClassName={positionerClassName}
        alignItemWithTrigger={alignItemWithTrigger}
      >
        {OPTIONS.map((value) => (
          <SelectItem key={value} value={value}>
            {value.toUpperCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const POPUP_MARK = '[data-slot="select-content"]';

/**
 * 打开下拉并返回弹层（Popup，带 `data-align-trigger` 那枚）。
 *
 * **开**用 `fireEvent.click`，**选**用 `userEvent` —— 两边各测出来的：
 *   · 整条路都走 `userEvent` 时，弹层「点了会开、但下一步查询前就自己关掉」
 *     （`aria-expanded` 回到 false），且**与机器负载有关**：单跑绿、
 *     pre-commit 的并发档里红 —— 那种量具不可复现，不能用；
 *   · 只用 `fireEvent.click(选项)` **不会提交**（`onValueChange` 实测零次调用），
 *     base-ui 的选中要走到真正的指针序列。
 * `select-menu.test.tsx` 与 `LogPanel.test.tsx` 的「打开并读属性」也走 fireEvent
 * 这一条，所以本份的「开」与它们同一个口径，只有「选」这步换成 userEvent。
 */
function openPopup(): HTMLElement {
  fireEvent.click(screen.getByRole("combobox"));
  const el = document.querySelector<HTMLElement>(POPUP_MARK);
  if (!el) throw new Error("点开后没有渲染出弹层");
  return el;
}

/** 弹层的外层 = base-ui 的 Positioner（层级与碰撞边界都住在这一层）。 */
function positionerOf(popup: HTMLElement): HTMLElement {
  const positioner = popup.parentElement;
  if (!positioner) throw new Error("弹层没有定位层祖先 —— Portal 结构变了？");
  return positioner;
}

describe("ui/select 的定位层", () => {
  it(`默认把层级给在 Positioner 上（\`z-popup isolate\`），而不是给在 Popup 上`, async () => {
    render(<Demo />);
    const popup = openPopup();
    const positioner = positionerOf(popup);

    expect(positioner.className).toContain("z-popup");
    expect(positioner.className).toContain("isolate");
    /* Popup 那层的 `z-50` 只在 positioner 的 stacking context 内部有意义 ——
       把它调高解决不了「被外层遮罩压住」，所以这里钉「层级在 positioner 上」。 */
    expect(popup.className).toContain("z-50");
  });

  it(`调用处传 positionerClassName 时**替换**默认档位，而不是并存在两处`, () => {
    render(<Demo positionerClassName="z-modal" />);
    const positioner = positionerOf(openPopup());

    expect(positioner.className).toContain("z-modal");
    /* `cn()` 对同族的 `z-*` 是同组后者取胜、把输家摘掉（实测口径），所以
       覆盖不是「多一条类名」，而是**只剩一条** —— 两条并存就等于谁赢看产序。 */
    expect(positioner.className).not.toContain("z-popup");
  });

  it(`alignItemWithTrigger 默认 false（弹层不把已选项对齐到触发器）`, () => {
    render(<Demo />);
    const popup = openPopup();
    expect(popup.getAttribute("data-align-trigger")).toBe("false");
  });

  it(`显式要「原生 select 观感」时标记跟着变 true，动画同时被关掉`, () => {
    render(<Demo alignItemWithTrigger />);
    const popup = openPopup();
    expect(popup.getAttribute("data-align-trigger")).toBe("true");
    /* 对齐到触发器时不能再播缩放动画，否则弹层会「从触发器长出去」；
       这条靠 `data-[align-trigger=true]:animate-none` 命中，属性必须在串里。 */
    expect(popup.className).toContain("data-[align-trigger=true]:animate-none");
  });
});

describe("ui/select 的选择回路", () => {
  it("点选项只回传一次 value，触发器显示的是 **value 本身**而不是选项文案", async () => {
    const onValueChange = vi.fn();
    render(<Demo onValueChange={onValueChange} />);

    openPopup();
    await userEvent.setup().click(screen.getByRole("option", { name: "WEBP" }));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0]?.[0]).toBe("webp");
    /* ⚠️ 实测触发器上显示的是 `webp`（**value**），不是选项 children 里的 `WEBP`。
       base-ui 的 `Select.Value` 默认渲染选中值本身 ⇒ 想让触发器显示人话，必须由
       调用处自己把 value 映射成 label；`ui/select-menu` 就是在做这件事（它显示取
       `labels[value] ?? value`，见那份文件头）。这条不是「顺手写下的期望」，是把
       这个前提钉住：改成渲染 children 会同时改掉所有调用处显示的文本。 */
    expect(screen.getByRole("combobox")).toHaveTextContent("webp");
    expect(screen.getByRole("combobox")).not.toHaveTextContent("WEBP");
  });

  it("未选时触发器显示 placeholder，而不是空串", () => {
    render(<Demo defaultValue="" />);
    expect(screen.getByRole("combobox")).toHaveTextContent("选一个格式");
  });

  it(`选中项带 data-selected，勾（ItemIndicator）只挂在这一类项上`, () => {
    render(<Demo defaultValue="jpg" />);
    openPopup();

    /* 只在**选项**这一层数（`data-slot="select-item"`）：base-ui 会把
       `data-selected` 同时打在弹层内部的其他节点上，按裸属性数会得到 2 枚，
       那条数法判不出「到底哪一项被选中」。 */
    const selected = document.querySelectorAll('[data-slot="select-item"][data-selected]');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toContain("JPG");
    /* 指示器是 `pointer-events-none` 的绝对定位小格：它不许吃掉点击，
       否则点「已选中那一项」会变成点中指示器而选不上。 */
    const indicator = selected[0]?.querySelector(".pointer-events-none");
    expect(indicator).not.toBeNull();
  });

  it(`size="sm" 把档位写在 data-size 上（高度与圆角靠它命中）`, () => {
    render(<Demo size="sm" />);
    const trigger = screen.getByRole("combobox");
    expect(trigger.getAttribute("data-size")).toBe("sm");
    expect(trigger.getAttribute("data-slot")).toBe("select-trigger");
  });
});
