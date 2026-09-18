"use client";

/**
 * 「实际使用」测试弹窗（规范 17 §17.2 第③层）。
 *
 * 按用途（chat / 生图 / 生视频）真实调用一次；路径 / 提示词 / 尺寸 / 额外字段
 * 均可自定义输入。图片 / 视频会消耗提供方额度，弹窗内有预告。交互状态与动作
 * 由 `useRemoteModelDialogs`（第②层）承载。
 */

import {
  MEDIA_URL_NOTICE,
  USAGE_FIELD_PRESETS,
  VIDEO_MODE_HINT,
  VIDEO_MODE_PRESETS,
  isMediaArrayField,
  isMediaField,
  isModeValueBroken,
  hasUsageFieldKey,
  isPreviewableUrl,
  videoModeMissingHint,
} from "~/lib/llm/usage-test-config";
import type { UsageTestKind } from "~/lib/llm/usage-test-client";
import { overlayClass } from "~/lib/full-screen-layer";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/page-loading";
import { Textarea } from "~/components/ui/textarea";
import { Input } from "~/components/ui/input";

import { FieldImagePreview } from "./SettingsPrimitives";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";
import type {
  RemoteModelDialogs,
  UsageTestDialogState,
} from "../hooks/use-remote-model-dialogs";

const USAGE_TEST_KIND_LABELS: Record<UsageTestKind, string> = {
  chat: "文本",
  image: "图片",
  video: "视频",
};
export function UsageTestDialog({
  c,
  d,
  usageTest,
}: {
  c: ReadySettingsPageController;
  d: RemoteModelDialogs;
  /** 非空由调用方保证：仅在弹窗打开时渲染。 */
  usageTest: NonNullable<UsageTestDialogState>;
}) {
  return (
    <>
      <div
        className={overlayClass(
          "modal",
          "bg-canvas-deep z-50 grid place-items-center p-4",
        )}
        onClick={() => d.closeUsageTest()}
      >
        <div
          className="border-border bg-surface max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border p-5 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="u-title">
              实际调用测试 · {USAGE_TEST_KIND_LABELS[usageTest.kind]}
            </h3>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => d.closeUsageTest()}
              className="text-muted-foreground hover:text-ink"
              aria-label="关闭"
            >
              ✕
            </Button>
          </div>

          {/* 接口地址 / 端点路径 / API Key 不再展示：
                弹窗打开时按条目配置预填（openUsageTest），API Key 留空
                即回落条目密钥——高级定制仍可在模型编辑弹窗里改。 */}
          <label className="text-ink/80 mb-1.5 block text-sm font-medium">
            提示词
          </label>
          <Textarea
            value={usageTest.prompt}
            onChange={(event) =>
              d.patchUsageTest({ prompt: event.target.value })
            }
            rows={2}
            className="border-border text-ink bg-surface-2 mb-3 resize-y"
          />

          {usageTest.kind === "image" && (
            <>
              <label className="text-ink/80 mb-1.5 block text-sm font-medium">
                尺寸
              </label>
              <Input
                type="text"
                value={usageTest.size}
                onChange={(event) =>
                  d.patchUsageTest({ size: event.target.value })
                }
                placeholder="1024x1024"
                className="border-border text-ink bg-surface-2 mb-3"
              />
            </>
          )}

          {usageTest.kind === "video" && (
            <>
              <label className="text-ink/80 mb-1.5 block text-sm font-medium">
                尺寸（可选，留空 = 不传）
              </label>
              <Input
                type="text"
                value={usageTest.size}
                onChange={(event) =>
                  d.patchUsageTest({ size: event.target.value })
                }
                placeholder="如 720P（Agnes Flash 固定值）或 1280x704"
                className="border-border text-ink bg-surface-2 mb-3"
              />
            </>
          )}

          <label className="text-ink/80 mb-1.5 block text-sm font-medium">
            请求体额外字段
          </label>
          <p className="text-muted-foreground -mt-1 mb-2 text-[11px]">
            每个字段用「字段名 + 值」两格填，替代原先手填整段 JSON；值可为 文本
            / 数字 /
            图片（点「上传」选本地图片，或点「链接」直接粘贴公网图片地址）。
            数值自动按数字 / 布尔解析（如 seed 填 42 即数字）。
          </p>
          {usageTest.kind !== "chat" && (
            <p className="text-muted-foreground -mt-1 mb-2 text-[11px]">
              ⚠ {MEDIA_URL_NOTICE}
            </p>
          )}

          {usageTest.kind === "video" && (
            <UsageVideoModeQuickPick d={d} usageTest={usageTest} />
          )}

          <UsageFieldEditor d={d} usageTest={usageTest} />

          {(usageTest.kind === "image" || usageTest.kind === "video") && (
            <div className="mb-3">
              <p className="text-muted-foreground mb-1.5 text-[11px]">
                固定名称字段可一键添加，无需手输拼错 （images / first_frame /
                seed 等）：
              </p>
              <div className="flex flex-wrap gap-1.5">
                {USAGE_FIELD_PRESETS.map((preset) => {
                  const already = hasUsageFieldKey(
                    usageTest.fields,
                    preset.key,
                  );
                  return (
                    <Button
                      key={preset.key}
                      variant="outline"
                      size="xs"
                      onClick={() => d.addPresetField(preset.key)}
                      title={
                        already
                          ? `已有 ${preset.key} 字段行，直接改那行即可`
                          : preset.hint
                      }
                      className={`h-auto rounded-full px-2 py-1 text-[11px] ${
                        already
                          ? "bg-primary/5 border-primary/50 text-primary"
                          : "text-muted-foreground hover:text-ink border-border"
                      }`}
                    >
                      ＋ {preset.key}
                      {already ? " ✓" : ""}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {(usageTest.kind === "image" || usageTest.kind === "video") && (
            <p className="bg-warning/10 text-warning-strong mb-3 rounded-lg px-3 py-2 text-[11px]">
              ⚠ 会真实调用生成接口并消耗提供方额度。
            </p>
          )}

          {usageTest.running && (
            <p className="text-muted-foreground mb-3 flex items-center gap-2 text-xs">
              <Spinner className="size-3.5" />
              正在按实际用法调用…
            </p>
          )}

          {usageTest.querying && !usageTest.running && (
            <p className="bg-info/10 text-info-strong mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
              <Spinner className="size-3.5" />
              正在继续等待视频生成完成…（不会重复提交）
            </p>
          )}

          {usageTest.result && !usageTest.running && (
            <UsageTestResultPanel
              c={c}
              d={d}
              usageTest={usageTest}
              result={usageTest.result}
            />
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => d.closeUsageTest()}
              className="text-muted-foreground h-auto rounded-lg px-4 py-2 text-sm"
            >
              关闭
            </Button>
            <Button
              onClick={() => void d.runUsageTest()}
              disabled={
                usageTest.running ||
                usageTest.querying ||
                !usageTest.prompt.trim()
              }
              className="h-auto rounded-lg px-4 py-2 text-sm font-semibold"
            >
              {usageTest.querying
                ? "等待中…"
                : usageTest.running
                  ? "调用中…"
                  : "执行测试"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/** video 专用的 mode 快捷选择与「mode 被图片覆盖」救援提示。纯展示，动作全经 d。 */
function UsageVideoModeQuickPick({
  d,
  usageTest,
}: {
  d: RemoteModelDialogs;
  usageTest: NonNullable<UsageTestDialogState>;
}) {
  return (
    <>
      <div className="mb-2">
        <p className="text-ink/70 mb-1 text-xs font-medium">
          mode 快捷选择（仍可手改任意值）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {VIDEO_MODE_PRESETS.map((m) => {
            const modeValue = usageTest.fields.find(
              (f) => f.key === "mode",
            )?.value;
            const active =
              modeValue?.trim() === m && !isModeValueBroken(modeValue ?? "");
            return (
              <Button
                key={m}
                variant="outline"
                size="xs"
                aria-pressed={active}
                onClick={() => d.setVideoMode(m)}
                className={`h-auto rounded-full px-2.5 py-1 text-[11px] ${
                  active
                    ? "bg-primary/15 border-primary text-primary"
                    : "text-muted-foreground hover:bg-subtle border-border"
                }`}
              >
                {m}
              </Button>
            );
          })}
        </div>
        {usageTest.fields.map((f) => {
          if (f.key !== "mode") return null;
          const hint = VIDEO_MODE_HINT[f.value.trim()];
          return hint ? (
            <p
              key="mode-hint"
              className="text-muted-foreground mt-1 text-[11px]"
            >
              {hint}
            </p>
          ) : null;
        })}
        {usageTest.fields.map((f) => {
          if (f.key !== "mode" || !isModeValueBroken(f.value)) return null;
          const i = usageTest.fields.indexOf(f);
          return (
            <div
              key="mode-broken"
              className="border-warning/60 bg-warning/5 text-warning-strong mt-1 rounded-lg border border-dashed px-2 py-1.5 text-[11px]"
            >
              <p>
                ⚠ mode 的值被图片/链接覆盖了——这正是「reference 选中消失」和 400
                invalid mode 的原因。点下方按钮把图搬到 images
                行，或直接把输入框改回 text / keyframe / reference。
              </p>
              {isPreviewableUrl(f.value) && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => d.rescueMediaFromMode(i, f.value.trim())}
                  className="border-warning/60 hover:bg-warning/10 mt-1 h-auto rounded px-2 py-0.5 text-[11px]"
                >
                  把这张图搬到 images 行，mode 复位为 text
                </Button>
              )}
            </div>
          );
        })}
        {videoModeMissingHint(usageTest.fields) && (
          <p className="border-warning/60 bg-warning/5 text-warning-strong mt-1 rounded-lg border border-dashed px-2 py-1.5 text-[11px]">
            ⚠ {videoModeMissingHint(usageTest.fields)}
          </p>
        )}
      </div>
    </>
  );
}

/** 请求体额外字段编辑器：空态提示 + 字段行（上传 / 链接 / 删除）+ 添加按钮。纯展示。 */
function UsageFieldEditor({
  d,
  usageTest,
}: {
  d: RemoteModelDialogs;
  usageTest: NonNullable<UsageTestDialogState>;
}) {
  return (
    <>
      {usageTest.fields.length === 0 && (
        <p className="text-muted-foreground border-border mb-2 rounded-lg border border-dashed px-3 py-3 text-center text-[11px]">
          还没有额外字段。点下方「添加字段」可按需补 seed / duration /
          first_frame 等。
        </p>
      )}

      <div className="mb-2 flex flex-col gap-2">
        {d.usageFieldsToSend(usageTest).map((f) => {
          const i = usageTest.fields.indexOf(f);
          return (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="flex gap-1.5">
                <Input
                  type="text"
                  value={f.key}
                  onChange={(event) =>
                    d.patchField(i, { key: event.target.value })
                  }
                  placeholder="字段名（如 seed / first_frame）"
                  className="border-border text-ink bg-surface-2 w-2/5 min-w-0 font-mono text-xs"
                />
                <Input
                  type="text"
                  value={f.value}
                  onChange={(event) =>
                    d.patchField(i, { value: event.target.value })
                  }
                  placeholder={
                    f.key === "mode"
                      ? "模式名：text / keyframe / reference（图片请添加 images 行）"
                      : isPreviewableUrl(f.value)
                        ? "已设为图片，可粘贴新的图片地址覆盖"
                        : isMediaArrayField(f.key)
                          ? "值：一张或多张图片 URL（多张用逗号分隔，如 a,b）"
                          : "值：文本 / 数字 / 图片地址"
                  }
                  className="border-border text-ink bg-surface-2 w-full min-w-0 font-mono text-xs"
                />
                {f.key === "mode" ? (
                  <span
                    className="text-muted-foreground/40 border-border/40 shrink-0 cursor-not-allowed rounded-lg border px-2 py-1.5 text-[11px]"
                    title="mode 是模式名（text / keyframe / reference），不能填图片；先添加 images / first_frame 行再传图"
                  >
                    上传
                  </span>
                ) : (
                  <label
                    className="text-muted-foreground hover:text-ink border-border hover:bg-subtle flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-2 text-[11px] transition-colors"
                    title="本地上传一张图片作为该字段的值（自动转 data URL）"
                  >
                    上传
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={(event) =>
                        void d.pickFieldImage(i, event.target.files?.[0])
                      }
                    />
                  </label>
                )}
                {!(usageTest.kind === "video" && isMediaField(f.key)) &&
                  f.key !== "mode" && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => d.patchField(i, { value: "https://" })}
                      className="text-muted-foreground hover:text-ink h-auto shrink-0 rounded-lg px-2 text-[11px]"
                      title="填入公网图片地址占位，直接改成你的图片 URL 即可"
                    >
                      链接
                    </Button>
                  )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => d.removeField(i)}
                  className="text-muted-foreground hover:text-danger-strong"
                  aria-label="删除该字段"
                >
                  ✕
                </Button>
              </div>
              {isPreviewableUrl(f.value) && <FieldImagePreview src={f.value} />}
            </div>
          );
        })}
      </div>

      <Button
        variant="outline"
        size="xs"
        onClick={() => d.addField()}
        className="text-muted-foreground hover:text-ink border-border mb-3 h-auto rounded-lg border-dashed px-3 py-1.5 text-xs"
      >
        ＋ 添加字段
      </Button>
    </>
  );
}

/** 调用结果面板：成功与失败、文本 / 图片 / 视频，以及未完成任务的「继续等待」出口。 */
function UsageTestResultPanel({
  c,
  d,
  usageTest,
  result,
}: {
  c: ReadySettingsPageController;
  d: RemoteModelDialogs;
  usageTest: NonNullable<UsageTestDialogState>;
  /** 非空由调用方保证：仅在有结果且不在调用中时渲染。 */
  result: NonNullable<UsageTestDialogState["result"]>;
}) {
  return (
    <>
      <div className="mb-3">
        {result.ok ? (
          <>
            <p className="bg-success/10 text-success-strong mb-2 rounded-lg px-3 py-2 text-xs">
              {result.detail}
              {result.elapsedMs != null &&
                ` · 耗时 ${(result.elapsedMs / 1000).toFixed(1)}s`}
            </p>
            {result.chatText && (
              <p className="border-border/50 bg-surface-1 max-h-40 overflow-y-auto rounded-lg border p-3 text-xs whitespace-pre-wrap">
                {result.chatText}
              </p>
            )}
            {result.imageUrl && (
              <img
                src={result.imageUrl}
                alt="生成结果"
                className="border-border/50 max-h-56 w-full rounded-lg border"
              />
            )}
            {result.videoUrl && (
              <Button
                variant="link"
                onClick={() => void c.openExternalUrl(result.videoUrl ?? "")}
                className="text-primary h-auto items-center gap-1 p-0 text-xs font-medium"
                title="在系统默认浏览器中打开生成的视频"
              >
                打开生成的视频
              </Button>
            )}
            {result.savedPath && (
              <p
                className="border-border/50 bg-surface-1 text-muted-foreground mt-2 rounded-lg border px-3 py-2 text-[11px] break-all"
                title="本次产出的内容已在本地 temp 子目录保存一份"
              >
                已保存到本地：
                <span className="font-mono">{result.savedPath}</span>
              </p>
            )}
            {result.pending && result.taskId && !usageTest.querying && (
              <div className="bg-warning/10 text-warning-strong mt-2 rounded-lg px-3 py-2 text-xs">
                <p className="font-medium">
                  ⏳ 视频仍在生成中（不是失败），已提交到提供方，
                  生成通常需数十秒到几分钟。
                </p>
                <p className="text-muted-foreground mt-1 break-all">
                  任务 ID：{result.taskId}
                </p>
                <Button
                  variant="warning-solid"
                  onClick={() => void d.continueUsageWait()}
                  disabled={usageTest.querying}
                  className="mt-2 h-auto items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold"
                >
                  {usageTest.querying ? (
                    <Spinner className="text-primary-foreground size-3" />
                  ) : (
                    "继续等待并获取结果"
                  )}
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="bg-destructive/10 text-danger-strong rounded-lg px-3 py-2 text-xs break-all">
            {result.detail}
          </p>
        )}
      </div>
    </>
  );
}
