"use client";

// 草稿元素「形状不认识，但已原样保留」的提示条（台账 F13″）。
//
// 纯展示：结论怎么算的、哪些字段算坏、坏了为什么要紧，全在
// `~/lib/workshop/draft-integrity` 那一份判据里（服务端镜像与浏览器缓存两扇门共用它）。
// 这里只负责把它翻译成一条不阻断操作的横幅 + 一份能定位到具体哪一条的清单。
//
// 为什么不复用 `StageHint`：那块是「阶段还没做完」的温和引导（按钮写死「去完成」），
// 而这一块说的是「数据里有读不懂的东西」——两种话硬挤进同一个组件，
// 迟早有人为了省一个文件把按钮改回「去完成」，把指错方向做成默认值。

import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import type { Tab } from "~/components/workshop/stage-config";

import {
  describeDraftIssues,
  type DraftElementIssue,
  type DraftElementKind,
} from "~/lib/workshop/draft-integrity";

/** 一次最多列几条元素。再多就折成「另有 N 条」—— 这条幅的用途是把人引到那一屏
 *  并告诉他「是哪几条」，不是把整份问题清单钉在页首挡住正文。 */
const MAX_LINES = 5;

/** 哪一类元素归哪一屏。方向是视图 → lib（判据不许反过来认识页签，硬规则 22）。
 *  镜头落在「场景分镜」而不是「镜头生图」：形状不对要改的是数据，改数据在那一屏。 */
const KIND_TAB: Record<DraftElementKind, Tab> = {
  scene: "script",
  character: "character",
  shot: "storyboard",
};

interface DraftIntegrityHintProps {
  issues: DraftElementIssue[];
  onGoTo: (tab: Tab) => void;
}

/** 把「一条元素的多个字段问题」并成一行：`镜头 #2 · 缺 id；镜号不是数字`。 */
function groupByElement(
  issues: readonly DraftElementIssue[],
): Array<{ label: string; reasons: string[]; tab: Tab }> {
  const lines = new Map<
    string,
    { label: string; reasons: string[]; tab: Tab }
  >();
  for (const issue of issues) {
    const key = `${issue.kind}:${String(issue.index)}`;
    const line = lines.get(key) ?? {
      label: issue.label,
      reasons: [],
      tab: KIND_TAB[issue.kind],
    };
    line.reasons.push(issue.reason);
    lines.set(key, line);
  }
  return [...lines.values()];
}

export function DraftIntegrityHint({
  issues,
  onGoTo,
}: DraftIntegrityHintProps) {
  const summary = describeDraftIssues(issues);
  if (!summary) return null;
  const lines = groupByElement(issues);
  const shown = lines.slice(0, MAX_LINES);
  const hiddenCount = lines.length - shown.length;
  const jumpTo = lines[0]?.tab ?? "shots";

  return (
    <div className="border-amber/30 bg-amber/10 text-amber mt-4 rounded-xl border px-4 py-2.5 text-xs">
      <div className="flex items-center gap-2">
        <Icon name="info" size={13} className="shrink-0" />
        <span className="flex-1">{summary}</span>
        <Button
          type="button"
          onClick={() => onGoTo(jumpTo)}
          variant="ghost"
          size="xs"
          className="bg-amber/15 text-amber hover:bg-amber/25 font-medium"
        >
          去看看 →
        </Button>
      </div>
      {/* 清单是「哪几条」这一格的答案：只报「有脏数据」等于没报 —— 用户面对 20 张卡片
       *  猜不出是哪一张，最后只会当成界面在瞎忙。 */}
      <ul className="text-amber/80 mt-2 flex flex-col gap-1 pl-5">
        {shown.map((line) => (
          <li key={line.label} className="list-disc">
            <span className="font-medium">{line.label}</span>
            <span className="text-muted-foreground">
              {" "}
              · {line.reasons.join("；")}
            </span>
          </li>
        ))}
        {hiddenCount > 0 && (
          <li className="text-muted-foreground list-none">
            另有 {hiddenCount} 条同类问题，跳到对应阶段后可逐条查看
          </li>
        )}
      </ul>
    </div>
  );
}
