/**
 * 像素基线必须**成对齐全**：一份 `.visual.spec.ts` 里每个截图名，都得在项目实际会跑的
 * 每个平台上有对应的 PNG，且**被 git 跟踪**。
 *
 * 动因（规范 §11.8 已写下这条约束，但一直没有判据）：`toHaveScreenshot` 的默认文件名含
 * `{platform}`，而入库的那套曾是 `-linux.png`（CI 还在时录的）。CI 下线后开发机是
 * Windows —— 跑 `pnpm test:visual` 报的是
 * `A snapshot doesn't exist at …-win32.png, writing actual`：**判失败，同时把生成的
 * `-win32.png` 直接写进快照目录**。那一半不被 .gitignore 忽略，于是留下「半套基线」：
 * 像素层看着存在，实际在唯一的开发机上**一次都没跑通过** —— 与 §11.7 要避免的
 * 「不可信的绿灯」同形。本文件把「补齐并成套提交」这件事从人工承诺变成可判定。
 *
 * 三条判据各管一种静默失效：
 *   1. **齐全**：spec 里声明的每个截图名，在 SUPPORTED_PLATFORMS 的每一档都要有 PNG。
 *      少一档 = 那一档的执行者一跑就红，且会顺手往仓库里写未入库的 PNG。
 *   2. **被跟踪**：磁盘上有但未入库的 PNG 等于「只在本机绿」，别人克隆下来照样红 ——
 *      §11.8 那句「同一截图名各平台成套提交」落在这里。
 *   3. **名字↔平台双向对得上**：出现没登记的平台后缀（`-darwin` / 手滑的 `-window`），
 *      既说明有人换了执行环境没更新口径，也会让「齐全」两条各数一半。
 *
 * 清点内核在 `scripts/visual-baselines.mjs`（§12.12：与 `scripts/pixel-run.mjs` 的
 * **本机前置判决**共用同一份，不各抄一份）。平台登记的口径也搬到了那里 —— 它是两侧
 * 共同的输入，放在任一消费方里都会让另一方去猜。
 *
 * 本判据**只管仓库里那几套基线的形态**，与「本机有没有基线」是两件事：后者问的是
 * 运行这台机器会不会一跑就红，由 `pixel-run.mjs` 起任何东西之前先答（见其
 * `checkLocalBaselines`）。把两者混起来会让本判据在没登记过像素平台的机器上红 ——
 * 那是误报，不是发现。
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  SUPPORTED_PLATFORMS,
  declaredShotNames,
  missingBaselinesForPlatform,
  parseBaseline,
  snapshotsFor,
  untrackedBaselines,
  visualSpecs,
} from "../scripts/visual-baselines.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("像素基线成对齐全且入库（§11.8）", () => {
  const specs = visualSpecs(ROOT);

  it("扫描面收到了视觉 spec（不是空数组假装通过）", () => {
    expect(specs.length).toBeGreaterThan(0);
    for (const { spec, names } of specs) {
      expect(
        names.length,
        `${spec} 里没有 toHaveScreenshot 声明`,
      ).toBeGreaterThan(0);
    }
  });

  it("每个截图名在各支持平台上都有基线", () => {
    const missing: string[] = [];
    for (const platform of SUPPORTED_PLATFORMS) {
      missing.push(...missingBaselinesForPlatform(ROOT, platform));
    }
    expect(missing).toEqual([]);
  });

  it("基线 PNG 全部入库（磁盘上有而 git 没跟踪 = 只在本机绿）", () => {
    expect(untrackedBaselines(ROOT)).toEqual([]);
  });

  it("没有未登记的平台后缀，也没有查无此名的孤儿基线", () => {
    const orphans: string[] = [];
    for (const { spec, names } of specs) {
      const shotDir = `${spec}-snapshots`;
      for (const name of snapshotsFor(ROOT, shotDir).keys()) {
        if (!names.includes(name)) orphans.push(`${shotDir}/${name}`);
      }
      // 平台维度：快照目录里出现没登记的平台后缀（`-darwin` / 手滑的 `-window`），
      // 既说明有人换了执行环境没更新口径，也会让上面那条「齐全」只数一半。
      for (const file of snapshotFiles(shotDir)) {
        const parsed = parseBaseline(file);
        if (!parsed) {
          orphans.push(`${shotDir}/${file}`);
        } else if (!SUPPORTED_PLATFORMS.includes(parsed.platform)) {
          orphans.push(`${shotDir}/${file}（平台 ${parsed.platform} 未登记）`);
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  it("判据不是空转：缺平台 / 未入库 / 孤儿名都要被点名", () => {
    // ① 截图名解析认得带 options 参数的写法，且去掉 .png。
    expect(
      declaredShotNames(
        'await expect(page).toHaveScreenshot("a.png", { fullPage: true });\n' +
          'await expect(page).toHaveScreenshot("b.png");',
      ),
    ).toEqual(["a", "b"]);
    // ② 名字↔平台解析只认登记过的平台形状，别的形状拆不出东西（所以孤儿那条会点名它）。
    expect(parseBaseline("login-desktop-chromium-win32.png")).toEqual({
      name: "login-desktop",
      platform: "win32",
    });
    expect(parseBaseline("login-desktop-chromium-docker.png")).toBeNull();
    // ③ 平台档位是口径，被悄悄掏空时上面两条会一起恒绿。
    expect(SUPPORTED_PLATFORMS.length).toBeGreaterThan(0);
    expect(SUPPORTED_PLATFORMS).toContain("win32");
    // ④ linux 现在在口径里（恢复这一档的那次提交：重录成套 PNG + 同批登记）；
    //    而没登记过的档（darwin）照样被上面几条点名，口径没被掏空。
    expect(parseBaseline("login-desktop-chromium-linux.png")?.platform).toBe(
      "linux",
    );
    expect(SUPPORTED_PLATFORMS).toContain("linux");
    expect(SUPPORTED_PLATFORMS).not.toContain("darwin");
    // ⑤ 清点内核**真的接了输入**：没登记的那档必然缺点名（否则「本机没有基线」
    //    那条前置判决永远说「有」）。
    expect(
      missingBaselinesForPlatform(ROOT, "darwin").length,
    ).toBeGreaterThan(0);
    expect(missingBaselinesForPlatform(ROOT, "linux")).toEqual([]);
  });
});

/** 某个快照目录里的文件名（目录不存在时为空）。 */
function snapshotFiles(shotDir: string): string[] {
  const abs = path.join(ROOT, shotDir);
  return existsSync(abs) ? readdirSync(abs) : [];
}
