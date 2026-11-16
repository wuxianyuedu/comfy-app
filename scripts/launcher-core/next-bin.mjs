// next 可执行入口的解析（dev server / production server 链共用，§12.18 一处实现）。
//
// 为什么有一份（ISSUE #4155）：dev.mjs / start.mjs 起服务此前经 `pnpm exec next`
// —— 那一跳要付一次 Windows pnpm shim 冷启（实测 1~1.5s/次），并把「shim 形态坏了」
// 这个失败类（ISSUE #576 家族）带进 server 链。而 server 链对 pnpm **没有依赖**：
// node 自己就是编排器正在跑的运行时（`process.execPath` 是整条链上最可靠的形态），
// next 的 bin 是纯 JS 入口，经它直启既省一跳 shim、也少一层进程。
// pnpm 形态判据（shell.mjs）继续管**真正用 pnpm 的地方**（install / db-push / 探测）；
// 两份入口（dev / start）都从这里拿 bin 路径，不许各自拼 `node_modules/next/dist/bin/next`
// 字面量 —— 那会把 pnpm-layout 的解析细节抄散到两个调用点。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * 解析检出根上 `next` 包的 bin 入口（绝对路径）；解析不到返回 null。
 *
 * 解析锚点是 `createRequire(<root>/package.json)`：与 tsc / eslint 看到的是同一个根，
 * 「在这个仓库根上 import next」能不能解析就是判据本身。bin 路径取 next 自己
 * package.json 的 `bin` 字段（对象形态取 `next` 键；字符串形态是单 bin 包的写法，
 * 一并兼容），不写死 `dist/bin/next` —— next 改 bin 落点时这里跟着包走。
 * 「解析失败 = null」刻意包住全部三步（resolve / 读 bin 字段 / bin 文件存在性）：
 * 调用方（dev.mjs / start.mjs）据此给可行动提示，绝不把坏路径交给 spawn。
 *
 * @param {string} root 检出根（绝对路径）
 * @returns {string | null} bin 的绝对路径；依赖没装好 / 包被清空 / bin 缺失时 null
 */
export function resolveNextBin(root) {
  try {
    const req = createRequire(path.join(root, "package.json"));
    const pkgPath = req.resolve("next/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.next;
    if (!bin) {
      return null;
    }
    const binPath = path.join(path.dirname(pkgPath), bin);
    return fs.existsSync(binPath) ? binPath : null;
  } catch {
    return null;
  }
}
