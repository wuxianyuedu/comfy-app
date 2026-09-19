"use client";

// ── 工坊封装页签「流程测试」的表单（规范 §17.2 第③层：只渲染 + 上抛）───
// 输入框由**该模式的契约口清单**逐口渲染 —— 与上方「工坊对外口一览」同一份
// `status.entries`，**不看有没有落点**：
//   · 没落点的口照样能填（值是工坊的对外输入，落不落得下去由封装层按作者连线
//     决定；落不下去时用工作流图内的默认值执行，不是「这一口不该出现」）；
//   · 图片口（参考图 / 首帧 / 尾帧）选本地文件 → 上传进 ComfyUI 输入目录，
//     值以文件名落回该口。
//
// 此前这里按「已落点」过滤，只硬编码了提示词 / 负向 / 尺寸三格：负向提示词在
// 上一行写着名字、下面却没有输入框；图生视频这类模式尺寸口没落点，连尺寸都
// 选不了 —— 同一页面上「工坊能编辑的参数」与「测试能填的参数」成了两份清单。
//
// 两条口径：
//   · 表单只认 `WorkshopExposedValues` 一种形状，读写都经
//     `exposedValueOf` / `withExposedValue` 这一个映射（契约口 id → 对外值字段），
//     本组件里不再写第二遍「哪个 id 对应哪个字段」；
//   · 空字符串提交前一律剪掉（`pruneEmptyExposedValues`）：空串 = 用户没填，
//     不该把工作流图里作者写好的负向提示词 / 首帧抹成空。

import { useCallback, useState } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { NumberField } from "~/components/ui/number-field";
import { useFilePicker } from "~/components/ui/file-picker";
import { ShotSizePicker } from "~/components/workshop/ShotSizePicker";
import {
  DEFAULT_SHOT_SIZE,
  type ShotSizeState,
} from "~/components/workshop/shot-size-config";
import type { SizeScene } from "~/lib/media/size-presets";
import type { EncapsulationEntryStatus } from "~/lib/workshop/workshop-encapsulation-status";
import {
  exposedValueOf,
  pruneEmptyExposedValues,
  withExposedValue,
  type WorkshopExposedValues,
} from "~/lib/workshop/workflow-encapsulation";
import { displayValue } from "~/lib/display-value";

/** 提示词的测试默认值（让用户点了就能跑，不必先想一句提示词）。 */
const DEFAULT_TEST_PROMPT = "一只戴宇航员头盔的柴犬，写实风格，高清";

/** 时长的默认秒数（与镜头生图的默认窗口一致）。 */
const DEFAULT_TEST_DURATION = 5;

/** 该口没连到工作流时的一句提示（值仍可填，只是不参与下发）。 */
const UNWIRED_HINT = "未连到端口，用工作流默认值";

interface EncapsulationTestFormProps {
  /** 该模式的契约口清单（`status.entries`：含落点 / 必备信息，但**不过滤**）。 */
  entries: EncapsulationEntryStatus[];
  /** 尺寸表口径（随模式：生图 / 视频）。 */
  scene: SizeScene;
  running: boolean;
  canRun: boolean;
  runDisabledReason?: string;
  onRun: (values: WorkshopExposedValues) => void;
  /** 上传本地图片到 ComfyUI 输入目录，返回文件名（IO 在 hooks 层）。 */
  uploadImage: (file: File) => Promise<string>;
}

export function EncapsulationTestForm({
  entries,
  scene,
  running,
  canRun,
  runDisabledReason,
  onRun,
  uploadImage,
}: EncapsulationTestFormProps) {
  /* 文本 / 图片口的值按契约口 id 存；尺寸与时长的值形状不同（对象 / 数字），
   * 各有自己的 state —— 混进同一个对象会一路 `as` 断言下去。 */
  const [texts, setTexts] = useState<WorkshopExposedValues>({
    prompt: DEFAULT_TEST_PROMPT,
  });
  const [size, setSize] = useState<ShotSizeState>(DEFAULT_SHOT_SIZE);
  const [duration, setDuration] = useState(DEFAULT_TEST_DURATION);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const disabled = running || !canRun;

  const patchText = (id: string, next: string) =>
    setTexts((prev) => withExposedValue(prev, id, next));

  /* 图片口的选取：`entryId` 与 `file` 一起给，回调身份稳定（`useFilePicker`
   *  的 Input 靠 props 身份做 memo，回调每次都变会让隐藏 input 反复卸载重挂）。 */
  const pickImage = useCallback(
    (entryId: string, file: File) => {
      setError("");
      setUploadingId(entryId);
      void (async () => {
        try {
          const filename = await uploadImage(file);
          setTexts((prev) => withExposedValue(prev, entryId, filename));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setUploadingId(null);
        }
      })();
    },
    [uploadImage],
  );

  const submit = () => {
    const payload: WorkshopExposedValues = {
      ...pruneEmptyExposedValues(texts),
      ...(entries.some((entry) => entry.control === "size") ? { size } : {}),
      ...(entries.some((entry) => entry.control === "duration")
        ? { duration }
        : {}),
    };
    setError("");
    onRun(payload);
  };

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        if (entry.control === "size") {
          return (
            <div key={entry.id} className="space-y-1">
              <FieldLabel label={entry.label} />
              <ShotSizePicker
                value={size}
                onChange={setSize}
                scene={scene}
                disabled={disabled}
              />
            </div>
          );
        }
        if (entry.control === "duration") {
          return (
            <div key={entry.id} className="space-y-1">
              <FieldLabel label={entry.label} />
              <div className="flex items-center gap-2">
                <NumberField
                  value={duration}
                  onChange={setDuration}
                  min={1}
                  max={30}
                  step={1}
                  disabled={disabled}
                  className="h-7 w-28"
                />
                <span className="text-muted-foreground/70 text-[10px]">秒</span>
              </div>
            </div>
          );
        }
        const text = exposedValueOf(texts, entry.id);
        if (entry.control === "image") {
          return (
            <ImageField
              key={entry.id}
              entry={entry}
              value={text}
              uploading={uploadingId === entry.id}
              disabled={disabled}
              onPick={pickImage}
            />
          );
        }
        return (
          <div key={entry.id} className="space-y-1">
            <FieldLabel
              label={entry.label}
              unwired={entry.targetIoKey === null}
            />
            <Textarea
              value={text}
              onChange={(event) => patchText(entry.id, event.target.value)}
              rows={entry.id === "prompt" ? 2 : 1}
              className="border-border bg-bg text-xs"
              placeholder={
                entry.id === "prompt" ? "测试提示词" : `输入${entry.label}`
              }
              disabled={disabled}
            />
          </div>
        );
      })}

      {error && (
        <p className="rounded-lg bg-red-100 px-3 py-2 text-[11px] text-red-800 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          onClick={submit}
          disabled={disabled}
          title={runDisabledReason}
          className="h-auto rounded-lg px-3 py-1.5 text-xs font-medium"
        >
          {running ? "测试中…" : "执行流程测试"}
        </Button>
        <span className="text-muted-foreground text-[11px]">
          会真实调用本机 ComfyUI 生成一张图
        </span>
      </div>
    </div>
  );
}

/** 一口一行的小标题；`unwired` 时补一句「值仍可填」的说明。 */
function FieldLabel({ label, unwired }: { label: string; unwired?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-muted text-[11px]">{label}</span>
      {unwired && (
        <span className="text-muted-foreground/70 text-[10px]">
          {UNWIRED_HINT}
        </span>
      )}
    </div>
  );
}

/** 图片口一行：当前文件名 + 「选择图片」（隐藏 input 由 `useFilePicker` 管）。 */
function ImageField({
  entry,
  value,
  uploading,
  disabled,
  onPick,
}: {
  entry: EncapsulationEntryStatus;
  value: string;
  uploading: boolean;
  disabled: boolean;
  onPick: (entryId: string, file: File) => void;
}) {
  const entryId = entry.id;
  const handlePick = useCallback(
    (file: File) => onPick(entryId, file),
    [onPick, entryId],
  );
  const picker = useFilePicker({ accept: "image/*", onPick: handlePick });

  return (
    <div className="space-y-1">
      <FieldLabel label={entry.label} unwired={entry.targetIoKey === null} />
      <div className="border-border bg-surface flex items-center gap-2 rounded-lg border px-2 py-1.5">
        <span className="text-muted-foreground/70 min-w-0 flex-1 truncate font-mono text-[10px]">
          {displayValue(value)}
        </span>
        <Button
          onClick={picker.open}
          disabled={disabled || uploading}
          className="h-auto rounded-md px-2 py-1 text-[11px]"
        >
          {uploading ? "上传中…" : "选择图片"}
        </Button>
        <picker.Input />
      </div>
    </div>
  );
}
