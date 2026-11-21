"use client";

/**
 * 侧栏「ComfyUI」页 · 第③层（纯视图，规范 17 §17.2）。
 * 两段顺序即读屏顺序：当前状态 → 启动日志。这一页的主角就是这两样：
 * 日志区弹性铺满剩余高度（fill），常驻说明小字按用户反馈撤掉（hideStreamHint）。
 * 启动路径 / 安装形态的完整出口在「设置 → 创作后端」，本页不重复（用户反馈 #4710）；
 * 屏名由 PageHeader 的 srTitle 给读屏。 */

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
  STATUS_TEXT_CLASS,
  StatusButton,
} from "~/components/ui/service-status-row";

import type { ComfyuiControlController } from "./hooks/use-comfyui-control";
import {
  comfyConfigHint,
  comfyDotState,
  comfyDotTitle,
  comfyStatusParts,
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
  const running = c.status?.up === true;
  const configHint = comfyConfigHint(c.instance);
  const statusParts = comfyStatusParts(c.status, flags);

  return (
    /* 弹性列（min-h-full）：内容不足一屏时「运行日志」吃满剩余高度（重设计稿），
       超过一屏时整列照常滚动 —— 滚动锚仍是 DocumentFrame 的 document-scroll 层。 */
    <DocumentFrame
      className="flex min-h-full flex-col px-4 pt-4 pb-6 sm:px-8 sm:pt-5 sm:pb-8"
      width="medium"
    >
      {/* 屏名由页签给出，页头的可见标题那一行收掉（ISSUE #1693）。 */}
      <PageHeader srTitle={pageHeaderTitle("comfyui")} />

      {/* 状态刷新挂顶栏：状态本身事件驱动（变化即推），这颗按钮是「我不信刚才那一
          拍，立刻再问一次」的出口 —— 与队列/历史那边同款。 */}
      <ViewActions>
        <Hint label="立刻再问一次本机后端的状态">
          <Button
            aria-label="刷新 ComfyUI 状态"
            className="border-border text-ink-faint hover:text-ink-bright h-auto gap-1.5 rounded-lg px-3 py-1.5"
            onClick={() => {
              void c.refreshStatus();
            }}
            size="xs"
            variant="outline"
          >
            <RefreshCcw aria-hidden className="size-3" data-icon="inline-start" />
            刷新
          </Button>
        </Hint>
      </ViewActions>

      {/* 标题与正文之间的留白收紧（用户反馈 #4710：标题下空白过大）——
          覆盖 SettingsCard 的默认节奏：根 gap 16→8、标题行 pb 12→8、正文 pt 16→12。 */}
      <SettingsCard
        className="gap-2 [&_[data-slot=card-content]]:pt-3 [&_[data-slot=card-header]]:pb-2"
        title="运行状态"
      >
        {/* 纵向三行：状态句 → 地址 → 按钮排。不再共用一条会互相挤压的 flex 行 ——
            按钮多，一挤就把状态句裁出省略号（用户反馈 #4710 的现场）。 */}
        <div className="mb-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {/* 绿点保留，运行中加呼吸（ISSUE #4631）：「它在跑」要一眼可见，
                但过渡态（busy/probing）不呼吸——那不是稳定状态。 */}
            <StatusDot pulse={running} state={comfyDotState(c.status, flags)} />
            {/* 状态行是**活区**（规范 16 §16.2.4）：状态变了自己会刷，读屏得跟着播报。 */}
            <Hint label={comfyDotTitle(c.status)}>
              <span
                aria-live="polite"
                className={`text-ink/80 ${running ? "font-semibold" : ""} ${STATUS_TEXT_CLASS}`}
                role="status"
              >
                {statusParts.lead}
                {statusParts.via === null ? null : `·${statusParts.via}`}
              </span>
            </Hint>
          </div>
          {/* 地址单独一行、`break-all` 不截断 —— 用户反馈 #4710：地址必须显示全。 */}
          {statusParts.url === null ? null : (
            <span className="text-ink-faint pl-4 font-mono text-xs break-all">
              {statusParts.url}
            </span>
          )}
          <div className={STATUS_ACTIONS_CLASS}>
            {/* 「打开查看 / 在浏览器打开」是运行中真正的主行动，保留主题紫实心档
                （ISSUE #4631）；只在「明确未运行」时禁用 —— 探测进行中也允许
                点一下，openComfy 会先取一份新鲜状态再打开（ISSUE #339）。 */}
            <StatusButton
              disabled={c.opening || (!running && c.status?.probing !== true)}
              onClick={() => {
                void c.openComfy();
              }}
              variant="primary-solid"
            >
              {c.opening ? "打开中…" : "打开查看"}
            </StatusButton>
            {/* 并列出口：同一地址再交给系统默认浏览器（放大看/装插件/多屏），页签内嵌照旧。
                地址由服务端自己探（comfyOpen），不采信界面缓存的旧 base；禁用口径同「打开查看」。
                配色与「打开查看」同档（此前 outline + 手写 text 覆写导致同层按钮长出两种形状）。 */}
            <StatusButton
              disabled={c.browserOpening || (!running && c.status?.probing !== true)}
              onClick={() => {
                void c.openComfyInBrowser();
              }}
              variant="primary-solid"
            >
              {c.browserOpening ? "打开中…" : "在浏览器打开"}
            </StatusButton>
            {/* 按钮权重（ISSUE #4631）：主题紫实心只给「打开查看 / 在浏览器打开」；
                「启动」是低频动作走幽灵档、「关闭」是危险动作走浅红档（danger），
                避免一屏里出现两颗抢眼的紫色实心按钮、也避免误触关闭。两颗仍互斥禁用。 */}
            <StatusButton
              /* 已配置路径才允许启动：`comfyStart` 会拿库里的路径去 spawn，
                空路径的失败文案（服务端给的）不如这里提前说清去哪配。 */
              disabled={busy || running || (!!c.instance && !c.instance.pathConfigured)}
              onClick={() => {
                void c.startComfy();
              }}
              variant="ghost"
            >
              {c.starting || c.status?.starting === true ? "启动中…" : "启动 ComfyUI"}
            </StatusButton>
            <StatusButton
              disabled={busy || !running}
              onClick={() => {
                void c.stopComfy();
              }}
              variant="danger"
            >
              {c.stopping || c.status?.stopping === true ? "关闭中…" : "关闭 ComfyUI"}
            </StatusButton>
            {/* 卸载模型两档（ISSUE #4637）：把 ComfyUI 自己菜单里的「卸载模型 /
                卸载模型和执行缓存」搬到页上当按钮 —— 免得为释放显存专门切进
                ComfyUI 页签翻菜单。维护性动作走 outline 档，与主行动（紫实心）、
                低频「启动」（幽灵）、危险「关闭」（浅红）分层；只有明确运行中才
                可点（对没在跑的实例发 /free 只会得到连接失败），卸载进行中两颗
                一起禁用（共用一份 freeing，避免并发发两份请求）。 */}
            <StatusButton
              disabled={busy || c.freeing || !running}
              onClick={() => {
                void c.unloadModels();
              }}
              variant="outline"
            >
              卸载模型
            </StatusButton>
            <StatusButton
              disabled={busy || c.freeing || !running}
              onClick={() => {
                void c.unloadModelsWithCache();
              }}
              variant="outline"
            >
              卸载模型和执行缓存
            </StatusButton>
          </div>
        </div>

        {/* 未配置路径：说清后果 + 给出**唯一**能改它的地方。不做成禁用但不解释的
            按钮 —— 那种形态下用户只会反复点它。 */}
        {configHint !== null && configHint !== "" ? (
          <div className="border-warning/40 bg-warning/10 mb-3 rounded-lg border px-3 py-2">
            <p className="text-warning-strong text-xs leading-relaxed">{configHint}</p>
            <Button
              className="border-warning/40 text-warning-strong hover:bg-warning/10 mt-2 h-auto gap-1 rounded-lg px-2.5 py-1"
              onClick={() => {
                emitAppEvent("workspace:navigate", {
                  view: "settings",
                  /* 落点直接停在「创作后端」那一节（本页文案写的就是
                     「设置 → 创作后端」）：只切视图的话用户还得自己再找一次。 */
                  section: "comfyui",
                });
              }}
              size="xs"
              variant="outline"
            >
              去设置里配置
              <ArrowRight aria-hidden className="size-3" data-icon="inline-end" />
            </Button>
          </div>
        ) : null}

        {/* 按什么启动的说明已按用户反馈（#4710）撤掉：安装形态 / 启动路径的
            完整出口在「设置 → 创作后端」，本页不再重复一遍。 */}
      </SettingsCard>

      {/* 启动日志：启动期间每秒跟随 log/services/comfyui-runtime.log，让「正在启动…」
          不再是个黑盒（硬规则 4 的用户可见出口）。右上角的下拉按「每次启动」切换
          （服务端按会话横幅切分），全屏按钮铺满标题行下方的内容区。
          这一页的主角就是「运行状态 + 日志」：日志区弹性铺满剩余高度（fill），
          常驻的流前缀小字也按反馈撤掉（hideStreamHint）。 */}
      <RuntimeLogBox
        className="mt-6"
        emptyHint={
          <>
            暂无日志 —— 点「启动 ComfyUI」后这里会实时输出拉起过程（spawn
            参数、模型加载与就绪状态）；也可点「刷新」查看最近一次运行日志。
          </>
        }
        fileName="comfyui-runtime.log"
        fill
        hideStreamHint
        log={c.log}
      />
    </DocumentFrame>
  );
}
