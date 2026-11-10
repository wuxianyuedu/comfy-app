"use client";

import { Image as ImageIcon } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { AspectRatio } from "~/components/ui/aspect-ratio";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { CodeBlock } from "~/components/ui/code-block";
import { Disclosure } from "~/components/ui/disclosure";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "~/components/ui/item";
import { JsonViewer } from "~/components/ui/json-viewer";
import { KeyValueRows } from "~/components/ui/key-value-rows";
import { SettingsCard } from "~/components/ui/settings-card";
import { SectionLabel } from "~/components/ui/section-label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { TreeRow } from "~/components/ui/tree-rows";
import { ViewableImage } from "~/components/ui/image-viewer";
import { GalleryCell, GalleryGrid, GallerySection } from "~/components/ui/ui-kit-gallery-parts";

/**
 * 数据展示与杂项一组的演示（ISSUE #3525）。
 * 卡片 / 表格 / 树行是「行底色隔行换档」的直接消费者，两态下各看隔行档与
 * 悬停档；JSON / 代码块的两态主题由各自 token 承载（见 §3.6.1 那两行）。
 */

/** 演示图：静态 SVG 放 `public/`（内容色不属于表面 token 的量程，同 Storybook 的 sample 图）。 */
const SAMPLE_IMAGE = "/ui-kit-sample.svg";

export function DataSection() {
  return (
    <GallerySection
      note="卡片 / 表格 / 树行的隔行底与边框档两态各看一遍；JSON 与代码块主题随态切换。"
      title="数据展示与杂项"
    >
      <GalleryGrid>
        <GalleryCell className="col-span-full" label="Card 全骨架">
          <Card className="w-full max-w-120">
            <CardHeader>
              <CardTitle>卡片标题</CardTitle>
              <CardDescription>卡片副说明一行。</CardDescription>
              <CardAction>
                <span className="text-ink-faint text-xs">右上动作位</span>
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-sm">内容区。</p>
            </CardContent>
            <CardFooter>
              <span className="text-ink-muted text-xs">页脚区</span>
            </CardFooter>
          </Card>
        </GalleryCell>
        <GalleryCell className="col-span-full" label="Table（含表头 / 表体）">
          <div className="border-border w-full max-w-120 overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">耗时</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>首镜出图</TableCell>
                  <TableCell>已完成</TableCell>
                  <TableCell className="text-right">12s</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>二镜重绘</TableCell>
                  <TableCell>进行中</TableCell>
                  <TableCell className="text-right">—</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </GalleryCell>
        <GalleryCell className="col-span-full" label="Accordion / Disclosure">
          <div className="flex w-full max-w-120 flex-col gap-2">
            <Accordion>
              <AccordionItem value="acc-1">
                <AccordionTrigger>手风琴标题</AccordionTrigger>
                <AccordionContent>展开后的内容。</AccordionContent>
              </AccordionItem>
            </Accordion>
            <Disclosure
              defaultOpen
              trailing={<span className="text-ink-faint text-xs">2 项</span>}
              trigger={<span className="text-sm">折叠行（Disclosure）</span>}
            >
              <p className="text-ink-muted px-6 pb-3 text-xs">折叠面板的内容。</p>
            </Disclosure>
          </div>
        </GalleryCell>
        <GalleryCell label="Avatar / Item">
          <Avatar>
            <AvatarFallback>月</AvatarFallback>
          </Avatar>
          <Item className="w-60">
            <ItemMedia>
              <ImageIcon aria-hidden className="size-4" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>一个条目</ItemTitle>
              <ItemDescription>条目说明。</ItemDescription>
            </ItemContent>
            <ItemActions>
              <span className="text-ink-faint text-xs">操作</span>
            </ItemActions>
          </Item>
        </GalleryCell>
        <GalleryCell label="KeyValueRows / TreeRow">
          <div className="w-full max-w-72">
            <KeyValueRows
              items={[
                { key: "分辨率", value: "1024×1024" },
                { key: "步数", value: "28" },
              ]}
            />
          </div>
          <div className="w-full max-w-72">
            <TreeRow row={<span className="flex items-center gap-2">根节点</span>}>
              <div className="flex items-center gap-2 text-sm">子节点 A</div>
              <div className="flex items-center gap-2 text-sm">子节点 B</div>
            </TreeRow>
          </div>
        </GalleryCell>
        <GalleryCell label="JsonViewer / CodeBlock">
          <div className="w-full max-w-72">
            <JsonViewer data={{ steps: 28, cfg: 4.5, sampler: "euler" }} title="参数" />
          </div>
          <div className="w-full max-w-72">
            <CodeBlock code="pnpm dev" language="bash" />
          </div>
        </GalleryCell>
        <GalleryCell label="ViewableImage / AspectRatio">
          <ViewableImage
            alt="示例图"
            className="w-32 rounded-lg"
            label="点开看大图"
            src={SAMPLE_IMAGE}
          />
          <div className="w-32">
            <AspectRatio ratio={16 / 9}>
              <div className="bg-primary-soft text-primary-strong flex h-full items-center justify-center text-xs">
                16:9
              </div>
            </AspectRatio>
          </div>
        </GalleryCell>
        <GalleryCell label="SettingsCard / SectionLabel">
          <SettingsCard description="设置页卡片的统一形态。" title="创作后端">
            <p className="text-sm">卡内内容。</p>
          </SettingsCard>
          <SectionLabel hint="带问号的段标题">段落标题</SectionLabel>
        </GalleryCell>
      </GalleryGrid>
    </GallerySection>
  );
}
