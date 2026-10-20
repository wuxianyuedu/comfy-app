"use client";

import { RefreshCcw } from "lucide-react";

import { AuroraBackground } from "~/components/ui/aurora-background";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { ViewActions } from "~/components/studio/ViewActions";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { PageHeader } from "~/components/ui/page-header";
import { StatusDot } from "~/components/ui/status-dot";

import type { StyleLabController } from "./hooks/use-style-lab";
import { StyleLabCreateForm } from "./StyleLabCreateForm";
import { StyleLabList } from "./StyleLabList";

/**
 * 风格实验室 · 第③层（纯视图）：只渲染 controller，不发请求、不含业务规则。
 *
 * 布局沿用队列那一屏（`QueueMonitorView`）的骨架：文档框 + 极光背景 + `PageHeader`
 * （屏名已由页签给出，故只 `srTitle`、不再重复一次可见标题 —— ISSUE #1693）+
 * `ViewActions` 把计数与刷新挂到顶栏。两块各答一件事：已登记的试验（浏览 + 软删）
 * 与新建试验（存这一批要试的形状）。这里没有第三块「跑一批」—— 那还没上线，
 * 诚实起见也不摆一个点了没反应的假区，只在表单尾部留一句禁用说明。
 */
export function StyleLabView({ c }: { c: StyleLabController }) {
  return (
    <DocumentFrame
      width="wide"
      className="px-4 pt-4 pb-6 sm:px-8 sm:pt-5 sm:pb-8"
      backdrop={<AuroraBackground />}
    >
      <PageHeader srTitle={pageHeaderTitle("style-lab")} />

      <ViewActions>
        <span className="text-ink-faint text-xs tabular-nums">
          {`${String(c.items.length)} 条试验`}
        </span>
        <span className="text-ink-fainter flex items-center gap-1.5 text-2xs">
          <StatusDot state="probing" sizeClass="size-1.5" />
          {c.batchRunner.reason}
        </span>
        <Button
          variant="outline"
          size="xs"
          onClick={c.refresh}
          aria-label="重新读取试验列表"
          className="border-border text-ink-faint hover:text-ink-bright h-auto gap-1.5 rounded-lg px-3 py-1.5"
        >
          <RefreshCcw data-icon="inline-start" className="size-3" aria-hidden />
          刷新
        </Button>
      </ViewActions>

      {c.loadError ? (
        <EmptyState
          className="mb-6"
          variant="hint"
          title={c.loadError}
          description="读不到试验记录时不沿用旧数据 —— 把已删的又显示出来，比读到空更坏。"
        />
      ) : null}

      <div className="flex flex-col gap-6">
        <section aria-labelledby="style-lab-records-heading">
          <h2
            id="style-lab-records-heading"
            className="text-ink-bright mb-2 text-sm font-semibold"
          >
            试验记录
          </h2>
          <StyleLabList c={c} />
        </section>

        <StyleLabCreateForm c={c} />
      </div>
    </DocumentFrame>
  );
}
