"use client";

import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Kbd } from "~/components/ui/kbd";
import { Label } from "~/components/ui/label";
import { Progress, ProgressLabel } from "~/components/ui/progress";
import { ProgressBar } from "~/components/ui/progress-bar";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Skeleton } from "~/components/ui/skeleton";
import { Slider } from "~/components/ui/slider";
import { Spinner } from "~/components/ui/spinner";
import { StatusBadge } from "~/components/ui/status-badge";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { Toggle } from "~/components/ui/toggle";
import { GalleryCell, GalleryGrid, GallerySection } from "~/components/ui/ui-kit-gallery-parts";

/**
 * 基元 UI 速览（ISSUE #4110）—— 在 token 墙之后、六个功能分区之前单独辟一格，
 * 把最核心的原子基元各摆一枚代表形态，让人一进页就能扫到「库里有哪些基元」。
 *
 * 与下面六个功能分区的关系是**总览对明细，不是替代**：这里每族只取一态、紧凑排布；
 * 全 variant × 尺寸 × 禁用 / 加载矩阵仍在「按钮、徽标与状态件」等分区里，逐 prop
 * 的形态矩阵归 Storybook。所以同一枚基元在两处出现是有意的（#4110 选的就是这个
 * 「顶部速览 + 下方明细」形态），不要因为看着重复就删掉其中一处。
 *
 * 这里只组合 ui/ 基元、不手搓原子件（复用棘轮），也不写死色值（主题色扫描 P71/P79）：
 * 每枚控件都带可访问的 label / aria-label，id 一律 `primitives-` 前缀，与功能分区
 * 的 `kit-` 系列错开，避免同页重复 id。
 */
export function PrimitivesOverviewSection() {
  return (
    <GallerySection
      note="核心基元各取一态、紧凑速览；全 variant / 尺寸矩阵见下方六个分区，逐 prop 形态见 Storybook。"
      title="基元 UI 速览"
    >
      <GalleryGrid>
        <GalleryCell label="Button">
          <Button variant="primary">按钮</Button>
          <Button size="sm" variant="outline">
            描边
          </Button>
        </GalleryCell>
        <GalleryCell label="Toggle">
          <Toggle aria-label="速览收藏">收藏</Toggle>
        </GalleryCell>
        <GalleryCell label="Input / Textarea">
          <Input aria-label="速览输入框" className="w-40" placeholder="输入文字" />
          <Textarea aria-label="速览多行输入" className="w-40" rows={1} />
        </GalleryCell>
        <GalleryCell label="Checkbox / Switch">
          <span className="flex items-center gap-2">
            <Checkbox defaultChecked id="primitives-cb" />
            <Label htmlFor="primitives-cb">勾选</Label>
          </span>
          <Switch aria-label="速览开关" defaultChecked />
        </GalleryCell>
        <GalleryCell label="RadioGroup">
          <RadioGroup defaultValue="on">
            <span className="flex items-center gap-2">
              <RadioGroupItem id="primitives-radio-on" value="on" />
              <Label htmlFor="primitives-radio-on">开</Label>
            </span>
            <span className="flex items-center gap-2">
              <RadioGroupItem id="primitives-radio-off" value="off" />
              <Label htmlFor="primitives-radio-off">关</Label>
            </span>
          </RadioGroup>
        </GalleryCell>
        <GalleryCell label="Slider">
          <Slider aria-label="速览滑杆" className="w-40" defaultValue={[50]} />
        </GalleryCell>
        <GalleryCell label="Badge / StatusBadge">
          <Badge variant="secondary">徽标</Badge>
          <StatusBadge status="SUCCEEDED" />
          <StatusBadge status="FAILED" />
        </GalleryCell>
        <GalleryCell label="Progress / ProgressBar">
          <div className="flex w-40 flex-col gap-2">
            <Progress value={60}>
              <ProgressLabel>进度</ProgressLabel>
            </Progress>
            <ProgressBar ariaLabel="速览进度条" value={48} />
          </div>
        </GalleryCell>
        <GalleryCell label="Spinner / Skeleton">
          <Spinner className="text-primary" />
          <Skeleton className="h-4 w-24" />
        </GalleryCell>
        <GalleryCell label="Avatar / Kbd">
          <Avatar>
            <AvatarFallback>月</AvatarFallback>
          </Avatar>
          <span className="flex items-center gap-1">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </GalleryCell>
      </GalleryGrid>
    </GallerySection>
  );
}
