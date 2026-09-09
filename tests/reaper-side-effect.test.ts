/**
 * 回归护栏:ComfyUI reaper(孤儿任务回收)必须仍在服务端启动路径上被副作用加载。
 *
 * 背景:runner.ts 曾是 `import "./reaper"` 的唯一触发点(该文件只做兼容
 * re-export + 副作用启动 reaper)。把它收编删除后,如果没人把 reaper 的
 * 副作用 import 挪到仍在被加载的入口上,QUEUED/RUNNING 的孤儿任务回收会
 * 被静默关掉——这不是死代码清理,是行为回归。
 *
 * 处置:副作用 import 现由 enqueue.ts 承担(enqueue 是所有入队/订阅 API 的
 * 公共入口,stream route / orchestrator / generate router 都从它取函数)。
 * 本测试守护这条链:enqueue.ts 必须包含对 "./reaper" 的裸副作用导入。
 * 将来若有人再次误删该 import 或把 reaper 挪走,此用例会先红,提示补回
 * 一个仍在启动路径上的宿主模块。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ENQUEUE_PATH = join(process.cwd(), "src", "lib", "comfyui", "enqueue.ts");

/** 提取模块内全部 import 语句原文。 */
function collectImports(src: string): string[] {
  const out: string[] = [];
  // 单行 import: 覆盖具名导入、默认导入、类型导入与裸副作用导入。
  for (const m of src.matchAll(/^import\s[^\n]+?;/gm)) {
    out.push(m[0]);
  }
  // 多行 import(from 换行前闭合的语句,如分组具名导入跨行)。
  const noSingle = src.replace(/^import\s[^\n]+?;/gm, "");
  for (const m of noSingle.matchAll(/import\s[\s\S]*?from\s+["'][^"']+["'];/gm)) {
    out.push(m[0].replace(/\s+/g, " ").trim());
  }
  return out;
}

describe("ComfyUI reaper 副作用启动路径回归", () => {
  it("enqueue.ts 以副作用方式导入 ./reaper", () => {
    const src = readFileSync(ENQUEUE_PATH, "utf8");
    const imports = collectImports(src);

    // 必须存在对 "./reaper" 的裸副作用导入(无具名绑定)。
    const sideEffect = imports.find(
      (stmt) => stmt.includes('"./reaper"') && !/import\s+[^"]*\{/.test(stmt)
    );
    expect(sideEffect, "enqueue.ts 必须副作用导入 ./reaper 以启动孤儿回收").toBeTruthy();
    expect(sideEffect).toContain("import \"./reaper\"");
  });

  it("reaper 自身是纯模块副作用自启动(无可被调用方遗漏的具名导出)", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "comfyui", "reaper.ts"),
      "utf8"
    );
    // reaper 的启动必须靠模块自副作用(self-start),不能依赖某个具名导出被
    // 调用方遗漏——这是本护栏的前提。它虽导出纯函数 `isTaskClaimedInProcess`
    // (供 reaper.test.ts 单测其认领逻辑),但那不影响孤儿回收的副作用启动:
    // 真正保证启动路径的是 `startReaper()` 在模块顶层被调用。若有人删掉该自
    // 启动调用或把侧副作用收进具名导出,此断言会先红,提示把副作用留在模块
    // 加载路径上。
    expect(src).toMatch(/^startReaper\(\);/m);
  });
});
