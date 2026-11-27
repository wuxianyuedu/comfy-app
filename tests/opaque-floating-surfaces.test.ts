/**
 * 高不透明浮层不得再挂背景模糊（ISSUE #5201，承接 #5195「界面操作掉帧」，规范 03 §3.13）。
 *
 * 三处浮层此前都是「90~95% 不透明表面 + backdrop-blur」的退化形态：模糊透出只有
 * 5~10%，读不出「下面有活的内容流过」，却把整块表面拖进一个 backdrop-filter 图层。
 * 工坊画布上背后节点频繁移动时，这是每帧都在付的常驻合成税。按 §3.13 的裁决：
 * 撤掉模糊、把底色还原成不透明 token，层次交给已有的分层阴影 + 描边。
 *
 * 判「图像对不对」靠人眼（截图回帖诉求单），这里锁的是可机读的形状回归 ——
 * 防止某次「顺手加回 blur」把这笔合成税悄悄带回来。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** 每处浮层：源文件相对路径 + 承载面 class 里必须出现的不透明底色 token。 */
const SURFACES = [
  {
    file: "src/components/workshop/AgentOverlay.tsx",
    token: "bg-panel-deep",
    why: "Agent 对话浮层（原 bg-panel-deep/95 + backdrop-blur-xl）",
  },
  {
    file: "src/components/studio/BrowserStatusBar.tsx",
    token: "bg-panel",
    why: "底部状态栏（原 bg-panel/95 + backdrop-blur-sm）",
  },
  {
    file: "src/components/studio/project-canvas/GlobalStepLogPanel.tsx",
    token: "bg-panel",
    why: "执行日志触发按钮（原 bg-panel/90 + backdrop-blur-sm）",
  },
] as const;

describe("高不透明浮层不挂背景模糊（ISSUE #5201 / 规范 03 §3.13）", () => {
  it.for(SURFACES)("$why：不带 backdrop-blur", ({ file }) => {
    const src = stripComments(readFileSync(path.join(ROOT, file), "utf8"), { trailing: true });
    expect(src, `${file} 仍带背景模糊`).not.toMatch(/backdrop-blur/);
  });

  it.for(SURFACES)("$why：底色为不透明 token（无 /NN 半透档）", ({ file, token }) => {
    const src = stripComments(readFileSync(path.join(ROOT, file), "utf8"), { trailing: true });
    /* 承载面用不透明 token，且没有把它写成 /85~95 的半透档。 */
    expect(src, `${file} 缺不透明底色 ${token}`).toMatch(new RegExp(`\\b${token}\\b`));
    expect(src, `${file} 仍用半透底色 ${token}/NN`).not.toMatch(new RegExp(`\\b${token}/\\d+`));
  });
});
