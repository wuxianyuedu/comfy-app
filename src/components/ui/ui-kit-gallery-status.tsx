"use client";

import { CheckCircle2, TriangleAlert } from "lucide-react";
import type { ComponentProps } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { EmptyState } from "~/components/ui/empty-state";
import { Hint } from "~/components/ui/hint";
import { PageLoading } from "~/components/ui/page-loading";
import { Progress, ProgressLabel } from "~/components/ui/progress";
import { ProgressBar } from "~/components/ui/progress-bar";
import { Skeleton } from "~/components/ui/skeleton";
import { Spinner } from "~/components/ui/spinner";
import { ValidationErrorList } from "~/components/ui/validation-error-list";
import { WaterFillProgress } from "~/components/ui/water-fill-progress";
import { GalleryCell, GalleryGrid, GallerySection } from "~/components/ui/ui-kit-gallery-parts";

/**
 * 反馈与状态一组的演示（ISSUE #3525）。
 * 通知块的软底（`bg-<语义>/10`）+ 状态字色是两态都要盯的一族：浅色档靠
 * `-strong` 字色保对比、深色档靠 alpha 底，任何一档写死都会在这页露馅。
 */

type AlertVariant = NonNullable<ComponentProps<typeof Alert>["variant"]>;

const ALERT_VARIANTS: Array<AlertVariant> = [
  "default",
  "destructive",
  "warning",
  "info",
  "success",
  "danger",
];

const SAMPLE_ERRORS = [
  {
    classType: "KSampler",
    field: "cfg",
    message: "cfg must be a number",
    nodeId: "10",
  },
  {
    classType: "",
    field: "",
    message: "缺少必需的输入图像",
    nodeId: "23",
  },
];

export function StatusSection() {
  return (
    <GallerySection
      note="通知块六档 variant 的软底与字色两态各看一遍；进度条看轨道与填充的对比。"
      title="反馈与状态"
    >
      <GalleryGrid>
        <GalleryCell className="col-span-full" label="Alert · 六档语义变体">
          <div className="flex w-full max-w-160 flex-col gap-2">
            {ALERT_VARIANTS.map((variant) => (
              <Alert key={variant} variant={variant}>
                <TriangleAlert aria-hidden />
                <AlertTitle>{variant}</AlertTitle>
                <AlertDescription>一句说明，色面与文字色随语义档走。</AlertDescription>
              </Alert>
            ))}
          </div>
        </GalleryCell>
        <GalleryCell label="Hint（悬浮提示按钮）">
          <Hint label="这是个提示。">
            <Button aria-label="更多信息" size="icon-sm" variant="ghost">
              <CheckCircle2 aria-hidden />
            </Button>
          </Hint>
        </GalleryCell>
        <GalleryCell label="Progress（结构化）/ ProgressBar">
          <div className="flex w-full flex-col gap-3">
            <Progress value={64}>
              <ProgressLabel>正在出图</ProgressLabel>
            </Progress>
            <ProgressBar ariaLabel="任务进度" value={42} />
            <ProgressBar ariaLabel="低进度" minVisible={8} value={4} />
          </div>
        </GalleryCell>
        <GalleryCell label="WaterFillProgress（水位进度）">
          <div className="bg-card relative h-20 w-40 overflow-hidden rounded-xl border">
            <WaterFillProgress progress={0.55} />
            <span className="text-ink relative z-10 flex h-full items-center justify-center text-sm">
              55%
            </span>
          </div>
        </GalleryCell>
        <GalleryCell label="Spinner / Skeleton / PageLoading">
          <Spinner className="text-primary" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <PageLoading />
        </GalleryCell>
        <GalleryCell label="EmptyState（页面级空态）">
          <EmptyState
            action={<Button size="sm">新建项目</Button>}
            description="还没有任何项目，先建一个。"
            icon={<CheckCircle2 aria-hidden />}
            minHeightClass="min-h-40"
            title="空空如也"
          />
        </GalleryCell>
        <GalleryCell label="Empty（shadcn 空态骨架）">
          <Empty className="border-border rounded-lg border border-dashed">
            <EmptyHeader>
              <EmptyMedia>✦</EmptyMedia>
              <EmptyTitle>没有结果</EmptyTitle>
              <EmptyDescription>换个关键词试试。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </GalleryCell>
        <GalleryCell label="ValidationErrorList">
          <div className="bg-destructive/10 border-destructive/30 w-full max-w-72 rounded-lg border p-2">
            <ValidationErrorList errors={SAMPLE_ERRORS} />
          </div>
        </GalleryCell>
        <GalleryCell label="Toast（sonner）">
          <Button onClick={() => toast("已保存到草稿")} variant="outline">
            弹一条 toast
          </Button>
          <Button onClick={() => toast.error("保存失败：磁盘已满")} variant="outline">
            弹一条错误 toast
          </Button>
        </GalleryCell>
      </GalleryGrid>
    </GallerySection>
  );
}
