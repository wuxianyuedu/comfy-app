import type { Meta, StoryObj } from "@storybook/nextjs";

import { DraftIntegrityHint } from "~/components/workshop/DraftIntegrityHint";
import { auditDraftElements } from "~/lib/workshop/draft-integrity";

/**
 * 草稿「形状不认识、但已原样保留」的提示条（台账 F13″）。
 *
 * **它吃的数据是真判据算出来的**：story 先摆一份「坏在哪」的草稿，再调
 * `auditDraftElements()`（`~/lib/workshop/draft-integrity` 的纯函数，服务端镜像与
 * 浏览器缓存两扇门共用它）拿到结论。手抄一份 `DraftElementIssue[]` 是这一批要
 * 消掉的那类假形态 —— 看着对，而它与真实判据无关，判据改了 story 会继续显示旧口径。
 *
 * 这一条幅最该看的两件事都只有在真数据下才成立：
 *   · **结论句里的条数是按元素聚合的**（「2 条角色、1 条镜头」），不是问题总条数；
 *   · **清单最多列 5 条**，再多折成「另有 N 条」—— 把整份问题清单钉在页首会挡住正文。
 */
const BAD_CHARACTER_NUMBER = {
  id: "ch_1",
  name: "小美",
  // `styleTags` 该是数组，这里给字符串 —— 下游 `join()` 会拿到 undefined。
  styleTags: "赛博朋克",
};

const BAD_SHOT_INDEX = {
  id: "sh_2",
  index: "二",
  description: "推轨向前",
  status: "done",
};

/** 3 条元素各有问题：结论句里三类都出现，能验聚合口径。 */
const MIXED_DRAFT = {
  scenes: [{ id: "sc_1", heading: "", shotCount: 4 }],
  characters: [
    BAD_CHARACTER_NUMBER,
    { id: "ch_2", name: "阿岚", styleTags: "「护目镜」" },
  ],
  shots: [{ id: "sh_1", index: 1, description: "起幅" }, BAD_SHOT_INDEX],
};

/** 6 条镜头形状不对：`MAX_LINES` 是 5，所以这里必然出现「另有 N 条」。 */
const MANY_BAD_SHOTS = {
  scenes: [],
  characters: [],
  shots: Array.from({ length: 6 }, (_, i) => ({
    id: `sh_${String(i)}`,
    index: `第${String(i + 1)}`,
    description: `镜 ${String(i + 1)}`,
  })),
};

function HintSample({
  draft,
}: {
  draft: Parameters<typeof auditDraftElements>[0];
}) {
  const issues = auditDraftElements(draft);
  return (
    <div className="w-[42rem]">
      <DraftIntegrityHint issues={issues} onGoTo={() => undefined} />
      <p className="text-ink-muted mt-2 font-mono text-[11px]">
        判据算出 {issues.length} 处问题 · 跳转目标由第一条元素的种类决定
      </p>
    </div>
  );
}

const meta = {
  title: "Workshop/DraftIntegrityHint",
  component: HintSample,
  args: { draft: MIXED_DRAFT },
} satisfies Meta<typeof HintSample>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 三类都有问题：结论句走「1 场景、2 角色、1 镜头」的聚合口径。 */
export const MixedKinds: Story = {};

/**
 * 同一类超过 5 条：只列前 5 条，其余折成「另有 1 条同类问题」。
 *
 * 上面那条「最多列几条」的判据只有在这一档才看得见 —— 5 条以内时折行那条分支不渲染。
 */
export const MoreThanMaxLines: Story = {
  args: { draft: MANY_BAD_SHOTS },
};

/**
 * 没有问题时**不渲染**（`describeDraftIssues()` 给 `null`）。
 *
 * 这一档要验的是「不占位」：坏数据修好之后这条幅应该整个消失，而不是留一个空壳。
 * 同一个容器里放一条正常的提示对照，能看出前者确实一点位置都没占。
 */
export const CleanDraftRendersNothing: Story = {
  args: {
    draft: {
      scenes: [{ id: "sc_1", heading: "雨夜天台", shotCount: 4 }],
      characters: [{ id: "ch_1", name: "小美", styleTags: ["赛博朋克"] }],
      shots: [{ id: "sh_1", index: 1, description: "起幅", status: "done" }],
    },
  },
};
