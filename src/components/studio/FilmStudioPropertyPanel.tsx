"use client";
/* 影片工坊右栏：镜头属性面板（280px）。上半是样例时间轴的镜头字段
 * （名称 / 时长直接回写本地 shots 状态），下半是成片流程的配置
 * （镜头来源 / 工作流选择 / 字幕 / BGM），经控制器 `c` 上抛。 */
import { textHandler } from "~/lib/form-props";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { SelectMenu } from "~/components/ui/select-menu";
import { Separator } from "~/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { FormField } from "~/components/ui/form-field";
import { FieldLabel } from "~/components/ui/field";
import { Textarea } from "~/components/ui/textarea";
import type { FilmStudioController } from "./hooks/use-film-studio";
import { formatShotDuration, type ShotListItem } from "./film-studio-config";

type FilmStudioPropertyPanelProps = {
  c: FilmStudioController;
  /** 回写本地样例时间轴的镜头字段（名称 / 时长）。 */
  onPatchShot: (id: string, patch: Partial<ShotListItem>) => void;
  selectedShot: ShotListItem;
  selectedShotId: string;
};

export function FilmStudioPropertyPanel({
  c,
  selectedShot,
  selectedShotId,
  onPatchShot,
}: FilmStudioPropertyPanelProps) {
  return (
    <aside className="border-border-subtle bg-panel-deep flex w-70 shrink-0 flex-col border-l">
      {/* Header */}
      <div className="border-border-subtle flex h-11 items-center border-b px-4">
        <span className="text-ink-field text-sm font-semibold">镜头属性</span>
      </div>

      {/* Form fields */}
      <div className="flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* Shot name */}
        <FormField label="镜头名称" labelClassName="text-ink-faint mb-1.5 text-2xs">
          {(field) => (
            <input
              {...field}
              className="border-border bg-subtle text-ink-field focus:border-primary/50 focus:ring-primary/20 h-9 w-full rounded-lg border px-3 text-sm outline-none focus:ring-1"
              onChange={textHandler((name) => {
                onPatchShot(selectedShotId, { name });
              })}
              value={selectedShot.name}
            />
          )}
        </FormField>

        {/* Duration */}
        <FormField label="时长 (秒)" labelClassName="text-ink-faint mb-1.5 text-2xs">
          {(field) => (
            <input
              {...field}
              className="border-border bg-subtle text-ink-field focus:border-primary/50 focus:ring-primary/20 h-9 w-full rounded-lg border px-3 text-sm outline-none focus:ring-1"
              max="30"
              min="0.5"
              onChange={(event) => {
                onPatchShot(selectedShotId, {
                  duration: formatShotDuration(Number(event.target.value)),
                });
              }}
              step="0.1"
              type="number"
              value={Number.parseFloat(selectedShot.duration)}
            />
          )}
        </FormField>

        {/* Mode select */}
        <FormField label="生成模式" labelClassName="text-ink-faint mb-1.5 text-2xs">
          <div className="border-border bg-subtle text-ink-field flex h-9 items-center rounded-lg border px-3 text-sm">
            图生视频 (Wan I2V)
          </div>
        </FormField>

        {/* Transition */}
        <FormField label="转场效果" labelClassName="text-ink-faint mb-1.5 text-2xs">
          <div className="border-border bg-subtle text-ink-strong flex h-9 items-center rounded-lg border px-3 text-sm">
            溶解过渡 (Cross Dissolve)
          </div>
        </FormField>

        {/* Prompt textarea */}
        <FormField label="提示词 / 描述" labelClassName="text-ink-faint mb-1.5 text-2xs">
          {(field) => (
            <Textarea
              {...field}
              className="border-border bg-subtle text-ink-fainter resize-none rounded-lg text-xs leading-relaxed"
              defaultValue="城市在晨光中苏醒，镜头缓缓推进，展现繁忙街道与远处天际线…"
              rows={3}
            />
          )}
        </FormField>

        {/* Divider —— 走 ui/separator（规范 16 §16.2.3）：`<hr>` 自带
 UA 样式，改「分隔线长什么样」要同时找`<hr>` 与 border-t 两种写法。 */}
        <Separator className="bg-border-subtle" />

        {/* 镜头来源：统一项目镜头（工坊产出）/ 剧本自动分镜（自由文本）。
 有活跃项目镜头时默认走项目；无镜头时项目项禁用。P77：走 ui/toggle-group
 （单选、multiple=false），active 视觉由基元的 `data-[state=on]:bg-muted`
 统一持有，不再每处手写 variant=primary/ghost 对。 */}
        <ToggleGroup
          aria-label="镜头来源"
          className="gap-1"
          multiple={false}
          onValueChange={(vals) => {
            const next = vals[0];
            if ((next === "project" || next === "script") && next !== c.shotSource) {
              c.setShotSource(next);
            }
          }}
          value={[c.shotSource]}
        >
          <ToggleGroupItem
            className="h-auto flex-1 rounded-lg px-2.5 py-1 text-xs"
            disabled={
              c.activeProjectId === null || c.activeProjectId === "" || c.projectShotCount === 0
            }
            value="project"
          >
            当前项目镜头
            {c.projectShotCount > 0 ? `（${c.projectShotCount}）` : ""}
          </ToggleGroupItem>
          <ToggleGroupItem className="h-auto flex-1 rounded-lg px-2.5 py-1 text-xs" value="script">
            剧本自动分镜
          </ToggleGroupItem>
        </ToggleGroup>

        {c.shotSource === "project" ? (
          <p className="text-ink-fainter bg-canvas/60 border-border text-2xs rounded-lg border px-3 py-2 leading-relaxed">
            将使用当前项目的 {c.projectShotCount}
            个镜头逐镜生成成片（镜头提示词与风格由工坊产出）。
            如需增删或改镜头，请回到「工坊」调整后再来成片。
          </p>
        ) : (
          /* 全局配置：剧本输入（从原版收起） */
          <FormField label="剧本 / 创意" labelClassName="text-ink-faint mb-1.5 text-2xs">
            {(field) => (
              <Textarea
                {...field}
                className="border-border bg-subtle text-ink-fainter placeholder:text-ink-faintest resize-none rounded-lg text-xs leading-relaxed"
                onChange={textHandler(c.setScript)}
                placeholder="支持一句话自动分镜…"
                rows={3}
                value={c.script}
              />
            )}
          </FormField>
        )}

        {/* 逐镜生成用的工作流（内置模板已移除，必须从工作流库选） */}
        <FormField label="视频工作流（工作流库）" labelClassName="text-ink-faint mb-1.5 text-2xs">
          {(field) => (
            <>
              <SelectMenu
                {...field}
                fullWidth
                labels={Object.fromEntries(c.videoWorkflows.map((wf) => [wf.id, wf.name]))}
                onChange={c.setVideoWorkflowId}
                options={c.videoWorkflows.map((wf) => wf.id)}
                placeholder={
                  c.videoWorkflows.length ? "选择视频工作流…" : "工作流库里还没有视频工作流"
                }
                value={c.videoWorkflowId}
              />
              {!c.videoWorkflowId && (
                <span className="text-ink-fainter text-2xs mt-1 block">
                  没有内置视频工作流可回落 —— 请先在工作室「工作流库」导入并配好对外参数。
                </span>
              )}
            </>
          )}
        </FormField>

        {/* 文生视频镜头合成首帧用的图类工作流（镜头自带首帧时不需要） */}
        <FormField
          label="首帧合成工作流（可选，工作流库）"
          labelClassName="text-ink-faint mb-1.5 text-2xs"
        >
          {(field) => (
            <SelectMenu
              {...field}
              fullWidth
              labels={Object.fromEntries(c.imageWorkflows.map((wf) => [wf.id, wf.name]))}
              onChange={c.setImageWorkflowId}
              options={c.imageWorkflows.map((wf) => wf.id)}
              placeholder={
                c.imageWorkflows.length ? "不需要 / 未选择" : "工作流库里还没有图类工作流"
              }
              value={c.imageWorkflowId}
            />
          )}
        </FormField>

        {/* Subtitle toggle */}
        <FieldLabel className="border-border bg-canvas/60 flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5">
          <span className="text-ink-field text-sm">烧录字幕</span>
          <Checkbox
            checked={c.subtitleOn}
            className="accent-primary"
            onCheckedChange={(checked) => {
              c.setSubtitleOn(checked === true);
            }}
          />
        </FieldLabel>

        {/* BGM upload */}
        <div>
          <span className="text-ink-faint text-2xs mb-1.5 block">背景音乐（可选）</span>
          <input
            accept="audio/*"
            aria-label="背景音乐（可选）"
            className="text-ink-fainter hover:text-primary-strong file:bg-primary/20 file:text-primary-strong text-2xs file:text-2xs w-full file:mr-2 file:rounded-lg file:border-0 file:px-3 file:py-1.5"
            onChange={(event) => {
              const f = event.target.files?.[0];
              if (f) {
                void c.uploadBgmFile(f);
              }
            }}
            type="file"
          />
          {c.bgmName !== null && c.bgmName !== "" && (
            <p className="text-primary-strong text-2xs mt-1 truncate">已选：{c.bgmName}</p>
          )}
        </div>

        {/* Error display */}
        {c.film !== null && c.film.error !== null && c.film.error !== "" && (
          <div className="border-destructive/30 bg-destructive/10 text-destructive text-2xs rounded-lg border px-3 py-2 leading-relaxed">
            {c.film.error}
            {c.film.status === "FAILED" &&
              c.film.shots.some((shot) => shot.status === "SUCCEEDED") && (
                <Button
                  className="ml-2 h-auto text-inherit underline hover:no-underline"
                  onClick={() => {
                    void c.recompose();
                  }}
                  variant="link"
                >
                  重新合成
                </Button>
              )}
          </div>
        )}

        {/* FFmpeg warning */}
        {!c.ffmpegAvailable && (
          <p className="border-warning/30 bg-warning/10 text-warning-strong text-2xs rounded-lg border px-3 py-2 leading-relaxed">
            未检测到 ffmpeg，逐镜视频仍可生成，但无法自动拼接成片。
          </p>
        )}
      </div>
    </aside>
  );
}
