import type { Meta, StoryObj } from "@storybook/nextjs";

import { COMFYUI_DEFAULT_PORT } from "~/lib/endpoints";
import { StatusDot } from "~/components/ui/status-dot";
import {
  STATUS_ACTIONS_CLASS,
  STATUS_ROW_CLASS,
  STATUS_TEXT_CLASS,
  StatusButton,
} from "~/components/ui/service-status-row";

/* 状态文案里的地址取默认端口常量（规范 §12.14：默认端口只有一处出处）——
 * story 里手写一个 8188 与真实默认值漂了没人会发现。 */
const BASE = `http://127.0.0.1:${String(COMFYUI_DEFAULT_PORT)}`;

/**
 * 「服务状态行」= 本机常驻后端（ComfyUI / Drizzle Studio / Ollama）那一条
 * 「左侧状态文字 + 右侧一排按钮」。
 *
 * 这一条最值得看的是**宽度不够时会怎么退化**（ISSUE #423 的现场）：
 * 左侧状态文字截断、按钮整排落到第二行，而不是把按钮压成两行小字。
 * 所以第二个 story 直接给一条 360px 宽的容器。
 *
 * 第三个 story 是**主次**：一屏里只该有一颗实心（`primary-solid`）——
 * 当前这一态该按的那颗。缺省档（软底）留给了「打开查看」这类并列出口。
 */
const meta = {
  title: "UI/ServiceStatusRow",
  component: StatusButton,
  /* 默认 args 必须**自带可访问名**：a11y 扫描那一档不跑 `render`，它按
   * `story.args ?? {}` 裸渲染 `component` —— 缺 `children` 会得到一颗没有名字的
   * 按钮（`button-name`），而那是扫描档的判据，不是这一条 story 的形态。 */
  args: { children: "启动 ComfyUI", onClick: () => undefined },
} satisfies Meta<typeof StatusButton>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 真实落点：一条运行中的状态行（关闭实心、打开走软底）。 */
export const Default: Story = {
  /* 每个具名故事都自带 args：a11y 扫描那一档按 `story.args ?? {}` 裸渲染
     `component`（不跑 `render`），缺 children 就是一颗没有名字的按钮。 */
  args: { children: "启动 ComfyUI", onClick: () => undefined },
  render: () => (
    <div
      className={`border-border bg-surface-2 w-160 rounded-lg border px-3 py-2 ${STATUS_ROW_CLASS}`}
    >
      <StatusDot state="up" />
      <span className={`text-ink/80 ${STATUS_TEXT_CLASS}`}>
        {`ComfyUI 运行中（${BASE}）·配置路径的实例`}
      </span>
      <div className={STATUS_ACTIONS_CLASS}>
        <StatusButton onClick={() => undefined} variant="primary">
          打开查看
        </StatusButton>
        <StatusButton
          onClick={() => undefined}
          variant="outline"
          className="text-muted-foreground hover:text-ink"
        >
          在浏览器打开
        </StatusButton>
        <StatusButton onClick={() => undefined} variant="primary" disabled>
          启动 ComfyUI
        </StatusButton>
        <StatusButton onClick={() => undefined} variant="primary-solid">
          关闭 ComfyUI
        </StatusButton>
      </div>
    </div>
  ),
};

/** 窄容器：状态文字截断、按钮整排换行，**控件不被压扁**（ISSUE #423）。 */
export const Narrow: Story = {
  args: { children: "启动 ComfyUI", onClick: () => undefined },
  render: () => (
    <div
      className={`border-border bg-surface-2 w-90 rounded-lg border px-3 py-2 ${STATUS_ROW_CLASS}`}
    >
      <StatusDot state="busy" />
      <span className={`text-ink/80 ${STATUS_TEXT_CLASS}`}>
        ComfyUI 正在启动…（已拉起 8 秒）
      </span>
      <div className={STATUS_ACTIONS_CLASS}>
        <StatusButton onClick={() => undefined} variant="primary">
          打开查看
        </StatusButton>
        <StatusButton
          onClick={() => undefined}
          variant="outline"
          className="text-muted-foreground hover:text-ink"
        >
          在浏览器打开
        </StatusButton>
        <StatusButton
          onClick={() => undefined}
          variant="primary-solid"
          disabled
        >
          启动中…
        </StatusButton>
        <StatusButton onClick={() => undefined} variant="primary" disabled>
          关闭 ComfyUI
        </StatusButton>
      </div>
    </div>
  ),
};

/**
 * 四档语义各来一行：`up` 运行中 / `busy` 过渡态 / `probing` 结论未出 /
 * `down` 明确未运行。**主次跟着状态走** —— 每一行只有一颗实心。
 */
export const States: Story = {
  args: { children: "启动 ComfyUI", onClick: () => undefined },
  render: () => (
    <div className="flex flex-col gap-3">
      {(
        [
          ["up", `ComfyUI 运行中（${BASE}）`, "关闭 ComfyUI"],
          ["busy", "ComfyUI 正在启动…", "启动中…"],
          ["probing", "ComfyUI 状态检测中…", "启动 ComfyUI"],
          ["down", "ComfyUI 未运行", "启动 ComfyUI"],
        ] as const
      ).map(([state, text, action]) => (
        <div
          key={state}
          className={`border-border bg-surface-2 w-160 rounded-lg border px-3 py-2 ${STATUS_ROW_CLASS}`}
        >
          <StatusDot state={state} />
          <span className={`text-ink/80 ${STATUS_TEXT_CLASS}`}>{text}</span>
          <div className={STATUS_ACTIONS_CLASS}>
            <StatusButton
              onClick={() => undefined}
              variant="primary"
              disabled={state === "busy"}
            >
              打开查看
            </StatusButton>
            <StatusButton
              onClick={() => undefined}
              variant="primary-solid"
              disabled={state === "busy"}
            >
              {action}
            </StatusButton>
          </div>
        </div>
      ))}
    </div>
  ),
};
