"use client";

// 测试模型页的尺寸字段（从 ModelTestView 拆出以满足文件长度阈值）：与工作流库
// **同一个** ShotSizePicker。比例 / 像素（分辨率 · 百万像素）/ 倍数一段不缺，
// 倍数段只在选中百万像素档时出现；换算走 model-test-config → size-presets 纯函数。
// 尺寸来源声明为首图时改为只读展示第一张参考图的真实像素，不渲染尺寸选择器。

import { useEffect, useState } from "react";

import { sceneFromMode } from "~/lib/media/size-presets";
import { ShotSizePicker } from "~/components/workshop/ShotSizePicker";
import { sizeSpecToValues, sizeValuesToSpec, type ModelTestValues } from "./model-test-config";

export type ModelTestSizeFieldProps = {
  disabled?: boolean;
  mode: string;
  onPatchValues: (patch: Partial<ModelTestValues>) => void;
  /** 第一张参考图（data URL / 可访问路径）——尺寸来源声明为首图时读它的像素大小。 */
  referenceImageSrc?: string;
  sizeFromReference?: boolean;
  values: ModelTestValues;
};

export function ModelTestSizeField({
  disabled,
  mode,
  onPatchValues,
  referenceImageSrc,
  sizeFromReference = false,
  values,
}: ModelTestSizeFieldProps) {
  const scene = sceneFromMode(mode);
  const [dimsBySrc, setDimsBySrc] = useState<Record<string, { height: number; width: number }>>({});
  const dims = referenceImageSrc === undefined ? null : (dimsBySrc[referenceImageSrc] ?? null);
  useEffect(() => {
    if (
      referenceImageSrc === undefined ||
      referenceImageSrc === "" ||
      dimsBySrc[referenceImageSrc] !== undefined
    ) {
      return;
    }
    const image = new Image();
    image.onload = () => {
      setDimsBySrc((prev) => ({
        ...prev,
        [referenceImageSrc]: { height: image.naturalHeight, width: image.naturalWidth },
      }));
    };
    image.src = referenceImageSrc;
    return () => {
      image.onload = null;
    };
  }, [referenceImageSrc, dimsBySrc]);
  if (sizeFromReference) {
    return (
      <div className="bg-subtle text-ink-muted w-64 min-w-0 rounded-lg px-3 py-2 text-xs">
        {dims === null
          ? "上传第一张参考图后自动显示生成尺寸"
          : `${dims.width} × ${dims.height}（取自第一张参考图）`}
      </div>
    );
  }
  return (
    <div className="w-64 min-w-0">
      <ShotSizePicker
        disabled={disabled}
        onChange={(next) => {
          onPatchValues(sizeSpecToValues(next, scene));
        }}
        scene={scene}
        value={sizeValuesToSpec(values)}
      />
    </div>
  );
}
