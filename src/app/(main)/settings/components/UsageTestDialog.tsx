"use client";

/**
 * 「实际使用」测试弹窗（规范 17 §17.2 第③层）。
 * 按用途真实调用一次，路径 / 提示词 / 尺寸 / 额外字段均可自定义；图片 / 视频
 * 消耗提供方额度（弹窗内有预告）。交互态与动作由 `useUsageTestDialogs` 承载。
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
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { FilePicker, useFilePicker } from "~/components/ui/file-picker";
import { Hint } from "~/components/ui/hint";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { FormField } from "~/components/ui/form-field";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Input } from "~/components/ui/input";

import { FieldImagePreview } from "./SettingsPrimitives";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { OVERLAY_MAX_HEIGHT } from "~/components/ui/overlay-max-height";
import { fixed } from "~/lib/number-format";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";
import type { UsageTestDialogs, UsageTestDialogState } from "../hooks/use-usage-test-dialogs";

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
  d: UsageTestDialogs;
  /** 非空由调用方保证：仅在弹窗打开时渲染。 */
  usageTest: NonNullable<UsageTestDialogState>;
}) {
  /* 关闭语义（Esc / 点遮罩）交给 `ui/dialog`：此前自绘遮罩 div + 手写
     `onClick`，Esc 与焦点归还都没有。 */
  /* mode 快捷选择的当前值：fields 里的 mode 值合法（在预设清单内、非坏值）
   * 才回填 ToggleGroup，否则给空数组（全不选）。 */
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          d.closeUsageTest();
        }
      }}
      open
    >
      {/* 本弹窗自绘关闭按钮（见下方 header）——必须关掉基元的内置那枚，
          否则会渲染出两枚重叠的 ✕（见 `ui/dialog` 的 `showCloseButton`）。 */}
      <DialogContent
        aria-label={`实际调用测试 · ${USAGE_TEST_KIND_LABELS[usageTest.kind]}`}
        className="bg-transparent p-0 ring-0"
        popupClassName="max-w-md"
        showCloseButton={false}
      >
        <div
          className={`border-border bg-surface ${OVERLAY_MAX_HEIGHT} w-full max-w-md overflow-y-auto rounded-2xl border p-5 shadow-2xl`}
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="u-title">实际调用测试 · {USAGE_TEST_KIND_LABELS[usageTest.kind]}</h3>
            <Button
              aria-label="关闭"
              className="text-muted-foreground hover:text-ink"
              onClick={() => {
                d.closeUsageTest();
              }}
              size="icon-sm"
              variant="ghost"
            >
              ✕
            </Button>
          </div>

          {/* 接口地址 / 端点路径 / API Key 不再展示：
                弹窗打开时按条目配置预填（openUsageTest），API Key 留空
                即回落条目密钥——高级定制仍可在模型编辑弹窗里改。 */}
          <FormField className="mb-3" id="usage-test-prompt" label="提示词">
            {(a11y) => (
              <Textarea
                {...a11y}
                className="border-border text-ink bg-surface-2 resize-y"
                onChange={(event) => {
                  d.patchUsageTest({ prompt: event.target.value });
                }}
                rows={2}
                value={usageTest.prompt}
              />
            )}
          </FormField>

          {usageTest.kind === "image" && (
            <>
              <FormField className="mb-3" id="usage-test-size" label="尺寸">
                {(a11y) => (
                  <Input
                    {...a11y}
                    className="border-border text-ink bg-surface-2"
                    onChange={(event) => {
                      d.patchUsageTest({ size: event.target.value });
                    }}
                    placeholder="1024x1024"
                    type="text"
                    value={usageTest.size}
                  />
                )}
              </FormField>
            </>
          )}

          {usageTest.kind === "video" && (
            <>
              <FormField className="mb-3" id="usage-test-size" label="尺寸（可选，留空 = 不传）">
                {(a11y) => (
                  <Input
                    {...a11y}
                    className="border-border text-ink bg-surface-2"
                    onChange={(event) => {
                      d.patchUsageTest({ size: event.target.value });
                    }}
                    placeholder="如 720P（Agnes Flash 固定值）或 1280x704"
                    type="text"
                    value={usageTest.size}
                  />
                )}
              </FormField>
            </>
          )}

          {/* 这一处**没有单一控件**（下方是逐字段的行编辑器），所以标签行
              只是小标题 —— 不传 `id`，`FormField` 用 `useId` 兜一份不参与
              关联的 id（`htmlFor` 指向不存在的元素没有副作用，但也不该硬写
              一个假的）。说明文字走 `hint`。 */}
          <FormField
            className="mb-2"
            hint={
              <>
                每个字段用「字段名 + 值」两格填，替代原先手填整段 JSON；值可为 文本 / 数字 /
                图片（点「上传」选本地图片，或点「链接」直接粘贴公网图片地址）。 数值自动按数字 /
                布尔解析（如 seed 填 42 即数字）。
                {usageTest.kind !== "chat" && <> ⚠ {MEDIA_URL_NOTICE}</>}
              </>
            }
            label="请求体额外字段"
          />

          {usageTest.kind === "video" && <UsageVideoModeQuickPick d={d} usageTest={usageTest} />}

          <UsageFieldEditor d={d} usageTest={usageTest} />

          {(usageTest.kind === "image" || usageTest.kind === "video") && (
            <div className="mb-3">
              <p className="text-muted-foreground text-2xs mb-1.5">
                固定名称字段可一键添加，无需手输拼错 （images / first_frame / seed 等）：
              </p>
              <div className="flex flex-wrap gap-1.5">
                {USAGE_FIELD_PRESETS.map((preset) => {
                  const already = hasUsageFieldKey(usageTest.fields, preset.key);
                  return (
                    <Hint
                      key={preset.key}
                      label={already ? `已有 ${preset.key} 字段行，直接改那行即可` : preset.hint}
                    >
                      <Button
                        className={`text-2xs h-auto rounded-full px-2 py-1 ${
                          already
                            ? "bg-primary/5 border-primary/50 text-primary"
                            : "text-muted-foreground hover:text-ink border-border"
                        }`}
                        onClick={() => {
                          d.addPresetField(preset.key);
                        }}
                        size="xs"
                        variant="outline"
                      >
                        ＋ {preset.key}
                        {already ? " ✓" : ""}
                      </Button>
                    </Hint>
                  );
                })}
              </div>
            </div>
          )}

          {(usageTest.kind === "image" || usageTest.kind === "video") && (
            <p className="bg-warning/10 text-warning-strong text-2xs mb-3 rounded-lg px-3 py-2">
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
            <UsageTestResultPanel c={c} d={d} result={usageTest.result} usageTest={usageTest} />
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button
              className="text-muted-foreground h-auto rounded-lg px-4 py-2 text-sm"
              onClick={() => {
                d.closeUsageTest();
              }}
              variant="outline"
            >
              关闭
            </Button>
            <Button
              className="h-auto rounded-lg px-4 py-2 text-sm font-semibold"
              disabled={usageTest.running || usageTest.querying || !usageTest.prompt.trim()}
              onClick={() => {
                void d.runUsageTest();
              }}
            >
              {usageTest.querying ? "等待中…" : usageTest.running ? "调用中…" : "执行测试"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** video 专用的 mode 快捷选择与「mode 被图片覆盖」救援提示。纯展示，动作全经 d。 */
function UsageVideoModeQuickPick({
  d,
  usageTest,
}: {
  d: UsageTestDialogs;
  usageTest: NonNullable<UsageTestDialogState>;
}) {
  /* mode 快捷选择的当前值：fields 里的 mode 值合法（在预设清单内、非坏值）
   * 才回填 ToggleGroup，否则给空数组（全不选）。 */
  const modeValue = usageTest.fields.find((f) => f.key === "mode")?.value;
  const trimmedModeValue = modeValue?.trim();
  const modeValueIsBroken =
    modeValue !== null && modeValue !== undefined && isModeValueBroken(modeValue);
  const modeToggleValue =
    trimmedModeValue !== undefined &&
    trimmedModeValue !== "" &&
    !modeValueIsBroken &&
    VIDEO_MODE_PRESETS.some((p) => p === trimmedModeValue)
      ? [trimmedModeValue]
      : [];
  return (
    <>
      <div className="mb-2">
        <p className="text-ink/70 mb-1 text-xs font-medium">mode 快捷选择（仍可手改任意值）</p>
        <ToggleGroup
          aria-label="视频 mode 快捷选择"
          className="flex-wrap gap-1.5"
          multiple={false}
          onValueChange={(vals) => {
            const next = vals[0];
            if (typeof next === "string") {
              d.setVideoMode(next);
            }
          }}
          value={modeToggleValue}
        >
          {VIDEO_MODE_PRESETS.map((m) => (
            <ToggleGroupItem className="text-2xs h-auto rounded-full px-2.5 py-1" key={m} value={m}>
              {m}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {usageTest.fields.map((f) => {
          if (f.key !== "mode") {
            return null;
          }
          const hint = VIDEO_MODE_HINT[f.value.trim()];
          return hint !== undefined && hint !== "" ? (
            <p className="text-muted-foreground text-2xs mt-1" key="mode-hint">
              {hint}
            </p>
          ) : null;
        })}
        {usageTest.fields.map((f) => {
          if (f.key !== "mode" || !isModeValueBroken(f.value)) {
            return null;
          }
          const i = usageTest.fields.indexOf(f);
          return (
            <div
              className="border-warning/60 bg-warning/5 text-warning-strong text-2xs mt-1 rounded-lg border border-dashed px-2 py-1.5"
              key="mode-broken"
            >
              <p>
                ⚠ mode 的值被图片/链接覆盖了——这正是「reference 选中消失」和 400 invalid mode
                的原因。点下方按钮把图搬到 images 行，或直接把输入框改回 text / keyframe /
                reference。
              </p>
              {isPreviewableUrl(f.value) && (
                <Button
                  className="border-warning/60 hover:bg-warning/10 text-2xs mt-1 h-auto rounded px-2 py-0.5"
                  onClick={() => {
                    d.rescueMediaFromMode(i, f.value.trim());
                  }}
                  size="xs"
                  variant="outline"
                >
                  把这张图搬到 images 行，mode 复位为 text
                </Button>
              )}
            </div>
          );
        })}
        {(() => {
          const missingHint = videoModeMissingHint(usageTest.fields);
          return missingHint !== null && missingHint !== "" ? (
            <p className="border-warning/60 bg-warning/5 text-warning-strong text-2xs mt-1 rounded-lg border border-dashed px-2 py-1.5">
              ⚠ {missingHint}
            </p>
          ) : null;
        })()}
      </div>
    </>
  );
}

/** 请求体额外字段编辑器：空态提示 + 字段行（上传 / 链接 / 删除）+ 添加按钮。纯展示。 */
function UsageFieldEditor({
  d,
  usageTest,
}: {
  d: UsageTestDialogs;
  usageTest: NonNullable<UsageTestDialogState>;
}) {
  return (
    <>
      {usageTest.fields.length === 0 && (
        <p className="text-muted-foreground border-border text-2xs mb-2 rounded-lg border border-dashed px-3 py-3 text-center">
          还没有额外字段。点下方「添加字段」可按需补 seed / duration / first_frame 等。
        </p>
      )}

      <div className="mb-2 flex flex-col gap-2">
        {d.usageFieldsToSend(usageTest).map((f) => {
          /* `i` 是给动作用的**当下下标**，不能当 React 的 `key`：删中间一行会让
           * 后面行的下标整体左移，React 复用错误 DOM 节点，输入内容会闪到隔壁
           * 字段。`key` 用 `f.id`（字段自带的稳定标识，见 `usage-test-config`）。 */
          const i = usageTest.fields.indexOf(f);
          return (
            <div className="flex flex-col gap-1.5" key={f.id}>
              <div className="flex gap-1.5">
                <Input
                  className="border-border text-ink bg-surface-2 w-2/5 min-w-0 font-mono text-xs"
                  onChange={(event) => {
                    d.patchField(i, { key: event.target.value });
                  }}
                  placeholder="字段名（如 seed / first_frame）"
                  type="text"
                  value={f.key}
                />
                <Input
                  className="border-border text-ink bg-surface-2 w-full min-w-0 font-mono text-xs"
                  onChange={(event) => {
                    d.patchField(i, { value: event.target.value });
                  }}
                  placeholder={
                    f.key === "mode"
                      ? "模式名：text / keyframe / reference（图片请添加 images 行）"
                      : isPreviewableUrl(f.value)
                        ? "已设为图片，可粘贴新的图片地址覆盖"
                        : isMediaArrayField(f.key)
                          ? "值：一张或多张图片 URL（多张用逗号分隔，如 a,b）"
                          : "值：文本 / 数字 / 图片地址"
                  }
                  type="text"
                  value={f.value}
                />
                {f.key === "mode" ? (
                  <span
                    className="text-muted-foreground/40 border-border/40 text-2xs shrink-0 cursor-not-allowed rounded-lg border px-2 py-1.5"
                    title="mode 是模式名（text / keyframe / reference），不能填图片；先添加 images / first_frame 行再传图"
                  >
                    上传
                  </span>
                ) : (
                  <FieldImageButton
                    hint="本地上传一张图片作为该字段的值（自动转 data URL）"
                    onPick={(file) => {
                      void d.pickFieldImage(i, file);
                    }}
                  />
                )}
                {!(usageTest.kind === "video" && isMediaField(f.key)) && f.key !== "mode" && (
                  <Hint label="填入公网图片地址占位，直接改成你的图片 URL 即可">
                    <Button
                      className="text-muted-foreground hover:text-ink text-2xs h-auto shrink-0 rounded-lg px-2"
                      onClick={() => {
                        d.patchField(i, { value: "https://" });
                      }}
                      size="xs"
                      variant="outline"
                    >
                      链接
                    </Button>
                  </Hint>
                )}
                <Button
                  aria-label="删除该字段"
                  className="text-muted-foreground hover:text-danger-strong"
                  onClick={() => {
                    d.removeField(i);
                  }}
                  size="icon-xs"
                  variant="ghost"
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
        className="text-muted-foreground hover:text-ink border-border mb-3 h-auto rounded-lg border-dashed px-3 py-1.5 text-xs"
        onClick={() => {
          d.addField();
        }}
        size="xs"
        variant="outline"
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
  d: UsageTestDialogs;
  /** 非空由调用方保证：仅在有结果且不在调用中时渲染。 */
  result: NonNullable<UsageTestDialogState["result"]>;
  usageTest: NonNullable<UsageTestDialogState>;
}) {
  return (
    <>
      <div className="mb-3">
        {result.ok ? (
          <>
            <p className="bg-success/10 text-success-strong mb-2 rounded-lg px-3 py-2 text-xs">
              {result.detail}
              {result.elapsedMs !== null &&
                result.elapsedMs !== undefined &&
                ` · 耗时 ${fixed(result.elapsedMs / 1000, 1) ?? "0"}s`}
            </p>
            {result.chatText !== undefined && result.chatText !== "" && (
              <p className="border-border/50 bg-surface-row max-h-40 overflow-y-auto rounded-lg border p-3 text-xs whitespace-pre-wrap">
                {result.chatText}
              </p>
            )}
            {result.imageUrl !== undefined && result.imageUrl !== "" && (
              <MediaThumbnail
                alt="生成结果"
                className="border-border/50 max-h-56 w-full rounded-lg border"
                src={result.imageUrl}
              />
            )}
            {result.videoUrl !== undefined && result.videoUrl !== "" && (
              <Hint label="在系统默认浏览器中打开生成的视频">
                <Button
                  className="text-primary h-auto items-center gap-1 p-0 text-xs font-medium"
                  onClick={() => {
                    void c.openExternalUrl(result.videoUrl ?? "");
                  }}
                  variant="link"
                >
                  打开生成的视频
                </Button>
              </Hint>
            )}
            {result.savedPath !== undefined && result.savedPath !== "" && (
              <p
                className="border-border/50 bg-surface-row text-muted-foreground text-2xs mt-2 rounded-lg border px-3 py-2 break-all"
                title="本次产出的内容已在本地 temp 子目录保存一份"
              >
                已保存到本地：
                <span className="font-mono">{result.savedPath}</span>
              </p>
            )}
            {result.pending === true &&
              result.taskId !== undefined &&
              result.taskId !== "" &&
              !usageTest.querying && (
                <div className="bg-warning/10 text-warning-strong mt-2 rounded-lg px-3 py-2 text-xs">
                  <p className="font-medium">
                    ⏳ 视频仍在生成中（不是失败），已提交到提供方， 生成通常需数十秒到几分钟。
                  </p>
                  <p className="text-muted-foreground mt-1 break-all">任务 ID：{result.taskId}</p>
                  <Button
                    className="mt-2 h-auto items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold"
                    disabled={usageTest.querying}
                    onClick={() => {
                      void d.continueUsageWait();
                    }}
                    variant="warning-solid"
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

/** 单行的「上传图片」入口：外观是 `label` 样式的按钮，内部是
 *  隐藏 input —— 此前这里用 `<label>` 包住 `<input type=file>` 让浏览器
 *  隐式关联，写法与全库另外 8 个落点都不同。现在统一走 `ui/file-picker`。 */
function FieldImageButton({ hint, onPick }: { hint: string; onPick: (file: File) => void }) {
  const picker = useFilePicker({
    accept: "image/png,image/jpeg,image/webp,image/gif",
    onPick: (file) => {
      onPick(file);
    },
  });
  return (
    <>
      <Hint label={hint}>
        <Button
          className="text-muted-foreground hover:text-ink border-border hover:bg-subtle text-2xs h-auto shrink-0 gap-1 rounded-lg px-2 transition-colors"
          onClick={picker.open}
          size="xs"
          variant="outline"
        >
          上传
        </Button>
      </Hint>
      <FilePicker {...picker.inputProps} />
    </>
  );
}
