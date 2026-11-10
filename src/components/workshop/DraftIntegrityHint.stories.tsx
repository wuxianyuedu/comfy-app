import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { DraftIntegrityHint } from "~/components/workshop/DraftIntegrityHint";
import { auditDraftElements } from "~/lib/workshop/draft-integrity";

/**
 * 草稿「形状不认识、但已原样保留」的提示条（台账 F13″）：story 摆一份坏草稿后调 `auditDraftElements()`（`~/lib/workshop/draft-integrity` 的真判据）
 * 拿结论，不手抄 `DraftElementIssue[]`（判据改了 story 不能继续显示旧口径）。真数据下才成立的两件事：结论句条数按元素聚合；清单最多列 5 条，再多折成「另有 N 条」。
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
  characters: [BAD_CHARACTER_NUMBER, { id: "ch_2", name: "阿岚", styleTags: "「护目镜」" }],
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

function HintSample({ draft }: { draft: Parameters<typeof auditDraftElements>[0] }) {
  const issues = auditDraftElements(draft);
  return (
    <div className="w-2xl">
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
 * 验的是「不占位」：坏数据修好之后这条幅应整个消失、不留空壳；
 * 同一容器里放一条正常提示对照，能看出前者确实一点位置都没占。
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
