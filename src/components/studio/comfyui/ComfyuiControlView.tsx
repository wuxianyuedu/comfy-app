"use client";

/**
 * 侧栏「ComfyUI」页 · 第③层（纯视图，规范 17 §17.2）。
 *
 * 一屏三段，顺序就是读屏顺序 —— **它现在是什么状态**（要点的那颗按钮跟着这一
 * 段走）→ **它这一路的输出**（启动日志，切每次启动 / 全屏）→ **它按什么启动**
 * （安装形态与路径，只读；改路径的出口指向设置）。
 *
 * 「将按哪个路径启动」写成只读一段是有意的：同一份配置若在这一页也能编辑，
 * 保存路径会重写 `setting` 表里那一行，而两处草稿的播种时机不同 —— 结果是
 * 「在设置页改了没保存，来这边启动发现跑的还是旧路径」。所以这里只说事实、
 * 只给出口。
 *
 * 这一句还**只读地写出那条会生效的路径**（`comfyStartPathText`）：用户刚在设置页
 * 改了路径却没保存时，这里显示的仍是库里那条旧路径，「这一点下去跑的是谁」当场
 * 可见 —— 有了它，就不必为一句「配置有未保存改动」去跨屏共享草稿。
 *
 * 屏名由页签给出（`PageHeader` 的 `srTitle` 只留给读屏），副说明挂在顶栏那枚问号
 * 上（`ViewHelp` 注册表）。
 */

import { ArrowRight, RefreshCcw } from "lucide-react";

import { emitAppEvent } from "~/lib/app-events";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { ViewActions } from "~/components/studio/ViewActions";
import { StatusDot } from "~/components/ui/status-dot";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import { SettingsCard } from "~/components/ui/settings-card";
import { Hint } from "~/components/ui/hint";
import { RuntimeLogBox } from "~/components/studio/logs/RuntimeLogBox";
import {
  STATUS_ACTIONS_CLASS,
  STATUS_ROW_CLASS,
  STATUS_TEXT_CLASS,
  StatusButton,
} from "~/components/ui/service-status-row";

import type { ComfyuiControlController } from "./hooks/use-comfyui-control";
import {
  comfyConfigHint,
  comfyDotState,
  comfyDotTitle,
  comfyStartPathText,
  comfyStatusText,
  instanceKindLabel,
  isComfyBusy,
} from "./comfyui-control-config";

export function ComfyuiControlView({ c }: { c: ComfyuiControlController }) {
  /* 三个进行态收成一份：三处派生（圆点 / 状态文案 / 按钮禁用）读的是同一份
   * 快照，各传各的必然会有一处漏掉某面旗（ISSUE #423 的形态）。 */
  const flags = {
    starting: c.starting,
    stopping: c.stopping,
    opening: c.opening,
  };
  const busy = isComfyBusy(c.status, flags);
  const running = !!c.status?.up;
  const configHint = comfyConfigHint(c.instance);

  return (
    <DocumentFrame
      width="medium"
      className="px-4 pt-4 pb-6 sm:px-8 sm:pt-5 sm:pb-8"
    >
      {/* 屏名由页签给出，页头的可见标题那一行收掉（ISSUE #1693）。 */}
      <PageHeader srTitle={pageHeaderTitle("comfyui")} />

      {/* 状态刷新挂顶栏：状态本身事件驱动（变化即推），这颗按钮是「我不信刚才那一
          拍，立刻再问一次」的出口 —— 与队列/历史那边同款。 */}
      <ViewActions>
        <Hint label="立刻再问一次本机后端的状态">
          <Button
            variant="outline"
            size="xs"
            onClick={() => void c.refreshStatus()}
            aria-label="刷新 ComfyUI 状态"
            className="border-border text-ink-faint hover:text-ink-bright h-auto gap-1.5 rounded-lg px-3 py-1.5"
          >
            <RefreshCcw
              data-icon="inline-start"
              className="size-3"
              aria-hidden
            />
            刷新
          </Button>
        </Hint>
      </ViewActions>

      <SettingsCard
        title="运行状态"
        description="提交任务时它没在跑，任务不会开始；状态变了自己会刷，不必手动点。"
      >
        <div
          className={`border-border bg-surface-2 mb-3 rounded-lg border px-3 py-2 ${STATUS_ROW_CLASS}`}
        >
          <StatusDot state={comfyDotState(c.status, flags)} />
          {/* 状态行是**活区**（规范 16 §16.2.4）：状态变了自己会刷，读屏得跟着播报，
              否则「我点了启动、它到底起没起」只能靠肉眼盯。这也让「这一行在不在、
              落没落定」有了一个**不读文案**的稳定锚点 —— 文案里的地址长度会变、
              跨元素分布会给量可见性带来补间窗口（E2E 侧据此等状态落地）。 */}
          <span
            role="status"
            aria-live="polite"
            className={`text-ink/80 ${STATUS_TEXT_CLASS}`}
            title={comfyDotTitle(c.status)}
          >
            {comfyStatusText(c.status, flags)}
          </span>
          <div className={STATUS_ACTIONS_CLASS}>
            {/* 「打开查看」是**看**，不是这一态的主行动：它走软底，主行动的实心档
                留给「启动 / 关闭」。只在「明确未运行」时禁用 —— 探测进行中也允许
                点一下，openComfy 会先取一份新鲜状态再打开（ISSUE #339）。 */}
            <StatusButton
              onClick={() => void c.openComfy()}
              variant="primary"
              disabled={c.opening || (!running && !c.status?.probing)}
            >
              {c.opening ? "打开中…" : "打开查看"}
            </StatusButton>
            {/* 并列出口：同一个地址再交给系统默认浏览器（放大看 / 装插件 / 多屏）。
                页签内嵌照旧，这里不做替换。地址由服务端自己探（comfyOpen），不采信
                界面里缓存的旧 base。禁用口径与「打开查看」一致。 */}
            <StatusButton
              onClick={() => void c.openComfyInBrowser()}
              variant="outline"
              className="text-muted-foreground hover:text-ink"
              disabled={c.browserOpening || (!running && !c.status?.probing)}
            >
              {c.browserOpening ? "打开中…" : "在浏览器打开"}
            </StatusButton>
            {/* 「启动 / 关闭」是一组互斥的主行动：**当前这一态该按的那一颗**才是
                实心（未运行时「启动」实心、运行时「关闭」实心），另一颗此时本就被
                禁用。两颗都实心时一屏里两颗同款主按钮，用户无从判断该点哪个。 */}
            <StatusButton
              onClick={() => void c.startComfy()}
              variant={running ? "primary" : "primary-solid"}
              /* 已配置路径才允许启动：`comfyStart` 会拿库里的路径去 spawn，
                空路径的失败文案（服务端给的）不如这里提前说清去哪配。 */
              disabled={
                busy || running || (!!c.instance && !c.instance.pathConfigured)
              }
            >
              {c.starting || c.status?.starting ? "启动中…" : "启动 ComfyUI"}
            </StatusButton>
            <StatusButton
              onClick={() => void c.stopComfy()}
              variant={running ? "primary-solid" : "primary"}
              disabled={busy || !running}
            >
              {c.stopping || c.status?.stopping ? "关闭中…" : "关闭 ComfyUI"}
            </StatusButton>
          </div>
        </div>

        {/* 未配置路径：说清后果 + 给出**唯一**能改它的地方。不做成禁用但不解释的
            按钮 —— 那种形态下用户只会反复点它。 */}
        {configHint ? (
          <div className="border-warning/40 bg-warning/10 mb-3 rounded-lg border px-3 py-2">
            <p className="text-warning-strong text-xs leading-relaxed">
              {configHint}
            </p>
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                emitAppEvent("workspace:navigate", {
                  view: "settings",
                  /* 落点直接停在「创作后端」那一节（本页文案写的就是
                     「设置 → 创作后端」）：只切视图的话用户还得自己再找一次。 */
                  section: "comfyui",
                })
              }
              className="border-warning/40 text-warning-strong hover:bg-warning/10 mt-2 h-auto gap-1 rounded-lg px-2.5 py-1"
            >
              去设置里配置
              <ArrowRight
                data-icon="inline-end"
                className="size-3"
                aria-hidden
              />
            </Button>
          </div>
        ) : null}

        {/* 按什么启动：安装形态 + 是否已配路径。**只读** —— 改路径的出口在设置页，
            这里不给第二组输入框（见文件头）。 */}
        <p className="text-ink-muted text-xs leading-relaxed">
          {c.instance
            ? `安装形态：${instanceKindLabel(c.instance.instanceType)}。${
                c.instance.desktopManaged
                  ? "端口与启动参数由 Comfy Desktop 实例元数据决定。"
                  : ""
              }`
            : "安装形态判读中…"}
          {""}
          路径与启动参数在「设置 → 创作后端」里配置。
        </p>
        {/* 「这一点下去会按哪条路径启动」：写的是**库里已保存**的那条，所以用户
            在设置页改了路径却没保存时，这里显示的仍是旧路径 —— 当场可见，不需要
            为此跨屏共享草稿。 */}
        <p
          className="text-ink-muted mt-1 text-xs leading-relaxed break-all"
          data-testid="comfyui-start-path"
        >
          {comfyStartPathText(c.status)}
        </p>
      </SettingsCard>

      {/* 启动日志：启动期间每秒跟随 log/services/comfyui-runtime.log，让「正在启动…」
          不再是个黑盒（硬规则 4 的用户可见出口）。右上角的下拉按「每次启动」切换
          （服务端按会话横幅切分），全屏按钮铺满标题行下方的内容区。 */}
      <RuntimeLogBox
        fileName="comfyui-runtime.log"
        log={c.log}
        emptyHint={
          <>
            暂无日志 —— 点「启动 ComfyUI」后这里会实时输出拉起过程（spawn
            参数、模型加载与就绪状态）；也可点「刷新」查看最近一次运行日志。
          </>
        }
        className="mt-4"
      />
    </DocumentFrame>
  );
}
