"use client";

/**
 * ConsoleView —— 应用内控制台（ISSUE #1327）：文档型视图（用户点名不要全屏）。
 * ⚠️ 切走视图即卸载本组件、断流回收整棵树，输出不跨视图存活。分层（规范 17 §17.2）：
 * 状态机/SSE/历史在 ./hooks/use-console。「停止」须显式停、杀整棵树（硬规则 3）。
 */
import { useCallback } from "react";
import { AlertTriangle, Eraser, Play, Square, Terminal } from "lucide-react";

import { Button } from "~/components/ui/button";
import { AuroraBackground } from "~/components/ui/aurora-background";
import { Hint } from "~/components/ui/hint";
import { textHandler } from "~/lib/form-props";
import { Input } from "~/components/ui/input";
import { Kbd } from "~/components/ui/kbd";
import { PageHeader } from "~/components/ui/page-header";
import { ViewActions } from "~/components/studio/ViewActions";
import { enterCommit } from "~/components/ui/use-enter-commit";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { cn } from "~/lib/utils";

import { ConsoleOutput } from "./ConsoleOutput";
import { ConsolePresetList } from "./ConsolePresetList";
import { useConsole } from "./hooks/use-console";

export function ConsoleView() {
  const c = useConsole();
  const running = c.phase === "running";

  const submit = useCallback(() => {
    if (c.canRun) {
      c.run();
    }
  }, [c]);

  /* 回车提交走全库唯一出口（`ui/use-enter-commit`）：它同时判掉「输入法组字
   * 中的 Enter」（中文输入法下会把半截拼音当成命令跑）与 `preventDefault`，
   * 这两件事收口前在 11 处各写各的。 */
  const enter = enterCommit({ onCommit: submit });

  return (
    /* `width="full"`（不封顶）：这一屏是**工具型**文档视图 —— 主体是一个输出面板，
       内容是等宽的日志行与命令，不是成篇的文字。压到 `wide`（1200px）意味着宽屏上
       左右各留一大块空，而面板正需要那点宽度（ISSUE #1902）。 */
    <DocumentFrame
      backdrop={<AuroraBackground />}
      className="px-4 pt-4 pb-8 sm:px-8 sm:pt-5 sm:pb-12"
      width="full"
    >
      {/* ── 页头：与历史 / 队列 / 模型库同一形状，收在 `ui/page-header` ── */}
      <PageHeader srTitle={pageHeaderTitle("console")} />

      {/* 清屏挂到顶栏（`ViewActions`）—— 见 `ViewActions` 里那段「屏名由页签
          给出之后，留在屏内那一行只剩右对齐的几颗控件」（ISSUE #1871）。 */}
      <ViewActions>
        <Hint label="清空输出（保留跑过的命令）">
          <Button
            aria-label="清空输出"
            className="border-border text-ink-faint hover:text-ink-bright h-auto gap-1.5 rounded-lg px-3 py-1.5"
            disabled={running}
            onClick={c.clear}
            size="xs"
            variant="outline"
          >
            <Eraser aria-hidden size={13} />
            清屏
          </Button>
        </Hint>
      </ViewActions>

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
            <Terminal aria-hidden size={13} />
            常用命令（点击填入）
          </div>
          <ConsolePresetList disabled={running} onFill={c.fill} />
        </aside>

        {/* 右：输出 + 输入 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ConsoleOutput
            emptyHint="在左侧选择一条常用命令，或直接在下面输入；按回车执行"
            output={c.output}
            running={running}
            stopped={c.phase === "stopped"}
            verdict={c.verdict || null}
            verdictOk={c.verdictOk}
          />

          {/* 输入行 */}
          <div className="border-border bg-bg flex shrink-0 flex-col gap-2 border-t px-4 py-3">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-primary-strong shrink-0 font-mono text-sm">
                $
              </span>
              <Input
                onChange={textHandler(c.setCommand)}
                value={c.command}
                {...enter}
                aria-label="要执行的命令"
                className={cn("h-8 font-mono text-[12.5px]", "disabled:opacity-70")}
                disabled={running}
                maxLength={c.maxCommandChars}
                placeholder={
                  running ? `正在运行：${c.runningCommand ?? ""}` : "pnpm exec tsc --noEmit"
                }
              />
              {running ? (
                <Button className="shrink-0" onClick={c.stop} size="sm" variant="danger">
                  <Square data-icon="inline-start" size={13} />
                  停止
                </Button>
              ) : (
                <Button
                  className="shrink-0"
                  disabled={!c.canRun}
                  onClick={submit}
                  size="sm"
                  variant="primary"
                >
                  <Play data-icon="inline-start" size={13} />
                  运行
                </Button>
              )}
            </div>

            {/* 「这行会被当成什么」的提示块：长度余量 + shell 语法提醒。
                两者都是「不说清就等于控件哑了」的那一类。 */}
            <div className="text-ink-fainter text-2xs flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-1.5">
                  <Kbd>Enter</Kbd>
                  执行 · 在项目根运行，最长 10 分钟
                </span>
                {c.syntaxWarning && (
                  <span
                    className="text-warning-strong flex items-start gap-1.5 leading-snug"
                    data-testid="console-syntax-warning"
                  >
                    <AlertTriangle className="mt-0.5 shrink-0" size={12} />
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
                      className={cn(
                        "text-2xs h-auto max-w-64 rounded px-2 py-0.5 font-mono font-normal",
                        item.ok
                          ? "bg-success/10 text-success-strong hover:bg-success/20"
                          : "bg-subtle text-ink-muted hover:text-ink",
                      )}
                      disabled={running}
                      onClick={() => {
                        c.fill(item.command);
                      }}
                      variant="ghost"
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
