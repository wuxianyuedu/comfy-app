"use client";

import { Bookmark, Download, Loader2 } from "lucide-react";
import type { ComponentProps } from "react";

type ButtonVariant = NonNullable<ComponentProps<typeof Button>["variant"]>;

/** 全部变体逐支列出：这一页的价值就在「少一档就查不出那一档的错」。 */
const BUTTON_VARIANTS: Array<ButtonVariant> = [
  "default",
  "primary",
  "primary-solid",
  "secondary",
  "outline",
  "ghost",
  "link",
  "destructive",
  "danger",
  "danger-solid",
  "success",
  "success-solid",
  "warning",
  "warning-solid",
  "info",
];

import { Button, ButtonLink } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { ButtonGroup, ButtonGroupText } from "~/components/ui/button-group";
import { DisplayDensityToggle } from "~/components/ui/display-density-toggle";
import { EditableLabel } from "~/components/ui/editable-label";
import { HeaderHelp } from "~/components/ui/header-help";
import { Kbd } from "~/components/ui/kbd";
import { ListBadge } from "~/components/ui/list-badge";
import { SelectChip } from "~/components/ui/select-chip";
import { SourceTag } from "~/components/ui/source-tag";
import { StatusBadge } from "~/components/ui/status-badge";
import { StatusDot } from "~/components/ui/status-dot";
import { TaskTypeChip } from "~/components/ui/task-type-chip";
import { Toggle } from "~/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { GalleryCell, GalleryGrid, GallerySection } from "~/components/ui/ui-kit-gallery-parts";

/**
 * 动作与标记一组的演示：按钮 / 按钮组 / 开态切换 / 徽标 / 状态件。
 * 每一态都值得看：禁用与加载是最容易和承载面混掉的两档（ISSUE #3525）。
 */

const BADGE_VARIANTS = ["default", "secondary", "outline", "destructive"] as const;

/** StatusBadge 的语义分档按状态字符串映射，每档摆一枚。 */
const STATUS_TONES = ["SUCCEEDED", "RUNNING", "QUEUED", "FAILED", "IDLE"] as const;

/** StatusDot 的语义档。 */
const DOT_STATES = ["up", "busy", "probing", "down"] as const;

export function ActionsSection() {
  return (
    <GallerySection
      note="全部 variant × 尺寸档，另看禁用 / 加载 / 图标钮 —— 禁用态与卡片底最容易混。"
      title="按钮、徽标与状态件"
    >
      <GalleryGrid>
        <GalleryCell label="Button · variant（全档）">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </GalleryCell>
        <GalleryCell label="Button · size + 图标">
          <Button size="sm">
            <Bookmark aria-hidden />
            小号
          </Button>
          <Button size="lg">大号</Button>
          <Button size="xs">特小</Button>
          <Button aria-label="下载" size="icon">
            <Download aria-hidden />
          </Button>
          <Button aria-label="收藏" size="icon-sm" variant="outline">
            <Bookmark aria-hidden />
          </Button>
          <Button aria-label="压缩" size="icon-xs" variant="ghost">
            <Download aria-hidden />
          </Button>
        </GalleryCell>
        <GalleryCell label="Button · 禁用 / 加载">
          <Button disabled>禁用</Button>
          <Button disabled variant="outline">
            禁用描边
          </Button>
          <Button disabled variant="primary-solid">
            禁用实心
          </Button>
          <Button aria-busy="true" disabled variant="primary">
            <Loader2 aria-hidden className="animate-spin" />
            保存中
          </Button>
        </GalleryCell>
        <GalleryCell label="ButtonLink / ButtonGroup">
          <ButtonLink href="/models">按钮链接</ButtonLink>
          <ButtonGroup>
            <ButtonGroupText>分辨率</ButtonGroupText>
            <Button size="sm" variant="outline">
              720p
            </Button>
            <Button size="sm" variant="outline">
              1080p
            </Button>
          </ButtonGroup>
        </GalleryCell>
        <GalleryCell label="Toggle / ToggleGroup">
          <Toggle aria-label="收藏">收藏</Toggle>
          <Toggle aria-label="置顶" variant="outline">
            置顶
          </Toggle>
          <ToggleGroup multiple={false} spacing={2} value={[]} variant="outline">
            <ToggleGroupItem aria-label="浅色示例" value="light">
              浅
            </ToggleGroupItem>
            <ToggleGroupItem aria-label="深色示例" value="dark">
              深
            </ToggleGroupItem>
          </ToggleGroup>
        </GalleryCell>
        <GalleryCell label="DisplayDensityToggle / EditableLabel / HeaderHelp">
          <DisplayDensityToggle onChange={() => undefined} value="grid" />
          <EditableLabel label="点我改名" />
          <HeaderHelp text="这是一条悬浮说明。" />
        </GalleryCell>
      </GalleryGrid>

      <div className="border-border-subtle mt-6 border-t pt-5">
        <GalleryGrid>
          <GalleryCell label="Badge · variant">
            {BADGE_VARIANTS.map((variant) => (
              <Badge key={variant} variant={variant}>
                {variant}
              </Badge>
            ))}
          </GalleryCell>
          <GalleryCell label="StatusBadge · 五档语义">
            {STATUS_TONES.map((status) => (
              <StatusBadge key={status} status={status} />
            ))}
          </GalleryCell>
          <GalleryCell label="StatusDot / ListBadge">
            {DOT_STATES.map((state) => (
              <span className="flex items-center gap-1.5" key={state}>
                <StatusDot state={state} />
                <span className="text-xs">{state}</span>
              </span>
            ))}
            <span className="w-full" />
            {(["neutral", "success", "warning", "danger", "primary"] as const).map((tone) => (
              <ListBadge key={tone} tone={tone}>
                {tone}
              </ListBadge>
            ))}
          </GalleryCell>
          <GalleryCell label="TaskTypeChip / SourceTag / Kbd">
            <TaskTypeChip taskType="T2I" />
            <TaskTypeChip taskType="I2V" />
            <SourceTag source="local" />
            <SourceTag source="cloud" />
            <span className="flex items-center gap-1">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
          </GalleryCell>
          <GalleryCell label="SelectChip · 选中 / 未选中">
            <div aria-label="尺寸选择演示" role="radiogroup">
              <SelectChip selected>16:9</SelectChip>
              <SelectChip shape="segment">1:1</SelectChip>
              <SelectChip>9:16</SelectChip>
            </div>
          </GalleryCell>
        </GalleryGrid>
      </div>
    </GallerySection>
  );
}
