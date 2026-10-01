"use client";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { KeyValueRows } from "~/components/ui/key-value-rows";
import { Skeleton } from "~/components/ui/skeleton";
import { ButtonLink } from "~/components/ui/button";
import { displayValue } from "~/lib/display-value";

import { useModelOverview } from "./hooks/use-model-overview";

/** 概览最多列几类；再多就折成一句「另有 N 类」，免得这一块把首页撑长。 */
const MAX_GROUPS = 5;

/**
 * 首页「模型概览」卡。
 *
 * 回答的是开工前的另一个问题：「我本机到底有没有能用的东西」。它和「本机算力」
 * 那张卡是一对 —— 一张说后端在不在线、还剩多少显存，一张说模型库里有什么。
 * 两者都只读现成出口，视图层零 IO（规范 §17）。
 *
 * 刻意不做的事：不显示「0 个模型」的那些目录（会稀释信息），但**用一句话交代
 * 有几个空目录** —— 全部为空时界面不能看起来像「功能没做」。
 */
export function HomeModelOverview() {
  const m = useModelOverview();

  if (m.loading) {
    return (
      <Card data-component="home-model-overview" className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-ink-bright">模型概览</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={`model-overview-skeleton-${i}`} className="h-4" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (m.error) {
    return (
      <Card data-component="home-model-overview" className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-ink-bright">模型概览</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-ink-muted text-xs">{m.error}</p>
        </CardContent>
        <CardFooter>
          <ButtonLink href="/models" size="xs" variant="ghost">
            去模型库
          </ButtonLink>
        </CardFooter>
      </Card>
    );
  }

  const shown = m.groups.slice(0, MAX_GROUPS);
  const folded = m.groups.length - shown.length;

  return (
    <Card data-component="home-model-overview" className="rounded-2xl">
      <CardHeader className="flex-row items-center gap-2">
        <CardTitle className="text-ink-bright flex-1">模型概览</CardTitle>
        <span className="text-ink-muted text-xs tabular-nums">
          {m.total > 0 ? `共 ${m.total} 个` : displayValue(null)}
        </span>
      </CardHeader>
      <CardContent>
        {shown.length > 0 ? (
          <KeyValueRows
            layout="rows"
            mono={false}
            items={shown.map((group) => ({
              key: group.label,
              value: `${group.count} 个`,
            }))}
          />
        ) : (
          /* 一个模型都没有：说清楚并给出出口，而不是留一个空表格。 */
          <p className="text-ink-muted text-xs">
            本机还没有同步到可用模型。把文件放进 ComfyUI 的 models 目录后，
            在模型库里点「同步模型」。
          </p>
        )}
        {(folded > 0 || m.emptyFolderCount > 0) && (
          <p className="text-ink-fainter mt-2 text-[11px]">
            {folded > 0 ? `另有 ${folded} 类未列出` : ""}
            {folded > 0 && m.emptyFolderCount > 0 ? " · " : ""}
            {m.emptyFolderCount > 0 ? `${m.emptyFolderCount} 个目录为空` : ""}
          </p>
        )}
      </CardContent>
      <CardFooter>
        <ButtonLink href="/models" size="xs" variant="ghost">
          去模型库
        </ButtonLink>
      </CardFooter>
    </Card>
  );
}
