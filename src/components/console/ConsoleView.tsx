"use client";

/**
 * ConsoleView —— 应用内控制台（ISSUE #1327）。
 *
 * 用户侧诉求：那些「本来要另开一个终端窗口敲」的操作（跑质量门禁、推 schema、
 * 看端口占用、git 只读查询……）现在在一个面板里就能做，不必切出去开控制台。
 *
 * 形态：**文档型视图**，与历史 / 队列 / 模型库同形（`DocumentFrame` + 居中列 +
 * 页头 `h1` + 副标题），而不是全屏浮层。这一形态是用户点名要的（ISSUE #1327
 * 反馈「不要全屏界面，和队列/流程/历史等用一样形式的界面」）。
 *
 * ⚠️ 视图页签只记住「开着这一页」，**不**让输出跨视图存活：工作区同一时刻只渲染
 * 当前视图（`app/workspace/page.tsx` 的 `switch`），切走会让本组件卸载、
 * `use-console` 的清理断流、服务端据此回收整棵树。所以跑长命令时要留在这一页；
 * 要让输出活在卸载之外，得把状态抬进模块级 store（与 `log-store` 同族），
 * 那不在本次范围内。与从前「关掉浮层就回收」是同一条规则，不是新引入的行为。
 *
 * 三段式（与从前一致，只换了外框）：
 *   左  ── 预设命令列表（点一下把命令**填进**输入框）
 *   右上 ── 输出区（贴底跟随 + 结论条）
 *   右下 ── 输入行（回车提交 · 运行时可停止 · 可清屏）
 *
 * 分层（规范 17 §17.2）：视图只渲染，状态机、SSE、历史与文案全在
 * `./hooks/use-console`；网络层在 `~/lib/console/console-client`。
 *
 * ## 「停止」为什么是必需的一等动作，而不是「切走就行」
 *
 * 控制台跑的是 `pnpm test` 这类**分钟级、吃满 CPU** 的命令。切走视图确实会断开
 * 请求、服务端据此回收整棵树（见路由的 `cancel()`），但那是**隐式**的 ——
 * 用户想在面板里看着输出、过一会儿再决定要不要停。所以给一个显式停止按钮，
 * 并在按下时说清「命令及其子进程已回收」（这正是硬规则 3 要的效果：杀整棵树，
 * 不留孤儿占着端口与日志）。
 */
import { useCallback } from "react";
import { AlertTriangle, Eraser, Play, Square, Terminal } from "lucide-react";

import { Button } from "~/components/ui/button";
import { AuroraBackground } from "~/components/ui/aurora-background";
import { Hint } from "~/components/ui/hint";
import { textHandler } from "~/lib/form-props";
import { Input } from "~/components/ui/input";
import { Kbd } from "~/components/ui/kbd";
import { enterCommit } from "~/components/ui/use-enter-commit";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { cn } from "~/lib/utils";

import { ConsoleOutput } from "./ConsoleOutput";
import { ConsolePresetList } from "./ConsolePresetList";
import { useConsole } from "./hooks/use-console";

export function ConsoleView() {
  const c = useConsole();
  const running = c.phase === "running";

  const submit = useCallback(() => {
    if (c.canRun) c.run();
  }, [c]);

  /* 回车提交走全库唯一出口（`ui/use-enter-commit`）：它同时判掉「输入法组字
   * 中的 Enter」（中文输入法下会把半截拼音当成命令跑）与 `preventDefault`，
   * 这两件事收口前在 11 处各写各的。 */
  const enter = enterCommit({ onCommit: submit });

  return (
    <DocumentFrame
      width="wide"
      className="px-4 py-8 sm:px-8 sm:py-10"
      backdrop={<AuroraBackground />}
    >
      {/* ── 页头：与历史 / 队列 / 模型库同一形状（h1 + 副标题 + 右侧动作）── */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-title u-title-page">控制台</h1>
          <p className="text-ink-muted mt-1 text-sm">
            在项目根执行命令；命令与其子进程在切走视图或点「停止」时一并回收。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Hint label="清空输出（保留跑过的命令）">
            <Button
              variant="outline"
              size="xs"
              onClick={c.clear}
              disabled={running}
              aria-label="清空输出"
              className="border-border text-ink-faint hover:text-ink-bright h-auto gap-1.5 rounded-lg px-3 py-1.5"
            >
              <Eraser size={13} aria-hidden />
              清屏
            </Button>
          </Hint>
        </div>
      </header>

      {/* ── 主体：左预设 + 右输出/输入。高度用 `h-[85vh]`（与全库长内容面板同一
             口径）：终端要有「一次看得见多少行」的稳定预期，让它随内容长短伸缩就
             成了一个会跳动的控件。窄屏下退化成单列堆叠。 ── */}
      <div className="border-border-subtle bg-card flex h-[85vh] min-h-96 flex-col overflow-hidden rounded-xl border lg:flex-row">
        {/* 左：预设命令 */}
        {/* `min-h-0` 不能省：flex 列/行里的子项默认 `min-height: auto`，不会缩到
            比内容还小 —— 预设列表比卡片高时它会顶出圆角边界，而卡片又是
            `overflow-hidden`，于是最后几组命令被裁掉且滚不到。 */}
        <aside className="border-border-subtle flex max-h-[45%] min-h-0 shrink-0 flex-col border-b lg:max-h-none lg:w-60 lg:border-r lg:border-b-0">
          <div className="text-ink-faint text-2xs border-border-subtle flex h-9 shrink-0 items-center gap-1.5 border-b px-3 font-medium">
            <Terminal size={13} aria-hidden />
            常用命令（点击填入）
          </div>
          <ConsolePresetList onFill={c.fill} disabled={running} />
        </aside>

        {/* 右：输出 + 输入 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ConsoleOutput
            output={c.output}
            running={running}
            verdict={c.verdict || null}
            verdictOk={c.verdictOk}
            stopped={c.phase === "stopped"}
            emptyHint="在左侧选择一条常用命令，或直接在下面输入；按回车执行"
          />

          {/* 输入行 */}
          <div className="border-border bg-bg flex shrink-0 flex-col gap-2 border-t px-4 py-3">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="text-primary-strong shrink-0 font-mono text-sm"
              >
                $
              </span>
              <Input
                value={c.command}
                onChange={textHandler(c.setCommand)}
                {...enter}
                maxLength={c.maxCommandChars}
                disabled={running}
                aria-label="要执行的命令"
                placeholder={
                  running
                    ? `正在运行：${c.runningCommand ?? ""}`
                    : "pnpm exec tsc --noEmit"
                }
                className={cn(
                  "h-8 font-mono text-[12.5px]",
                  "disabled:opacity-70",
                )}
              />
              {running ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={c.stop}
                  className="shrink-0"
                >
                  <Square data-icon="inline-start" size={13} />
                  停止
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={submit}
                  disabled={!c.canRun}
                  className="shrink-0"
                >
                  <Play data-icon="inline-start" size={13} />
                  运行
                </Button>
              )}
            </div>

            {/* 「这行会被当成什么」的提示块：长度余量 + shell 语法提醒。
                两者都是「不说清就等于控件哑了」的那一类。 */}
            <div className="text-ink-fainter flex items-start justify-between gap-3 text-[10.5px]">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-1.5">
                  <Kbd>Enter</Kbd>
                  执行 · 在项目根运行，最长 10 分钟
                </span>
                {c.syntaxWarning && (
                  <span
                    data-testid="console-syntax-warning"
                    className="text-warning-strong flex items-start gap-1.5 leading-snug"
                  >
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>{c.syntaxWarning}</span>
                  </span>
                )}
              </div>
              {/* 命令长度给可见余量：撞上限时输入框会直接不再接受字符，
                  不说清「为什么打不进去了」就成了一个哑掉的控件。 */}
              <span className="shrink-0">
                {c.command.length}/{c.maxCommandChars}
              </span>
            </div>

            {/* 本次会话跑过什么（新的在前）—— 只保留最近若干条，不落库：
                要留档的结论该落在文件里，这里解决的是「刚才那条怎么跑的」。 */}
            {c.history.length > 0 && (
              <div className="border-border-subtle flex flex-wrap gap-1.5 border-t pt-2">
                {c.history.slice(0, 8).map((item) => (
                  <Hint
                    key={`${item.command}-${item.durationMs}-${item.verdict}`}
                    label={`${item.command} —— ${item.verdict}`}
                  >
                    <Button
                      variant="ghost"
                      disabled={running}
                      onClick={() => c.fill(item.command)}
                      className={cn(
                        "h-auto max-w-64 rounded px-2 py-0.5 font-mono text-[10.5px] font-normal",
                        item.ok
                          ? "bg-success/10 text-success-strong hover:bg-success/20"
                          : "bg-subtle text-ink-muted hover:text-ink",
                      )}
                    >
                      {item.command}
                    </Button>
                  </Hint>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </DocumentFrame>
  );
}
