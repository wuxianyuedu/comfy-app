import type { Meta, StoryObj } from "@storybook/nextjs";

import { modalWidth } from "~/components/ui/dialog-width";
import { useWidePanel, WidePanelToggle } from "~/components/ui/wide-panel";

/**
 * `ui/wide-panel` 是「面板加宽档 + 它的触发钮」的**唯一出口**（规范 16 §16.2.4.18）。
 *
 * 它收的是三个日志面板（`LogPanel` / `GlobalStepLogPanel` /
 * `WorkflowRunLogModal`）里逐字同形的三份实现：档状态、宽度档、触发钮、
 * 图标切换、闭合。收掉重复之外还补了一件事 —— **「加宽」这个选择有记忆**：
 * 加宽态按 `storageKey` 落 `localStorage`，同一面板下次打开还是用户选过的档
 * （三份旧实现都只写了 `useState`，也就是「用户加宽过、关掉、再打开又变窄」）。
 *
 * ## 为什么用 store + `useSyncExternalStore` 而不是 `useState`
 *
 * 同一面板可能**同时挂两份实例**（按钮在标题栏、面板体在 Portal 里）。
 * 纯 `useState` 会让两边各有一份真相、互相看不见对方改了档；
 * 模块级 store + `useSyncExternalStore` 才是同一个真相（与 `useCanvasSettings`
 * 同一套机制）。
 *
 * ## 出口的形状
 *
 * `useWidePanel(id, modalWidth(base))` → `{ wide, toggle, set, widthClass, toggleLabel }`，
 * 其中 `widthClass` 直接交给 `popupClassName` / `className`，
 * `toggleLabel` 一处给出触发钮的 `title` 与 `aria-label`（旧三份是各写一遍，
 * 改名时漏一处就对不上）。
 */
/**
 * `Meta.component` 要的是**能渲染的东西**，而这一族的出口是 `useWidePanel`
 * 这个 hook、`WidePanelToggle` 又要一个 `panel` 对象 —— 所以在 meta 层放一个
 * 最小的承载组件，由它在内部建 `panel`。
 *
 * 不写 `args: { panel: {} as never }`：`as never` 在**判据自己的扫描面**里
 * （`tests/f13-projection-shapes.test.ts` 要求每一处逐处登记 + 写清理由），
 * 而这里本来就有正当写法 —— 造一个真组件即可。
 */
const meta = {
  title: "UI/WidePanel",
  component: WidePanelDemo,
  args: { base: "w-80", defaultWide: false },
  render: (args) => <WidePanelDemo {...args} />,
} satisfies Meta<typeof WidePanelDemo>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 最小承载：建一个 `panel`，把触发钮与宽度档都摊出来。 */
function WidePanelDemo({
  base,
  defaultWide = false,
}: {
  base: string;
  defaultWide?: boolean;
}) {
  const panel = useWidePanel(
    "storybook-wide-panel-demo",
    modalWidth(base),
    defaultWide,
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <WidePanelToggle panel={panel} />
        <span className="text-ink-muted font-mono text-[11px]">
          wide={String(panel.wide)} · {panel.widthClass}
        </span>
      </div>
      <div
        className={`bg-surface-2 flex h-32 items-center justify-center rounded-lg border p-3 transition-[width] ${panel.widthClass}`}
      >
        <span className="text-ink-muted font-mono text-xs">
          面板体读的是同一个 panel.widthClass
        </span>
      </div>
    </div>
  );
}

/** 窄 / 宽两态并列：图标与 `toggleLabel`（`title` + `aria-label`）一起换
 *  （`Maximize2`/「加宽」 ⇄ `Minimize2`/「收缩」）。 */
export const BothStates: Story = {
  render: () => <BothStatesDemo />,
};

function BothStatesDemo() {
  const narrow = useWidePanel("storybook-wide-demo-narrow", modalWidth("w-80"));
  const wide = useWidePanel(
    "storybook-wide-demo-wide",
    modalWidth("w-80"),
    true,
  );
  return (
    <div className="flex items-center gap-6">
      <div className="flex flex-col items-center gap-2">
        <WidePanelToggle panel={narrow} />
        <span className="text-ink-muted font-mono text-[11px]">
          wide={String(narrow.wide)} · {narrow.widthClass}
        </span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <WidePanelToggle panel={wide} />
        <span className="text-ink-muted font-mono text-[11px]">
          wide={String(wide.wide)} · {wide.widthClass}
        </span>
      </div>
    </div>
  );
}

/** 真面板：按钮与面板体读的是**同一个 `panel`** —— 这一条正是本模块存在的
 *  理由（两份 `useState` 时代，按钮在标题栏、面板体在 Portal 里，
 *  两边各有一份真相）。点一下加宽，两块一起变。 */
export const InPanel: Story = {
  render: () => <PanelDemo />,
};

function PanelDemo() {
  const panel = useWidePanel("storybook-wide-demo-panel", modalWidth("w-80"));
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center justify-between rounded-t-lg border border-b-0 px-3 py-2">
        <span className="text-sm font-medium">执行日志</span>
        <WidePanelToggle panel={panel} />
      </div>
      <div
        className={`bg-surface-2 flex h-40 items-center justify-center rounded-b-lg border p-3 transition-[width] ${panel.widthClass}`}
      >
        <span className="text-ink-muted font-mono text-xs">
          面板体读的是同一个 panel.widthClass（{panel.widthClass}）
        </span>
      </div>
    </div>
  );
}

/**
 * 记忆：点一次加宽，然后**刷新画布**再看这份 story —— 档位还在。
 * 这正是旧三份实现欠的那件事（只写了 `useState`，关掉再开又变窄）。
 */
export const Remembered: Story = {
  render: () => <PanelDemo />,
};
