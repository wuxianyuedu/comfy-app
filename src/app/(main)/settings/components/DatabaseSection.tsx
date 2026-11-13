"use client";

/**
 * 数据库（Drizzle Studio）分区（规范 17 §17.2 第③层）。
 * 状态与「启动 / 停止 / 打开」动作来自 controller；视图自持仅日志滚动跟随。
 */

import { StatusDot, type StatusDotState } from "~/components/ui/status-dot";

import {
  STATUS_ACTIONS_CLASS,
  STATUS_ROW_CLASS,
  STATUS_TEXT_CLASS,
  StatusButton,
} from "~/components/ui/service-status-row";

import { SettingsCard, SETTINGS_ROW_CLASS } from "~/components/ui/settings-card";
import { RuntimeLogBox } from "~/components/studio/logs/RuntimeLogBox";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";
import { Hint } from "~/components/ui/hint";

/** Drizzle Studio 状态 → 圆点语义（过渡态优先，口径同 ComfyUI 那条）。 */
function dbStudioDotState(c: ReadySettingsPageController): StatusDotState {
  if (c.dbStudioStatus?.up === true) {
    return "up";
  }
  if (c.dbStudioStatus?.starting === true || c.dbStudioStarting) {
    return "busy";
  }
  return "down";
}

export function DatabaseSection({ c }: { c: ReadySettingsPageController }) {
  return (
    <SettingsCard>
      {/* 「本分区是什么」那一段搬进了导航行右侧的说明（`sectionSummary`）——
          它回答的是导航问题，读一遍就不再需要，留着只会把第一个控件推到折叠线
          以下。这里只留**答案在别处拿不到的那句**：界面托管在官方远端域名上。 */}
      <p className="text-muted-foreground mb-3 text-xs">
        Drizzle Studio 的界面托管在官方远端页面（
        <code className="text-ink/80">local.drizzle.studio</code>
        ），本地只起一个回连端口；点「打开查看」会用系统默认浏览器打开它。
      </p>
      <div className={`${SETTINGS_ROW_CLASS} ${STATUS_ROW_CLASS}`}>
        <StatusDot state={dbStudioDotState(c)} />
        <Hint
          label={
            c.dbStudioStatus?.up === true
              ? `Drizzle Studio 运行中（端口 ${c.dbStudioStatus.port}）`
              : undefined
          }
        >
          <span className={`text-ink/80 ${STATUS_TEXT_CLASS}`}>
            {c.dbStudioStatus?.up === true
              ? `Drizzle Studio 运行中（端口 ${c.dbStudioStatus.port}）`
              : c.dbStudioStarting || c.dbStudioStatus?.starting === true
                ? "Drizzle Studio 正在启动…"
                : "Drizzle Studio 未运行"}
          </span>
        </Hint>
        <div className={STATUS_ACTIONS_CLASS}>
          {/* 按钮只看自身动作的在途状态（dbStudioStarting/Stopping/
              Opening），不看全局 saving——saving 是保存偏好/ComfyUI
              等共享标志，卡住时曾把三个按钮一起锁死（#92）。
              状态查询失败（dbStudioStatus 为 null）时按「未运行」
              处理：启动按钮仍可点，用户不会整组被禁用。 */}
          {/* 三颗的层级与 ComfyUI 那条同款（见 ComfyuiSection 的注释）：
              「看」走软底、`outline` 给并列出口、**当前这一态该按的那一颗**
              才是实心。此前三颗都是实心品牌紫，一屏里三颗主按钮。 */}
          <StatusButton
            disabled={c.dbStudioOpening || c.dbStudioStarting || c.dbStudioStatus?.up !== true}
            onClick={() => {
              void c.openDbStudio();
            }}
            variant="primary"
          >
            {c.dbStudioOpening ? "打开中…" : "打开查看"}
          </StatusButton>
          <StatusButton
            disabled={c.dbStudioStarting || c.dbStudioStatus?.up === true}
            onClick={() => {
              void c.startDbStudio();
            }}
            variant={c.dbStudioStatus?.up === true ? "primary" : "primary-solid"}
          >
            {c.dbStudioStarting ? "启动中…" : "启动 Drizzle Studio"}
          </StatusButton>
          <StatusButton
            disabled={c.dbStudioStopping || c.dbStudioStatus?.up !== true}
            onClick={() => {
              void c.stopDbStudio();
            }}
            variant={c.dbStudioStatus?.up === true ? "primary-solid" : "primary"}
          >
            {c.dbStudioStopping ? "关闭中…" : "关闭 Drizzle Studio"}
          </StatusButton>
        </div>
      </div>
      {/* Drizzle Studio 启动日志：启动期间每秒跟随
          log/services/drizzle-studio-runtime.log（同 ComfyUI 的用户可见出口）。
          下拉按「每次启动」切换、可全屏，见 RuntimeLogBox。 */}
      <RuntimeLogBox
        className="mt-4"
        emptyHint={
          <>
            暂无日志 —— 点「启动 Drizzle Studio」后这里会实时输出拉起 过程（spawn 参数与 drizzle-kit
            输出）；也可点「刷新」查看 最近一次启动日志。
          </>
        }
        fileName="drizzle-studio-runtime.log"
        log={c.dbStudioLog}
      />
      <p className="text-muted-foreground mt-3 text-xs">
        说明：Drizzle Studio 需要本机开发依赖 （node_modules 里的
        drizzle-kit）。双击桌面壳的开发模式可用； 若当前是不可携带完整 node_modules 的 standalone
        打包，启动时会 提示未找到 drizzle-kit。
      </p>
    </SettingsCard>
  );
}
