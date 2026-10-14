import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  EMBEDDED_SCROLL_MAX_HEIGHT,
  OVERLAY_MAX_HEIGHT,
} from "~/components/ui/overlay-max-height";

/**
 * `ui/overlay-max-height` 是浮层**最大高**两档的唯一定义处，对外面就是这两个串 ——
 * 所以这份 story 摊开的也是这两个串，外加一节能亲手把窗口拉高拉低的实测。
 *
 * 为什么值得单独一份（与 `dialog-overlay.stories.tsx` 同判据）：它是
 * 「删掉 JSX 还能跑的判据」（规范 17 §17.2 第①层），可以脱离 React 单测；
 * 而它**为什么不做成 `@theme` 的 `--max-height-*`** 这件事只有把串摆出来才讲得清：
 *
 * > 实测 `cn("max-h-[85vh]", "max-h-overlay")` **两条都留** —— tailwind-merge
 * > 认不出自定义名字属于哪一族，「谁覆写谁」就交给 Tailwind 的输出顺序。
 * > 那是规范 16 §16.2.4.12 那次「加宽按钮点了没反应」的同族事故。
 * > 存 arbitrary 串则同族冲突照常生效（同族的两枚 max-h 任意值只留后一条）。
 *
 * 两档是怎么量的（不是凑的）：85vh 是居中模态 / 图片看全 / 弹层面板那 6 处的事实档，
 * `78vh` 与 `90vh` 各一处是同一角色上的漂移值（差那 5–7 个百分点没有任何一处文档说过
 * 为什么）→ 并入；70vh 三处是**另一个角色**（页面里自滚动的卡片区，上限要留呼吸）。
 * 另有两处逐处判定过、刻意不收：JSON 面板 positioner 的 60vh（只有一个消费者，为它立一档
 * 就是「为以后可能用得上」留在库里）、`ConsoleView` 左栏的 `max-h-[45%]`（百分比相对父容器
 * 而非视口，量的不是同一件事）。
 */
const meta = {
  title: "UI/OverlayMaxHeight",
  component: CapDemo,
  render: () => <CapDemo />,
} satisfies Meta<typeof CapDemo>;

export default meta;

type Story = StoryObj<typeof meta>;

function CapDemo() {
  return (
    <div className="flex w-184 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">
          OVERLAY_MAX_HEIGHT —— 浮层主体（模态 / 看全 / 弹层面板）
        </span>
        <pre className="rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap">
          {OVERLAY_MAX_HEIGHT}
        </pre>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">
          EMBEDDED_SCROLL_MAX_HEIGHT —— 页面内自滚动的卡片区
        </span>
        <pre className="rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap">
          {EMBEDDED_SCROLL_MAX_HEIGHT}
        </pre>
      </div>
      {/* 两档各一枚真盒子：内容远超上限，所以看到的高度就是上限本身。
          上限按视口算 —— 把浏览器窗口拉高拉低，两枚盒子要**等比例**跟着变，
          而它们之间的差（15vh）在任何窗口高度下都保持。 */}
      <div className="flex items-start gap-4">
        <div
          className={`border-border-strong bg-card flex w-80 flex-col overflow-hidden rounded-xl border ${OVERLAY_MAX_HEIGHT}`}
        >
          <p className="border-border-subtle text-ink-bright shrink-0 border-b px-3 py-2 text-sm font-semibold">
            85vh 档
          </p>
          <div className="overflow-y-auto">
            <LongBody />
          </div>
        </div>
        <div
          className={`border-border-strong bg-card flex w-80 flex-col overflow-hidden rounded-xl border ${EMBEDDED_SCROLL_MAX_HEIGHT}`}
        >
          <p className="border-border-subtle text-ink-bright shrink-0 border-b px-3 py-2 text-sm font-semibold">
            70vh 档
          </p>
          <div className="overflow-y-auto">
            <LongBody />
          </div>
        </div>
      </div>
      <p className="text-ink-muted text-xs">
        真形态（谁在什么场景取哪一档）见 <code>Dialog</code> /{" "}
        <code>Sheet</code> 与 <code>Studio/ModelLibrary</code> 那批
        story；调用点一律 import 这两个常量，别在调用处再写字面量 —— 契约
        §Shapes 第 ⑦ 条按具名出处放行， 其余落点直接红。
      </p>
    </div>
  );
}

function LongBody() {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: 24 }, (_, i) => (
        <p className="text-ink-soft text-xs" key={i}>
          第 {i + 1} 行 —— 内容比上限长，所以盒子停在档位给的高度上开始滚动。
        </p>
      ))}
    </div>
  );
}

/** 默认档：两档的字符串 + 两枚真盒子（拉窗口即见比例跟手）。 */
export const Default: Story = {};
