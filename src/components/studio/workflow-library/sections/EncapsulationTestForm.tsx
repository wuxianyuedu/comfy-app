"use client";

// ── 工坊封装页签「流程测试」的表单（规范 §17.2 第③层：只渲染 + 上抛）───
// 输入框由**该模式的契约口清单**逐口渲染 —— 与上方「工坊对外口一览」同一份
//`status.entries`，**不看有没有落点**：
// · 没落点的口照样能填（值是工坊的对外输入，落不落得下去由封装层按作者连线
// 决定；落不下去时用工作流图内的默认值执行，不是「这一口不该出现」）；
// · 图片口（参考图 / 首帧 / 尾帧）选本地文件 → 上传进 ComfyUI 输入目录，
// 值以文件名落回该口。
//
// 此前这里按「已落点」过滤，只硬编码了提示词 / 负向 / 尺寸三格：负向提示词在
// 上一行写着名字、下面却没有输入框；图生视频这类模式尺寸口没落点，连尺寸都
// 选不了 —— 同一页面上「工坊能编辑的参数」与「测试能填的参数」成了两份清单。
//
// 两条口径：
// · 表单只认`WorkshopExposedValues` 一种形状，读写都经
//`exposedValueOf` /`withExposedValue` 这一个映射（契约口 id → 对外值字段），
// 本组件里不再写第二遍「哪个 id 对应哪个字段」；
// · 空字符串提交前一律剪掉（`pruneEmptyExposedValues`）：空串 = 用户没填，
// 不该把工作流图里作者写好的负向提示词 / 首帧抹成空。

import { useCallback, useState } from "react";
import { textHandler } from "~/lib/form-props";

import { runAsyncAction } from "~/lib/async-action";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { Textarea } from "~/components/ui/textarea";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { mediaPreviewUrl } from "~/lib/media/media-url";
import { readFileAsDataUrl } from "~/lib/file-io";
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
   * 各有自己的 state —— 混进同一个对象会一路`as` 断言下去。 */
  const [texts, setTexts] = useState<WorkshopExposedValues>({
    prompt: DEFAULT_TEST_PROMPT,
  });
  const [size, setSize] = useState<ShotSizeState>(DEFAULT_SHOT_SIZE);
  const [duration, setDuration] = useState(DEFAULT_TEST_DURATION);
  /* 自定义「数字」口的值（`控制形态 number`）。文本 / 图片口的值走`texts`
   * （`withExposedValue` 按 id 收进`custom`），数字口要下发 number，所以单独
   * 一张表 —— 混进`texts` 会一路`as` 断言下去。 */
  const [numbers, setNumbers] = useState<Record<string, number>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  /* 图片口的本地预览（entryId → data URL）：选完立刻显示，不依赖 ComfyUI 上传
   * 成功或是否运行（上传失败 / 未启动时值不落回，但用户选的那张图仍应看得见）。 */
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const disabled = running || !canRun;

  const patchText = (id: string, next: string) =>
    setTexts((prev) => withExposedValue(prev, id, next));

  /* 图片口的选取：`entryId` 与`file` 一起给，回调身份稳定（`useFilePicker`
   * 的 Input 靠 props 身份做 memo，回调每次都变会让隐藏 input 反复卸载重挂）。 */
  const pickImage = useCallback(
    (entryId: string, file: File) => {
      setError("");
      setUploadingId(entryId);
      void (async () => {
        /* 先就地做一张本地预览：选完立刻显示，不依赖 ComfyUI 是否运行；
         * 读文件失败不阻断上传（只是没有本地预览）。 */
        try {
          const dataUrl = await readFileAsDataUrl(file);
          setPreviews((prev) => ({ ...prev, [entryId]: dataUrl }));
        } catch {
          /* 忽略：下面仍会尝试上传。 */
        }
        /* 失败通道是这块行内`setError`；成功无提示（输入框自己会显示文件名）。
         * 文案统一走`~/lib/async-action` 的`errorMessage` —— 收口前这里是
         * 自己拼的`e instanceof Error ? e.message : String(e)`（全库另有三处
         * 同形），抛出的值不是 Error 时会渲染成`[object Object]`。 */
        await runAsyncAction(
          async () => {
            const filename = await uploadImage(file);
            setTexts((prev) => withExposedValue(prev, entryId, filename));
          },
          {
            report: (kind, detail) => {
              if (kind === "err") setError(detail);
            },
            failureText: "上传失败",
          },
        );
        setUploadingId(null);
      })();
    },
    [uploadImage],
  );

  const submit = () => {
    /* 空串一律当「没给」（见`pruneEmptyExposedValues`）：自定义口的文本 / 图片
     * 值已经在那里面收好了，这里只补上「数字」口那一批。 */
    const pruned = pruneEmptyExposedValues(texts);
    const custom: Record<string, string | number> = {
      ...(pruned.custom ?? {}),
    };
    for (const entry of entries) {
      const value = numbers[entry.id];
      if (entry.control === "number" && value !== undefined) {
        custom[entry.id] = value;
      }
    }
    const payload: WorkshopExposedValues = {
      ...pruned,
      ...(Object.keys(custom).length > 0 ? { custom } : {}),
      ...(entries.some((entry) => entry.control === "size") ? { size } : {}),
      ...(entries.some((entry) => entry.control === "duration")
        ? { duration }
        : {}),
    };
    setError("");
    onRun(payload);
  };

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => {
        if (entry.control === "size") {
          return (
            <div key={entry.id} className="flex flex-col gap-1">
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
            <div key={entry.id} className="flex-col gap-1">
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
        /* 自定义「数字」口：普通数值输入（没有「秒」这类单位语义 —— 那由作者在
         * 工作流那一端决定，这里只按工坊口径给一个数）。 */
        if (entry.control === "number") {
          return (
            <div key={entry.id} className="flex flex-col gap-1">
              <FieldLabel
                label={entry.label}
                unwired={entry.targetIoKey === null}
              />
              <NumberField
                value={numbers[entry.id] ?? 0}
                onChange={(value) =>
                  setNumbers((prev) => ({ ...prev, [entry.id]: value }))
                }
                disabled={disabled}
                className="h-7 w-28"
              />
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
              previewSrc={previews[entry.id]}
              uploading={uploadingId === entry.id}
              disabled={disabled}
              onPick={pickImage}
            />
          );
        }
        return (
          <div key={entry.id} className="flex flex-col gap-1">
            <FieldLabel
              label={entry.label}
              unwired={entry.targetIoKey === null}
            />
            <Textarea
              value={text}
              onChange={textHandler((value) => patchText(entry.id, value))}
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
        <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-[11px]">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Hint label={runDisabledReason} wrap>
          <Button
            onClick={submit}
            disabled={disabled}
            className="h-auto rounded-lg px-3 py-1.5 text-xs font-medium"
          >
            {running ? "测试中…" : "执行流程测试"}
          </Button>
        </Hint>
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

/** 图片口一行：当前文件名 + 「选择图片」（隐藏 input 由`useFilePicker` 管）。 */
function ImageField({
  entry,
  value,
  previewSrc,
  uploading,
  disabled,
  onPick,
}: {
  entry: EncapsulationEntryStatus;
  value: string;
  previewSrc?: string;
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
  /* 预览优先用本地 data URL（用户刚选的图，不依赖 ComfyUI）；没有才回退到
   * 按值算出的 ComfyUI 代理地址（`~/lib/media/media-url` 出口，空引用给 null）。 */
  const previewUrl = previewSrc ?? mediaPreviewUrl(value);

  return (
    <div className="flex-col gap-1">
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
      {previewUrl && (
        <MediaThumbnail
          src={previewUrl}
          alt={entry.label}
          fallback="none"
          className="border-border bg-surface max-h-40 w-full rounded-lg border object-contain"
        />
      )}
    </div>
  );
}
