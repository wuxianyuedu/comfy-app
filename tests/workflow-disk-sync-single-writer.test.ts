/**
 * 「本地文件工作流的更新只有一个入口」（用户实测反馈）：
 *
 * > 工作流文件有更新时，切界面后就自动更新了，需要我点同步按钮再更新。
 *
 * 根因是 `buildWorkflowDetailFull` 在检出磁盘变更时**自己**调
 * `workflowTemplateRepository.update(...)` 把磁盘内容写回库 —— 于是「切到详情」
 * 就等于「同步」，而列表/详情上那个「同步」按钮（`workflow.resync`）变得毫无
 * 意义：用户还没来得及决定，内容已经变了、`diskDirty` 标记也已经翻回 false。
 *
 * 契约（两条，缺一条那个症状就会回来）：
 *   1. 详情路径**只检出**（stat 比 mtime）**不写库**，把「有更新」这件事交给
 *      界面显示；
 *   2. `workflow.resync` 是**唯一**写回磁盘内容的入口，且写回后要清掉详情缓存
 *      —— 否则「点了同步、再进详情还是旧内容」又是新的自相矛盾（缓存 TTL 30s）。
 *
 * 用源码级断言而不是起真库：这条契约的价值在于「有没有第二个写入口」，
 * 而那是**读一眼就能定死**的事实；把它做成集成测试要拖进 repository、object_info
 * 解析与磁盘夹具，成本远高于它挡住的风险。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("详情加载不写库", () => {
  const src = read("src/lib/comfyui/workflow-detail.ts");

  it("磁盘比对只 stat 比 mtime，不重新导入源文件", () => {
    expect(src).toContain("sourceOutdated");
    // 详情不再自己重新导入（那一步会解析整份文件并把内容写回库）
    expect(src).not.toContain("reimportFromSource");
  });

  it("详情路径里没有对模板的写入调用", () => {
    /* 唯一的写入口在 workflow.resync —— 详情只回答「有没有新版本」。
     * 断言必须锚在 `await` 上：文件里那段说明性注释**引用了**这个调用名，
     * 裸匹配会把它当成真调用（这条断言第一版就是这么红的）。 */
    expect(src).not.toMatch(/await workflowTemplateRepository\.update\(/);
  });
});

describe("resync 是唯一写入口", () => {
  const src = read("src/server/api/routers/workflow.ts");

  it("它才做「重新导入 + 落库」", () => {
    expect(src).toMatch(/resync:[\s\S]{0,2000}?reimportFromSource/);
    expect(src).toMatch(/sourceMtime: result\.update\.sourceMtime/);
  });

  it("写回后清掉详情缓存（否则点完同步、详情还是旧内容）", () => {
    expect(src).toMatch(
      /resync:[\s\S]{0,2000}?invalidateWorkflowDetailCache\(ctx\.user\.id, existing\.id\)/,
    );
  });
});
