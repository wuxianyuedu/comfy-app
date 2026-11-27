"use client";

import { useMemo, useState } from "react";
import { History, RotateCcw, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/utils";
import { displayValue } from "~/lib/display-value";
import { fixed } from "~/lib/number-format";
import { unique } from "~/lib/ordered-set";
import { tailWindow } from "~/lib/page-window";
import { clampText } from "~/lib/text-clamp";
import { classifyModelTestError, type ModelTestRun } from "./model-test-runs";
import { MODEL_TEST_KIND_LABELS } from "./model-test-config";
import { isWorkshopInputType } from "~/lib/workshop/remote-model-adapter";

function durationText(ms: number): string {
  return ms < 1000 ? `${String(ms)} ms` : `${fixed(ms / 1000, ms < 10_000 ? 1 : 0)} s`;
}

const VALUE_PREVIEW_MAX = 160;

function valueText(value: string | undefined): string {
  if (value === undefined || value === "") {
    return displayValue(value);
  }
  if (value.startsWith("data:")) {
    return `[内嵌文件 · ${Math.ceil(value.length / 1024)} KB]`;
  }
  return clampText(value, { maxLength: VALUE_PREVIEW_MAX });
}

function referenceValueText(images: Array<string> | undefined): string {
  if (images === undefined || images.length === 0) {
    return displayValue(images?.[0]);
  }
  return `${String(images.length)} 张 · ${valueText(images[0])}`;
}

/** 参考图组是字符串数组：逐项比即可，避免 JSON.stringify 把 data: 大图整串拼一遍。 */
function sameReferenceImages(a: Array<string> | undefined, b: Array<string> | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined || a.length !== b.length) {
    return false;
  }
  return a.every((image, index) => image === b[index]);
}

const statusLabel = {
  cancelled: "已取消",
  failed: "失败",
  succeeded: "成功",
} as const;

export function ModelTestRunHistory({
  generating,
  onClear,
  onRetry,
  runs,
}: {
  generating: boolean;
  onClear: () => void;
  onRetry: (run: ModelTestRun) => void;
  runs: Array<ModelTestRun>;
}) {
  const [selected, setSelected] = useState<Array<string>>([]);
  const compared = useMemo(() => {
    const ids = new Set(selected);
    return selected.length === 2 ? runs.filter((run) => ids.has(run.id)).reverse() : [];
  }, [runs, selected]);
  const parameterKeys = useMemo(
    () =>
      unique(compared.flatMap((run) => Object.keys(run.values).filter(isWorkshopInputType))).sort(),
    [compared],
  );
  const { changedCount, referenceImagesDiffer } = useMemo(() => {
    const changedParameters = parameterKeys.filter(
      (key) => (compared[0]?.values[key] ?? "") !== (compared[1]?.values[key] ?? ""),
    ).length;
    const referencesDiffer = !sameReferenceImages(
      compared[0]?.referenceImages,
      compared[1]?.referenceImages,
    );
    return {
      changedCount: changedParameters + Number(referencesDiffer),
      referenceImagesDiffer: referencesDiffer,
    };
  }, [compared, parameterKeys]);
  const toggle = (id: string) => {
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...tailWindow(previous, 1), id],
    );
  };
  if (runs.length === 0) {
    return null;
  }
  return (
    <section className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <History className="text-primary-strong size-4" />
        <h2 className="text-sm font-semibold">运行记录</h2>
        <span className="text-2xs text-muted-foreground">最近 {String(runs.length)} 次</span>
        <Button
          aria-label="清空运行记录"
          className="text-muted-foreground ml-auto h-auto px-2 py-1"
          onClick={onClear}
          size="sm"
          variant="ghost"
        >
          <Trash2 className="size-3.5" data-icon="inline-start" />
          清空
        </Button>
      </div>
      <p className="text-muted-foreground text-2xs">勾选任意两次运行，可逐项对比参数与结果。</p>
      <ol className="flex flex-col gap-2">
        {runs.map((run) => (
          <li
            className="border-border bg-surface-1 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2"
            key={run.id}
          >
            <Checkbox
              aria-label={`对比 ${new Date(run.startedAt).toLocaleTimeString()} 的运行`}
              checked={selected.includes(run.id)}
              className="size-3.5"
              onCheckedChange={() => {
                toggle(run.id);
              }}
            />
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-2xs font-semibold",
                run.status === "succeeded" && "bg-success/10 text-success-strong",
                run.status === "failed" && "bg-destructive/10 text-destructive",
                run.status === "cancelled" && "bg-warning/10 text-warning-strong",
              )}
            >
              {statusLabel[run.status]}
            </span>
            <span className="text-ink text-xs font-medium tabular-nums">
              {new Date(run.startedAt).toLocaleTimeString()}
            </span>
            <span className="text-muted-foreground text-2xs tabular-nums">
              {durationText(run.durationMs)} · {Object.keys(run.values).length} 项参数
              {run.referenceImages.length > 0
                ? ` · ${String(run.referenceImages.length)} 张参考图`
                : ""}
            </span>
            <span className="text-muted-foreground text-2xs">
              {run.status === "failed"
                ? classifyModelTestError(run.error)
                : MODEL_TEST_KIND_LABELS[run.kind]}
            </span>
            <Button
              className="ml-auto h-auto px-2 py-1"
              disabled={generating}
              onClick={() => {
                onRetry(run);
              }}
              size="sm"
              variant="outline"
            >
              <RotateCcw className="size-3" data-icon="inline-start" />
              按此参数重跑
            </Button>
            {run.error !== null && (
              <p className="text-destructive text-2xs w-full leading-relaxed">{run.error}</p>
            )}
          </li>
        ))}
      </ol>
      {compared.length === 2 && (
        <div className="border-border overflow-hidden rounded-lg border">
          <div className="bg-subtle px-3 py-2 text-xs font-semibold">
            A / B 参数对比 · {String(changedCount)} 项不同
          </div>
          <div className="overflow-x-auto">
            <Table className="text-2xs w-full text-left">
              <TableHeader className="text-muted-foreground">
                <TableRow>
                  <TableHead className="px-3 py-2 font-medium">参数</TableHead>
                  <TableHead className="px-3 py-2 font-medium">运行 A</TableHead>
                  <TableHead className="px-3 py-2 font-medium">运行 B</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parameterKeys.map((key) => {
                  const rawA = compared[0]?.values[key];
                  const rawB = compared[1]?.values[key];
                  const a = valueText(rawA);
                  const b = valueText(rawB);
                  return (
                    <TableRow
                      className={cn(
                        "border-border border-t",
                        (rawA ?? "") !== (rawB ?? "") && "bg-warning/5",
                      )}
                      key={key}
                    >
                      <TableCell className="px-3 py-2 font-mono font-medium">{key}</TableCell>
                      <TableCell className="max-w-64 px-3 py-2 break-all whitespace-pre-wrap">
                        {a}
                      </TableCell>
                      <TableCell className="max-w-64 px-3 py-2 break-all whitespace-pre-wrap">
                        {b}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow
                  className={cn("border-border border-t", referenceImagesDiffer && "bg-warning/5")}
                >
                  <TableCell className="px-3 py-2 font-mono font-medium">参考图组</TableCell>
                  <TableCell className="max-w-64 px-3 py-2 break-all whitespace-pre-wrap">
                    {referenceValueText(compared[0]?.referenceImages)}
                  </TableCell>
                  <TableCell className="max-w-64 px-3 py-2 break-all whitespace-pre-wrap">
                    {referenceValueText(compared[1]?.referenceImages)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </section>
  );
}
