/**
 * `ui/dialog` 的关得掉、只有一枚关闭按钮、宽度写法的三条契约。
 *
 * 这三条都不是「base-ui 会不会动」，而是**这个仓库在这层之上做过的决定**：
 *
 * 1. **内置关闭按钮只有一枚**。本仓的弹窗形态约定是「自绘 header + 自绘关闭」，
 *    调用处只要自绘就必须传 `showCloseButton={false}` —— 漏传会同时渲染出两枚
 *    位置几乎重合的 ✕：点下去命中的是 DOM 靠后、绝对定位的内置那枚，两枚之间的
 *    间隙还成了「点了没反应」的死区（`DialogContent` 的文件头写的就是这件事）。
 *    所以这里钉的是**默认值 + 关掉之后确实一枚都不剩**，而不是只数一眼。
 * 2. **宽度只有一处下限**：`max-w-[calc(100%-2rem)]`。`sm:max-w-sm` 已被删掉 ——
 *    它带变体、排在所有无变体 utility 之后，连调用处传进来的宽度一起压
 *    （三个日志弹窗的「加宽」按钮长期按了没反应，ISSUE #720）。这条是**类名层**
 *    的哨兵：真实宽度由 Tailwind 产序决定，jsdom 量不到，但「那条带变体的
 *    max-width 有没有长回来」在源码层一眼可判。
 * 3. **本体默认渲染遮罩**（ISSUE #1742）：`DialogContent` 会铺一层带色的
 *    `DialogOverlay`（base-ui 的 `Backdrop`），弹窗背后因此变暗且点不中；只有显式
 *    `showOverlay={false}` 才不铺。此前这里只铺 Portal + Popup，靠基元自动注入的
 *    **无色** `InternalBackdrop` 兜住外部点击 —— 于是绝大多数弹窗背后又亮又像能点。
 *    写这条是因为它曾经是反的（断言「不渲染 Backdrop」），而两件事读注释判不出来。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

beforeEach(() => {
  /* base-ui 的浮层要用 matchMedia，jsdom 不给。与 `sheet.test.tsx` 同款兜底。 */
  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {
        void 0;
      },
      removeListener() {
        void 0;
      },
      addEventListener() {
        void 0;
      },
      removeEventListener() {
        void 0;
      },
      dispatchEvent() {
        return false;
      },
    });
  }
});

function Demo({
  showCloseButton,
  showOverlay,
  popupClassName,
  className,
  onOpenChange,
  open,
}: {
  showCloseButton?: boolean;
  showOverlay?: boolean;
  popupClassName?: string;
  className?: string;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}) {
  return (
    <div id="host">
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger>打开设置</DialogTrigger>
        <DialogContent
          showCloseButton={showCloseButton}
          showOverlay={showOverlay}
          popupClassName={popupClassName}
          className={className}
        >
          <DialogHeader>
            <DialogTitle>弹窗标题</DialogTitle>
            <DialogDescription>这是说明文案</DialogDescription>
          </DialogHeader>
          <p>正文</p>
          {/* 调用处自绘的那枚关闭 —— 与内置那枚是同一族位置，所以要能分辨 */}
          <DialogClose>我自己关</DialogClose>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 点开关并把弹层等出来，返回 `data-slot="dialog-content"` 那个元素。 */
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "打开设置" }));
  /* 等的是 DOM 出现，且回调里没有 jest-dom 匹配器 —— 用 `expect.poll` 判条件，
     再把元素取回来（§11.14.3 的口径：等一个条件变成真一律写 `expect.poll`）。 */
  await expect.poll(() => document.querySelector(CONTENT_MARK)).not.toBeNull();
  const el = document.querySelector<HTMLElement>(CONTENT_MARK);
  if (!el) throw new Error("点开后没有渲染出弹窗本体");
  return el;
}

/** 受控形态下弹窗一开始就是开的；此时触发器已被移出无障碍树（见下面那条用例）。 */
function alreadyOpenPopup(): HTMLElement {
  const el = document.querySelector<HTMLElement>(CONTENT_MARK);
  if (!el) throw new Error("受控 open 下应当直接渲染出弹窗本体");
  return el;
}

const CLOSE_MARK = '[data-slot="dialog-close"]';
const CONTENT_MARK = '[data-slot="dialog-content"]';

/** 取最近一次 onOpenChange 的第一实参（新状态）与 reason（关闭原因）。 */
function lastCall(onOpenChange: ReturnType<typeof vi.fn>) {
  const calls = /* SAFETY: 类型断言已复核 */ onOpenChange.mock.calls as unknown as [
    boolean,
    { reason?: string }?,
  ][];
  const call = calls.at(-1);
  return { nextOpen: call?.[0], reason: call?.[1]?.reason };
}

describe("ui/dialog 的关闭按钮", () => {
  it(`调用处自绘了关闭却没传 showCloseButton={false} ⇒ 两枚（这就是那起事故现场）`, async () => {
    const user = userEvent.setup();
    render(<Demo />);
    const popup = await openDialog(user);

    /* 内置那枚的可访问名是 sr-only 的 "Close"，自绘那枚是「我自己关」——
       两枚都在右上角一带，DOM 靠后的内置那枚吃掉点击，两枚之间的间隙成了
       「点了没反应」的死区。这一条把现场钉死，是为了让下一条（正确用法）
       的「一枚」不是靠少渲染内容蒙对的。 */
    const closes = popup.querySelectorAll(CLOSE_MARK);
    expect(closes).toHaveLength(2);
    const names = [...closes].map((el) => el.textContent?.trim());
    expect(names).toContain("Close");
    expect(names).toContain("我自己关");
    /* 内置那枚带绝对定位（右上角），自绘那枚不带 —— 位置重合是事故的几何成因。 */
    const builtin = [...closes].find((el) => el.className.includes("absolute"));
    expect(builtin).toBeDefined();
    expect([...closes].filter((el) => el.className.includes("absolute"))).toHaveLength(1);
  });

  it("正确用法：showCloseButton={false} 之后只剩自绘那一枚，不多不少", async () => {
    const user = userEvent.setup();
    render(<Demo showCloseButton={false} />);
    const popup = await openDialog(user);

    const closes = popup.querySelectorAll(CLOSE_MARK);
    expect(closes).toHaveLength(1);
    expect(closes[0]?.textContent).toContain("我自己关");
    expect(closes[0]?.className).not.toContain("absolute");
  });

  it("关闭按钮回传 false，并带上原因 close-press", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<Demo showCloseButton={false} onOpenChange={onOpenChange} />);
    const popup = await openDialog(user);

    await user.click(popup.querySelector<HTMLElement>(CLOSE_MARK)!);
    expect(lastCall(onOpenChange)).toEqual({
      nextOpen: false,
      reason: "close-press",
    });
  });

  it("Esc 回传 false（reason=escape-key）；关掉后重开仍带那层遮罩", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<Demo showCloseButton={false} onOpenChange={onOpenChange} />);
    await openDialog(user);

    await user.keyboard("{Escape}");
    expect(lastCall(onOpenChange)).toEqual({
      nextOpen: false,
      reason: "escape-key",
    });

    /* 重新打开后 `[data-slot="dialog-overlay"]` 必须在位 —— 它是「弹窗背后变暗、
       且背后内容点不中」的那一层（ISSUE #1742 之前缺的就是它）。 */
    await user.click(screen.getByRole("button", { name: "打开设置" }));
    await expect.poll(() => document.querySelector(CONTENT_MARK)).not.toBeNull();
    expect(
      document.querySelector('[data-slot="dialog-overlay"]'),
      "DialogContent 必须自带 Backdrop",
    ).not.toBeNull();

    onOpenChange.mockClear();
    /* 目标必须是**Popup 之外**的节点：`#host` 里那颗触发器在弹窗开着的时候被
       base-ui 标成不可达（见上面「触发器被移出无障碍树」那条），点它等于没点。
       body 是 Portal 的宿主、也在 Popup 之外 ⇒ 这就是 outside-press 的判定点。 */
    await user.click(document.body);
    expect(lastCall(onOpenChange).nextOpen).toBe(false);
    expect(lastCall(onOpenChange).reason).toBe("outside-press");
  });

  it("默认铺遮罩；showOverlay={false} 才不铺（极少数内嵌场景）", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Demo showCloseButton={false} />);
    await openDialog(user);
    expect(
      document.querySelector('[data-slot="dialog-overlay"]'),
      "默认必须自带遮罩",
    ).not.toBeNull();
    unmount();

    render(<Demo showCloseButton={false} showOverlay={false} />);
    await openDialog(user);
    expect(
      document.querySelector('[data-slot="dialog-overlay"]'),
      "showOverlay={false}：不铺遮罩",
    ).toBeNull();
  });
});

describe("ui/dialog 的可访问名与归属", () => {
  it("dialog 的名字来自 DialogTitle（aria-labelledby），说明走 aria-describedby", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    const popup = await openDialog(user);

    /* 名字必须是「据标题算出来的」而不是「凑巧 getByRole 找到了」：逐条核
       aria-labelledby → 那个节点的文本，才是规范 06 要的关联。 */
    const labelledBy = popup.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy ?? "")?.textContent).toContain("弹窗标题");
    expect(screen.getByRole("dialog", { name: "弹窗标题" })).toBeInTheDocument();

    const describedBy = popup.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toContain("这是说明文案");
  });

  it("内容渲染在 body 的 Portal 里，不在触发器的宿主容器内", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    const popup = await openDialog(user);
    expect(document.getElementById("host")?.contains(popup)).toBe(false);
  });

  it("打开时触发器被移出无障碍树（模态由基元负责，不是我们自绘遮罩挡住的）", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await openDialog(user);
    /* 这条是上面那条受控用例「拿不到按钮」的正面表述：弹窗开着的时候，外部
       内容不在 a11y 树里 ⇒ 读屏与 Tab 键都进不去背景页面。谁要是把模态行为
       关掉（或改成自绘遮罩），这里会先红。 */
    expect(screen.queryByRole("button", { name: "打开设置" })).not.toBeInTheDocument();
  });
});

describe("ui/dialog 的宽度写法", () => {
  it(`兜底只有一处 max-width，且**没有** sm:max-w-sm（它带变体、会压掉调用处的宽度）`, async () => {
    const user = userEvent.setup();
    render(<Demo />);
    const popup = await openDialog(user);

    expect(popup.className).toContain("max-w-[calc(100%-2rem)]");
    expect(popup.className).not.toMatch(/(^|\s)sm:max-w-/);
    /* 宽度本体由调用处给；基元只留 `w-full` 这条无变体的默认。 */
    expect(popup.className).toMatch(/(^|\s)w-full(\s|$)/);
  });

  it(`popupClassName 落在弹窗本体上（与外层 className 分开，两处各可覆盖）`, async () => {
    const user = userEvent.setup();
    render(<Demo popupClassName="w-6xl" />);
    const popup = await openDialog(user);
    expect(popup.className).toContain("w-6xl");
  });

  it(`同族宽度同时传时 className 取胜（\`cn()\` 同组后者胜、把输家摘掉）`, async () => {
    const user = userEvent.setup();
    render(<Demo popupClassName="w-6xl" className="w-3xl" />);
    const popup = await openDialog(user);
    expect(popup.className).toContain("w-3xl");
    expect(popup.className).not.toContain("w-6xl");
  });
});

describe("ui/dialog 的受控形态", () => {
  it("受控时点关闭只回传、不自己关（由调用方的 state 决定）", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<Demo open showCloseButton={false} onOpenChange={onOpenChange} />);
    const popup = alreadyOpenPopup();

    await user.click(popup.querySelector<HTMLElement>(CLOSE_MARK)!);
    expect(lastCall(onOpenChange).nextOpen).toBe(false);
    /* 没人改 `open`，所以弹窗必须还在 —— 少了这一句，「回传了但自己也关了」
       这种半受控形态会悄悄通过。 */
    expect(document.querySelector(CONTENT_MARK)).not.toBeNull();
  });

  it("DialogOverlay 是可单独渲染的那一层（默认由内容自带，调用处要另铺时才用）", () => {
    render(
      <Dialog open>
        <DialogOverlay data-testid="overlay" />
      </Dialog>,
    );
    expect(screen.getByTestId("overlay")).toBeTruthy();
  });
});
