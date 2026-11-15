// 主页与工坊的「项目完成度」必须是同一个数（#4025）：主页 `deriveProjectOverview`
// 的 `progressPct` 与工坊 `computeProgressPct(computeStageRatios(...))` 逐位一致。
// 两侧分属 lib 与 components（lib 不得 import components），公式是同式重写——
// 这条测试就是防漂移的钉子：改任一侧的口径都必须同步另一侧并让本测试保持绿。
import { describe, expect, it } from "vitest";

import { computeProgressPct, computeStageRatios } from "~/components/workshop/stage-config";
import { DEFAULT_PRODUCTION_PROGRESS, type ProductionProgress } from "~/lib/production/progress";
import { deriveProjectOverview } from "~/lib/production/project-home";
import { scriptDigestOf, type ProductionRunView } from "~/lib/production/run-types";

function makeView(parts: {
  characterCount: number;
  filmRendered: boolean;
  hasScript: boolean;
  shots: Array<{ hasClip: boolean; hasImage: boolean }>;
}): ProductionRunView {
  return {
    characterCount: parts.characterCount,
    filmRendered: parts.filmRendered,
    hasScript: parts.hasScript,
    scriptDigest: scriptDigestOf("parity"),
    shots: parts.shots.map((s, i) => ({
      id: `shot-${i}`,
      rev: 0,
      hasImage: s.hasImage,
      hasClip: s.hasClip,
    })),
  };
}

/** 工坊侧口径：与 use-workshop-pipeline 的取数同形（context 只差 sceneCount/shotTarget 两个未参与公式的字段）。 */
function workshopPct(view: ProductionRunView, rendered: boolean): number {
  return computeProgressPct(
    computeStageRatios(
      {
        characterCount: view.characterCount,
        clipDoneCount: view.shots.filter((s) => s.hasClip).length,
        imageDoneCount: view.shots.filter((s) => s.hasImage).length,
        sceneCount: 0,
        scriptReady: view.hasScript,
        shotCount: view.shots.length,
        shotTarget: 0,
      },
      rendered,
    ),
  );
}

const SAMPLES: Array<{
  characterCount: number;
  filmRendered: boolean;
  hasScript: boolean;
  shots: Array<{ hasClip: boolean; hasImage: boolean }>;
}> = [
  { characterCount: 0, filmRendered: false, hasScript: false, shots: [] },
  { characterCount: 0, filmRendered: false, hasScript: true, shots: [] },
  { characterCount: 2, filmRendered: false, hasScript: true, shots: [] },
  {
    characterCount: 2,
    filmRendered: false,
    hasScript: true,
    shots: [
      { hasClip: false, hasImage: true },
      { hasClip: false, hasImage: false },
    ],
  },
  {
    characterCount: 2,
    filmRendered: false,
    hasScript: true,
    shots: [
      { hasClip: true, hasImage: true },
      { hasClip: false, hasImage: true },
      { hasClip: true, hasImage: true },
    ],
  },
  {
    characterCount: 3,
    filmRendered: true,
    hasScript: true,
    shots: [
      { hasClip: true, hasImage: true },
      { hasClip: true, hasImage: true },
    ],
  },
];

describe("主页 ↔ 工坊 完成度同口径（#4025）", () => {
  for (const parts of SAMPLES) {
    const label = `script=${String(parts.hasScript)} chars=${String(parts.characterCount)} shots=${String(parts.shots.length)} rendered=${String(parts.filmRendered)}`;
    it(`逐位一致：${label}`, () => {
      const view = makeView(parts);
      const progress: ProductionProgress = {
        ...DEFAULT_PRODUCTION_PROGRESS,
        rendered: parts.filmRendered,
      };
      const home = deriveProjectOverview(view, progress);
      expect(home.progressPct).toBe(workshopPct(view, parts.filmRendered));
    });
  }
});
