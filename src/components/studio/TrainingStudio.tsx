"use client";

import { useState } from "react";
import { textHandler } from "~/lib/form-props";
import { Upload } from "lucide-react";
import { SelectMenu } from "~/components/ui/select-menu";
import { useFilePicker } from "~/components/ui/file-picker";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { comfyImageUrl } from "~/lib/media/media-url";
import { NumberField } from "~/components/ui/number-field";
import { RangeSlider } from "~/components/ui/range-slider";
import { FormField } from "~/components/ui/form-field";
import { AuroraGlow } from "~/components/ui/aurora-background";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Alert, AlertTitle } from "~/components/ui/alert";
import { EmptyState } from "~/components/ui/empty-state";
import { ProgressBar } from "~/components/ui/progress-bar";
import { KeyValueRows } from "~/components/ui/key-value-rows";
import { useTrainingStudio } from "./hooks/use-training-studio";
import { displayValue } from "~/lib/display-value";
import {
  OPTIMIZERS,
  RESOLUTIONS,
  SCHEDULERS,
  buildLossGeometry,
  statusMeta,
} from "./training-studio-config";

/* ── 布局（在 WorkspaceNav 父壳内） ──
 ┌─────────────────────────────────────────────────────────────┐
 │ 顶部工具栏：[LoRA 训练工作室] … [后端状态] … [开始训练] │
 ├─────────────┬───────────────────────────────┬───────────────┤
 │ 数据集 │ 训练监控 │ 超参数 │
 │ (300px) │ · 进度环 + 指标 │ (320px) │
 │ · 后端横幅 │ · 紫色进度条 │ 名称/底模/触发 │
 │ · 上传区 │ · Loss 曲线 SVG │ 类别词/分辨率 │
 │ · 逐图caption │ · 任务列表 │ 4 滑块 + lr │
 │ │ │ 优化器/调度器 │
 │ │ │ 种子 + 开始 │
 ├─────────────────────────────────────────────────────────────┤
 │ 状态栏：● ComfyUI·Kohya 就绪 · 本地算力 · 零授权 │
 └─────────────────────────────────────────────────────────────┘
*/

const fieldClass =
  "h-9 w-full rounded-lg border-border border bg-subtle px-3 text-[13px] text-ink-field outline-none transition-colors focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/20";
const labelClass = "mb-1.5 block text-[11px] font-medium text-ink-faint";

const RING_R = 36;
const RING_C = 2 * Math.PI * RING_R;

/**
 * LoRA 训练工作室 —— 视图层（规范 17 §17.2 第③层）。
 * 轮询、表单校验、数据集上传与任务创建在 hooks/use-training-studio.ts +
 * lib/dataset-upload-client.ts，类型与派生计算在 training-studio-config.ts。
 * 本文件只做渲染与上抛事件；对外导出名与组件签名保持不变，消费方零改动。
 */
export interface TrainingStudioProps {
  /** workspace 内触发设置 overlay；缺省时保留 Link 跳转行为。 */
  onOpenSettings?: () => void;
}

export function TrainingStudio({ onOpenSettings }: TrainingStudioProps = {}) {
  const router = useRouter();
  const c = useTrainingStudio();

  /* 日志展开态：纯视觉状态，留在视图层 */
  const [expanded, setExpanded] = useState<string | null>(null);

  /* 数据集选择：拖放区整块可点，命中即开系统文件对话框。多选用
   *`multiple`，选完之后交给 hook 逐张串行上传。 */
  const datasetPicker = useFilePicker({
    multiple: true,
    accept: "image/*",
    onPick: (_first: File, files: FileList) => void c.upload(files),
  });

  /* ── 监控卡派生（纯视觉计算）── */
  const activeJob = c.activeJob;
  const ringProgress = activeJob ? activeJob.progress : 0;
  const ringSteps = activeJob
    ? Math.round((activeJob.progress / 100) * activeJob.steps)
    : 0;
  const lossGeo = buildLossGeometry();

  return (
    <div
      className="bg-canvas flex h-full w-full flex-col overflow-hidden"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {/* ── 极光背景光斑 ───────────────── */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <AuroraGlow
          tone="violet"
          alpha={0.4}
          className="top-[-20%] right-[-10%] h-[70%] w-[55%] opacity-10 mix-blend-normal dark:opacity-50 dark:mix-blend-screen"
        />
        <AuroraGlow
          tone="cyan"
          alpha={0.26}
          className="bottom-[15%] left-[-15%] h-[55%] w-[45%] opacity-10 mix-blend-normal dark:opacity-50 dark:mix-blend-screen"
        />
      </div>

      {/* ── Top Toolbar ───────────────────────────── */}
      <header className="border-border-subtle bg-panel/88 z-base relative flex h-12 shrink-0 items-center gap-3 border-b px-4 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <h1 className="font-title u-title-page">LoRA 训练工作室</h1>
          <span className="text-ink-fainter text-xs">· 炼丹</span>
        </div>

        {/* 后端状态药丸 */}
        <div
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${
            c.backendConfigured
              ? "bg-success-strong/12 text-success-strong"
              : "bg-warning/12 text-warning-strong"
          }`}
        >
          <span
            className={`inline-block h-[7px] w-[7px] rounded-full ${
              c.backendConfigured
                ? "bg-success-strong shadow-success-strong/40 shadow-sm"
                : "bg-warning shadow-warning/40 shadow-sm"
            }`}
          />
          {c.backendConfigured ? "训练后端已就绪" : "训练后端未配置"}
        </div>

        <div className="flex-1" />

        {/* 主操作（镜像表单提交） */}
        <Button
          variant="primary-solid"
          size="sm"

          onClick={() => void c.submit()}
          disabled={c.submitting || c.uploading}
          className="h-auto gap-1.5 rounded-lg px-3.5 py-1.5 font-semibold"
        >
          {c.submitting ? "提交中…" : "开始训练"}
        </Button>
      </header>

      {/* ── 三栏主体 ─────────────────────── */}
      <div className="z-base relative flex min-h-0 flex-1 overflow-hidden">
        {/* ═══ 左：数据集面板（300px） ═══ */}
        <aside className="border-border-subtle bg-panel-deep/85 flex w-[300px] shrink-0 flex-col border-r backdrop-blur-sm">
          <div className="border-border-subtle flex h-11 items-center justify-between border-b px-4">
            <div className="flex items-center gap-2">
              <span className="text-ink-field text-[13px] font-semibold">
                数据集
              </span>
              <span className="text-ink-fainter text-[11px]">
                {c.dataset.length} 张
              </span>
            </div>
          </div>

          <div className="flex-1 gap-3 overflow-y-auto p-4">
            {/* 后端未配置横幅 */}
            {!c.backendConfigured && (
              <Alert
                variant="warning"
                /* 基元默认`grid` 是给「图标 + 标题 + 正文」这种分行结构用的；
 这条横幅是**连续文字流**（正文里夹着内联链接），必须显式
 回到`block`，否则每个文字节点各自成行、排版散架。 */
                className="block rounded-lg p-3 text-[11px] leading-relaxed"
              >
                <AlertTitle className="mb-1 font-semibold">
                  未配置训练后端
                </AlertTitle>
                {onOpenSettings ? (
                  <>
                    在「
                    <Button
                      variant="link"
                      onClick={onOpenSettings}
                      className="h-auto text-inherit underline hover:opacity-80"
                    >
                      设置 → 偏好
                    </Button>
                    」中填写训练后端 URL（如 Kohya / OneTrainer / ComfyUI
                    训练节点的 HTTP
                    地址）后，即可开始真实训练。当前提交的任务会保持「等待中」。
                  </>
                ) : (
                  <>
                    在「
                    <Link href="/settings" className="underline">
                      设置 → 偏好
                    </Link>
                    」中填写训练后端 URL（如 Kohya / OneTrainer / ComfyUI
                    训练节点的 HTTP
                    地址）后，即可开始真实训练。当前提交的任务会保持「等待中」。
                  </>
                )}
              </Alert>
            )}

            {/* Upload zone */}
            <div
              onClick={datasetPicker.open}
              className="border-primary-500/35 bg-primary-500/6 hover:border-primary-500/55 hover:bg-primary-500/10 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-3 py-5 text-center transition-colors"
            >
              <Upload
                size={22}
                strokeWidth={1.8}
                color="var(--color-aurora-violet)"
              />
              <p className="text-primary-strong text-[12px] font-medium">
                {c.uploading ? "上传中…" : "点击或拖拽上传图片"}
              </p>
              <p className="text-ink-fainter text-[10px]">
                建议 10–30 张同主题图片
              </p>
              <datasetPicker.Input />
            </div>

            {/* 数据集必填的错误行：挂在上传区下方（这一块没有单一控件，
 所以不用`FormField` 的自动关联，只复用它的错误行排版）。 */}
            {c.fieldErrors.dataset && (
              <p className="text-danger-strong text-[11px]">
                {c.fieldErrors.dataset}
              </p>
            )}

            {/* 逐图 caption 编辑 */}
            {c.dataset.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-ink-faint text-[11px] font-medium">
                    逐图 caption 标注
                  </span>
                  <Button
                    variant="link"
                    onClick={c.fillBlank}
                    disabled={!c.form.triggerWord.trim()}
                    className="text-primary h-auto p-0 text-[10px] hover:underline"
                  >
                    用触发词填充空白
                  </Button>
                </div>

                <div className="flex-col gap-1.5">
                  {c.dataset.map((data, i) => (
                    <div
                      key={data.name}
                      className="border-border bg-card flex items-center gap-2 rounded-md border p-1.5"
                    >
                      <MediaThumbnail
                        src={comfyImageUrl({ filename: data.name })}
                        alt={data.name}
                        className="size-9 shrink-0 rounded object-cover"
                      />
                      <input
                        value={data.caption}
                        onChange={textHandler((caption) =>
                          c.setDataset((prev) =>
                            prev.map((item, j) =>
                              j === i ? { ...item, caption } : item,
                            ),
                          ),
                        )}
                        placeholder="图片描述，如：a photo of somecjkstyle person"
                        className="border-border bg-canvas-deep text-ink-bright focus:border-primary-500/40 min-w-0 flex-1 rounded border px-2 py-1 text-[11px] outline-none"
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() =>
                          c.setDataset((prev) => prev.filter((_, j) => j !== i))
                        }
                        className="text-ink-faint hover:text-danger-strong shrink-0 rounded hover:bg-transparent"
                        aria-label="移除"
                      >
                        ✕
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="text-ink-faintest text-[10px] leading-relaxed">
                  文件名与 caption
                  会随任务一起提交给训练后端；留空则默认使用触发词。
                </p>
              </>
            )}
          </div>
        </aside>

        {/* ═══ 中：训练监控 ═══ */}
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-ink-field text-[13px] font-semibold">
              训练监控
            </span>
            {activeJob && (
              <span
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${statusMeta(activeJob.status).cls}`}
              >
                {statusMeta(activeJob.status).label}
              </span>
            )}
          </div>

          {/* 进度环 + 指标卡 */}
          <div className="border-border-subtle bg-card rounded-2xl border p-4">
            <div className="flex items-center gap-5">
              {/* Ring */}
              <div
                className="relative shrink-0"
                style={{ width: 96, height: 96 }}
              >
                <svg width="96" height="96" viewBox="0 0 96 96">
                  {/* 进度环底轨必须随主题：写死 8% 白在浅色卡片上是「白描白」。 */}
                  <circle
                    cx="48"
                    cy="48"
                    r={RING_R}
                    fill="none"
                    stroke="var(--color-border-strong)"
                    strokeWidth="8"
                  />
                  <circle
                    cx="48"
                    cy="48"
                    r={RING_R}
                    fill="none"
                    stroke="url(#trainRing)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={RING_C}
                    strokeDashoffset={RING_C * (1 - ringProgress / 100)}
                    transform="rotate(-90 48 48)"
                    style={{ transition: "stroke-dashoffset 0.5s ease" }}
                  />
                  <defs>
                    <linearGradient id="trainRing" x1="0" y1="0" x2="1" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--color-aurora-violet)"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--color-aurora-cyan)"
                      />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-ink-field text-lg font-semibold">
                    {ringProgress}%
                  </span>
                  <span className="text-ink-fainter text-[10px]">进度</span>
                </div>
              </div>

              {/* Metrics */}
              <KeyValueRows
                layout="stacked"
                className="min-w-0 flex-1"
                items={[
                  {
                    key: "当前步数",
                    value: `${ringSteps} / ${activeJob?.steps ?? 0}`,
                  },
                  {
                    key: "触发词",
                    value: displayValue(activeJob?.triggerWord),
                    valueClassName: "text-primary-strong",
                  },
                  {
                    key: "底模",
                    raw: activeJob?.baseModel,
                    itemClassName: "col-span-2",
                  },
                ]}
              />
            </div>

            {/* Progress bar */}
            <ProgressBar
              value={ringProgress}
              showValue={false}
              className="mt-4"
              trackClassName="bg-surface-2 h-1.5"
              fillClassName="bg-linear-to-r from-primary-500 to-info"
            />
          </div>

          {/* Loss 曲线卡 */}
          <div className="border-border-subtle bg-card mt-4 rounded-2xl border p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-ink-field text-[12px] font-medium">
                Loss 曲线
              </span>
              <div className="text-ink-fainter flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="bg-primary-500 inline-block h-[2px] w-3" />
                  训练
                </span>
                <span className="flex items-center gap-1">
                  <span className="bg-info inline-block h-[2px] w-3" />
                  验证
                </span>
              </div>
            </div>
            <svg
              width="100%"
              viewBox={`0 0 ${lossGeo.W} ${lossGeo.H}`}
              preserveAspectRatio="none"
              className="h-[120px] w-full"
            >
              {/* horizontal gridlines */}
              {[0.25, 0.5, 0.75].map((gain) => (
                <line
                  key={gain}
                  x1="12"
                  x2={lossGeo.W - 12}
                  y1={12 + gain * (lossGeo.H - 24)}
                  y2={12 + gain * (lossGeo.H - 24)}
                  stroke="var(--color-border-subtle)"
                  strokeWidth="1"
                />
              ))}
              <path
                d={lossGeo.val}
                fill="none"
                stroke="var(--color-aurora-cyan)"
                strokeOpacity="0.55"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d={lossGeo.train}
                fill="none"
                stroke="var(--color-aurora-violet)"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {/* Job list */}
          <div className="mt-4">
            <h3 className="text-ink-faint mb-3 text-[12px] font-medium">
              训练任务
            </h3>
            {c.jobs.length === 0 ? (
              <EmptyState
                description="还没有训练任务。在右侧配置并点击「开始训练」。"
                minHeightClass="min-h-[160px]"
              />
            ) : (
              <div className="flex flex-col gap-3">
                {c.jobs.map((job) => {
                  const sm = statusMeta(job.status);
                  const logs = job.logs ?? [];
                  const isOpen = expanded === job.id;
                  return (
                    <div
                      key={job.id}
                      className="border-border-subtle bg-card rounded-2xl border p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="u-title truncate">{job.name}</h4>
                            <span
                              className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${sm.cls}`}
                            >
                              {sm.label}
                            </span>
                          </div>
                          <p className="text-ink-muted mt-1 text-[11px]">
                            {job.baseModel} · 触发词{""}
                            <span className="text-primary-strong">
                              {job.triggerWord}
                            </span>
                            {""}· {job.datasetImages?.length ?? 0} 张图 ·{""}
                            {job.steps} 步
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            variant="primary"
                            size="xs"
                            onClick={() => router.push(`/train/${job.id}`)}
                            className="h-auto rounded-lg px-2.5 py-1"
                          >
                            详情 ↗
                          </Button>
                          {(job.status === "QUEUED" ||
                            job.status === "RUNNING") && (
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => void c.cancelJob(job.id)}
                              className="border-border text-ink-strong hover:bg-subtle h-auto rounded-lg px-2.5 py-1"
                            >
                              取消
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => setExpanded(isOpen ? null : job.id)}
                            className="border-border text-ink-strong hover:bg-subtle h-auto rounded-lg px-2.5 py-1"
                          >
                            {isOpen ? "收起" : "日志"}
                          </Button>
                        </div>
                      </div>
                      {/* 取消失败挂在**这一行**（规范 16 §16.2.4.33）：用户点的
 是这张卡上的「取消」，原因就写在它旁边。 */}
                      {c.errors.get(job.id) && (
                        <p className="text-danger-strong mt-2 text-[11px]">
                          {c.errors.get(job.id)}
                        </p>
                      )}

                      {(job.status === "RUNNING" ||
                        job.status === "QUEUED") && (
                        <ProgressBar
                          value={job.progress}
                          showValue={false}
                          className="mt-3"
                          trackClassName="bg-surface-2 h-1.5"
                          fillClassName="bg-linear-to-r from-primary-500 to-info"
                        />
                      )}

                      {job.status === "DONE" && job.outputName && (
                        <p className="text-success-strong mt-2 text-[11px]">
                          ✓ 已产出 LoRA：
                          <span className="font-mono">{job.outputName}</span> ·
                          已加入模型库，可在创作台 LoRA 中选择使用。
                        </p>
                      )}
                      {job.status === "FAILED" && job.error && (
                        <p className="text-danger-strong mt-2 text-[11px]">
                          ✗ {job.error}
                        </p>
                      )}
                      {job.status === "QUEUED" && !c.backendConfigured && (
                        <p className="text-warning-strong/80 mt-2 text-[11px]">
                          等待训练后端（未配置 LORA_TRAINER_URL）。
                        </p>
                      )}

                      {isOpen && (
                        <div className="border-border-subtle bg-canvas-deep mt-3 rounded-lg border p-2.5 font-mono text-[11px] leading-relaxed">
                          {logs.length === 0 ? (
                            <p className="text-ink-fainter">暂无日志</p>
                          ) : (
                            logs.map((log, i) => (
                              <div
                                key={`${log.t}-${i}`}
                                className={
                                  log.level === "error"
                                    ? "text-danger-strong"
                                    : log.level === "success"
                                      ? "text-success-strong"
                                      : log.level === "warn"
                                        ? "text-warning-strong"
                                        : log.level === "progress"
                                          ? "text-primary-strong"
                                          : "text-ink-faint"
                                }
                              >
                                {log.msg}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        {/* ═══ 右：超参数（320px） ═══ */}
        <aside className="border-border-subtle bg-panel-deep/85 flex w-[320px] shrink-0 flex-col border-l backdrop-blur-sm">
          <div className="border-border-subtle flex h-11 items-center border-b px-4">
            <span className="text-ink-field text-[13px] font-semibold">
              超参数
            </span>
          </div>

          <div className="flex-1 flex-col gap-3.5 overflow-y-auto p-4">
            <FormField
              label="任务名称"
              id="train-name"
              error={c.fieldErrors.name}
              labelClassName={labelClass}
            >
              {(a11y) => (
                <input
                  {...a11y}
                  value={c.form.name}
                  onChange={textHandler(c.setName)}
                  placeholder="如：我的水墨风格"
                  className={fieldClass}
                />
              )}
            </FormField>

            <FormField
              label="底模（Checkpoint）"
              id="train-base-model"
              error={c.fieldErrors.baseModel}
              labelClassName={labelClass}
            >
              <SelectMenu
                fullWidth
                className="!bg-subtle !border-border text-ink-field h-9 text-[13px]"
                value={c.form.baseModel}
                onChange={c.setBaseModel}
                options={c.checkpoints.map((checkpoint) => checkpoint.fileName)}
                labels={Object.fromEntries(
                  c.checkpoints.map((checkpoint) => [
                    checkpoint.fileName,
                    checkpoint.name,
                  ]),
                )}
                placeholder="请选择…"
              />
            </FormField>

            <div className="grid grid-cols-2 gap-2.5">
              <FormField
                label="触发词"
                id="train-trigger-word"
                error={c.fieldErrors.triggerWord}
                labelClassName={labelClass}
              >
                {(a11y) => (
                  <input
                    {...a11y}
                    value={c.form.triggerWord}
                    onChange={textHandler(c.setTriggerWord)}
                    placeholder="如：somecjkstyle"
                    className={fieldClass}
                  />
                )}
              </FormField>
              <FormField
                label="类别词（可选）"
                id="train-class-word"
                labelClassName={labelClass}
              >
                {(a11y) => (
                  <input
                    {...a11y}
                    value={c.form.classWord ?? ""}
                    onChange={textHandler(c.setClassWord)}
                    placeholder="person / style"
                    className={fieldClass}
                  />
                )}
              </FormField>
            </div>

            <FormField
              label="分辨率"
              id="train-resolution"
              labelClassName={labelClass}
            >
              <SelectMenu
                fullWidth
                className="!bg-subtle !border-border text-ink-field h-9 text-[13px]"
                value={String(c.form.resolution)}
                onChange={(value) => c.setResolution(Number(value))}
                options={RESOLUTIONS.map(String)}
                placeholder="选择分辨率"
              />
            </FormField>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-ink-faint text-[11px] font-medium">
                  训练步数
                </span>
                <span className="text-primary-strong text-[11px] font-medium">
                  {c.form.steps}
                </span>
              </div>
              <RangeSlider
                min={500}
                max={4000}
                step={100}
                value={c.form.steps}
                onChange={c.setSteps}
                className="w-full"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-ink-faint text-[11px] font-medium">
                  批次大小
                </span>
                <span className="text-primary-strong text-[11px] font-medium">
                  {c.form.batchSize}
                </span>
              </div>
              <RangeSlider
                min={1}
                max={8}
                value={c.form.batchSize}
                onChange={c.setBatchSize}
                className="w-full"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-ink-faint text-[11px] font-medium">
                  LoRA 维度 (rank)
                </span>
                <span className="text-primary-strong text-[11px] font-medium">
                  {c.form.rankDim}
                </span>
              </div>
              <RangeSlider
                min={8}
                max={128}
                step={8}
                value={c.form.rankDim}
                onChange={c.setRankDim}
                className="w-full"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-ink-faint text-[11px] font-medium">
                  Alpha
                </span>
                <span className="text-primary-strong text-[11px] font-medium">
                  {c.form.networkAlpha}
                </span>
              </div>
              <RangeSlider
                min={0}
                max={128}
                step={8}
                value={c.form.networkAlpha}
                onChange={c.setNetworkAlpha}
                className="w-full"
              />
            </div>

            <div>
              {/* 学习率这一行没有单一控件（数字输入 + 快捷档位并排），
 标签行只作小标题。 */}
              <FormField label="学习率" labelClassName={labelClass} />
              <NumberField
                value={c.form.learningRate}
                onChange={c.setLearningRate}
                min={0}
                max={1}
                step={0.0001}
                decimalPlaces={4}
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <FormField
                label="优化器"
                id="train-optimizer"
                labelClassName={labelClass}
              >
                <SelectMenu
                  fullWidth
                  className="!bg-subtle !border-border text-ink-field h-9 text-[13px]"
                  value={c.form.optimizer}
                  onChange={c.setOptimizer}
                  options={OPTIMIZERS}
                  placeholder="选择优化器"
                />
              </FormField>
              <FormField
                label="调度器"
                id="train-scheduler"
                labelClassName={labelClass}
              >
                <SelectMenu
                  fullWidth
                  className="!bg-subtle !border-border text-ink-field h-9 text-[13px]"
                  value={c.form.scheduler}
                  onChange={c.setScheduler}
                  options={SCHEDULERS}
                  placeholder="选择调度器"
                />
              </FormField>
            </div>

            <FormField
              label="随机种子"
              id="train-seed"
              labelClassName={labelClass}
            >
              <NumberField
                value={c.form.seed}
                onChange={c.setSeed}
                min={0}
                max={999999}
                step={1}
              />
            </FormField>

            {/* 无条目归属的那档（上传 / 创建失败）—— 挂在提交按钮上方。
 任务取消失败挂在**那一行**（见下方任务列表）。 */}
            {c.errors.get(null) && (
              <p className="text-danger-strong text-xs">{c.errors.get(null)}</p>
            )}

            <Button
              variant="primary-solid"
              onClick={() => void c.submit()}
              disabled={c.submitting || c.uploading}
              className="h-auto w-full rounded-xl py-2.5 font-semibold"
            >
              {c.submitting ? "提交中…" : "开始训练"}
            </Button>
            <p className="text-ink-faintest text-center text-[10px] leading-relaxed">
              全部在本机运行 · 无需登录 · 零授权
            </p>
          </div>
        </aside>
      </div>

      {/* ── Status Bar ────────────────────────────── */}
      <footer className="border-border-subtle bg-panel-deep/95 z-base relative flex h-6 shrink-0 items-center justify-center gap-2 border-t backdrop-blur-sm">
        <span className="bg-success-strong shadow-success-strong/40 inline-block h-[7px] w-[7px] rounded-full shadow-sm" />
        <span className="text-ink-muted text-[11px]">
          ComfyUI·Kohya 就绪 · 本地算力 · 零授权
        </span>
      </footer>
    </div>
  );
}
