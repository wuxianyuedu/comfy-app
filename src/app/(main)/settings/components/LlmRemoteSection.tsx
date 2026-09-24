"use client";

/**
 * 远程模型（OpenAI 兼容）分区（规范 17 §17.2 第③层）。
 *
 * 只维护模型清单：按用途（文本 / 图片 / 视频）分组展示，行内提供
 * 「测试连接」「测试生成」「编辑」「移除」。列表与动作来自 controller，
 * 弹窗交互状态来自`useRemoteModelDialogs`（第②层），两个弹窗各自成组件。
 */

import type { RemoteModelKind } from "~/lib/llm/types";
import { Button } from "~/components/ui/button";

import { Card } from "./SettingsPrimitives";
import { RemoteModelDialog } from "./RemoteModelDialog";
import { UsageTestDialog } from "./UsageTestDialog";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";
import type { RemoteModelDialogs } from "../hooks/use-remote-model-dialogs";

export function LlmRemoteSection({
  c,
  d,
}: {
  c: ReadySettingsPageController;
  d: RemoteModelDialogs;
}) {
  /* 远程模型按用途分组展示（文本 / 图片 / 视频）；kind 缺省的历史条目
   * 按文本模型归组。行内不再重复用途标签 —— 分组本身就是用途。 */
  function remoteModelGroup(
    kind: RemoteModelKind,
    title: string,
    emptyHint: string,
  ) {
    const entries = c.remoteModelList.filter(
      (entry) => (entry.kind ?? "chat") === kind,
    );
    return (
      <div className="border-border bg-surface-1 mb-4 rounded-xl border p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-ink/80 text-sm font-medium">{title}</span>
          <Button
            size="lg"
            onClick={() => d.openAddDialog(kind)}
            className="h-auto rounded-lg px-3 py-1.5 text-xs font-semibold"
          >
            ＋ 添加模型
          </Button>
        </div>
        {entries.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {entries.map((entry) => {
              const thisProbe =
                d.rowProbe?.name === entry.name ? d.rowProbe : null;
              const rowMsg = thisProbe ? thisProbe.msg : null;
              return (
                <div key={entry.name} className="flex-col gap-1">
                  <div className="border-border flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-ink">{entry.name}</span>
                      {entry.baseUrl && (
                        <span className="text-muted-foreground ml-2 text-[10px]">
                          独立接口
                        </span>
                      )}
                      {entry.apiKey && (
                        <span className="text-muted-foreground ml-1.5 text-[10px]">
                          独立密钥
                        </span>
                      )}
                    </span>
                    <Button
                      variant="outline"
                      size="xs"
                      title="按该条目配置探测接口连通性（不生成、不耗额度）"
                      disabled={!!thisProbe?.running}
                      onClick={() => void d.runEntryConnectionTest(entry)}
                      className="text-muted-foreground h-auto rounded px-1.5 py-0.5 text-[11px]"
                    >
                      {thisProbe?.running ? "连接测试中…" : "测试连接"}
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      title="按实际用法发起一次真实生成调用（参数可在弹窗内自定义）"
                      onClick={() => d.openUsageTest(kind, entry)}
                      className="text-muted-foreground h-auto rounded px-1.5 py-0.5 text-[11px]"
                    >
                      测试生成
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      title="编辑接口地址 / 密钥 / 名称"
                      onClick={() => d.openEditDialog(entry)}
                      className="text-muted-foreground h-auto rounded px-1.5 py-0.5 text-[11px]"
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="移除该模型（即时保存）"
                      aria-label={`移除模型 ${entry.name}`}
                      onClick={() => void c.removeRemoteModel(entry.name)}
                      className="text-muted-foreground hover:text-danger-strong"
                    >
                      ✕
                    </Button>
                  </div>
                  {rowMsg && (
                    <div
                      className={`mr-1 ml-1 rounded border px-2 py-1 text-[11px] ${
                        rowMsg.kind === "ok"
                          ? "border-success/30 bg-success/10 text-success-strong"
                          : "border-destructive/30 bg-destructive/10 text-danger-strong"
                      }`}
                    >
                      {rowMsg.text}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">{emptyHint}</p>
        )}
      </div>
    );
  }

  return (
    <>
      <Card title="远程模型（OpenAI 兼容）">
        {/* 模型按用途分组：文本（对话）/ 图片 / 视频；kind 缺省的
 历史条目按文本模型归组，添加时按组预选用途 */}
        {remoteModelGroup(
          "chat",
          "文本模型",
          "还没有文本模型 —— 点击「添加模型」加入对话 / 写作调用的模型。",
        )}
        {remoteModelGroup(
          "image",
          "图片模型",
          "还没有图片模型 —— 点击「添加模型」加入生图 API 使用的模型。",
        )}
        {remoteModelGroup(
          "video",
          "视频模型",
          "还没有视频模型 —— 点击「添加模型」加入视频生成 API 使用的模型。",
        )}

        <p className="text-muted-foreground mb-4 text-[11px] leading-relaxed">
          此页只维护模型清单，添加 / 编辑 / 移除都会
          <strong className="text-ink/80">即时保存</strong>
          ：「测试连接」按该条目自身配置探测接口连通性（不生成、不耗额度）；「测试生成」按实际用法发起一次真实调用（参数可在弹窗内自定义，图片
          /
          视频会消耗额度）。带「独立接口／独立密钥」的模型调用时使用条目内配置，其余走已保存的全局连接配置。实际使用哪个模型在工坊运行界面选择。
        </p>
      </Card>

      {/* 「添加 / 编辑模型」弹窗：接口地址 / API Key 可留空回落全局；
 编辑态密钥「留空不改」，可显式清除。测试连接成功后顺带展示
 服务端模型清单供点选。 */}
      {d.dialog && <RemoteModelDialog c={c} d={d} dialog={d.dialog} />}

      {/* 「实际使用」测试弹窗：按用途真实调用一次（chat / 生图 / 生视频），
 路径 / 提示词 / 尺寸 / 额外参数均可自定义输入。 */}
      {d.usageTest && <UsageTestDialog c={c} d={d} usageTest={d.usageTest} />}
    </>
  );
}
