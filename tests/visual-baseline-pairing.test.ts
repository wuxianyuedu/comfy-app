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
 * SUPPORTED_PLATFORMS 是**口径**：新增一档执行环境时，先用同一份 spec 在那档上
 * `--update-snapshots` 录出成套 PNG，再同批改这里 —— 只登记平台不录基线、或只录基线不
 * 登记平台，都会让像素层在那一档静默失效。当前只有 win32：`-linux.png` 那两张录于全局
 * 状态栏出现之前、也没有 mask 规则，与本 spec 已经不是同一件界面，留着就是一份对不上
 * 现状的旧账（要恢复 linux 档按上面那条走，不是把旧 PNG 贴回来）。
 * 扫描面按 `e2e/visual/` 目录发现，不维护 spec 清单 —— 写死的清单正是会漂的那类东西。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const VISUAL_DIR = "e2e/visual";

/**
 * 项目实际会跑像素回归的平台。
 *   · win32 —— 开发机，`pnpm test:visual` 的执行处（实测两次连跑零差异）。
 */
const SUPPORTED_PLATFORMS = ["win32"];

/** `{name}-{projectName}-{platform}.png` —— Playwright 默认的基线文件形态。 */
const BASENAME_RE = /^(.+)-chromium-(linux|win32|darwin)\.png$/;

/** spec 里 `toHaveScreenshot("x.png")` 声明的截图名（不含扩展名）。 */
export function declaredShotNames(specText: string): string[] {
  const names = new Set<string>();
  for (const m of specText.matchAll(/toHaveScreenshot\(\s*["']([^"']+)["']/g)) {
    const raw = m[1];
    if (raw) names.add(raw.replace(/\.png$/i, ""));
  }
  return [...names];
}

/** 一份基线文件名拆出的「截图名 + 平台」；形状不对返回 null（由孤儿判据点名）。 */
export function parseBaseline(
  file: string,
): { name: string; platform: string } | null {
  const m = BASENAME_RE.exec(file);
  const name = m?.[1];
  const platform = m?.[2];
  return name && platform ? { name, platform } : null;
}

/** git 跟踪着的该目录下的文件（相对仓库根的路径）。 */
export function trackedFiles(dir: string): string[] {
  const out = execFileSync("git", ["ls-files", "--", dir], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out.split(/\r?\n/).filter(Boolean);
}

/** 快照目录里的 PNG，按「截图名 → 平台数组」聚合（未跟踪的那些在调用方再判一次）。 */
function snapshotsFor(shotDir: string): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  if (!existsSync(path.join(ROOT, shotDir))) return byName;
  for (const file of readdirSync(path.join(ROOT, shotDir))) {
    const parsed = parseBaseline(file);
    if (!parsed) continue;
    const list = byName.get(parsed.name) ?? [];
    list.push(parsed.platform);
    byName.set(parsed.name, list);
  }
  return byName;
}

/** 扫描面：`e2e/visual/*.visual.spec.ts` 及其同名 `-snapshots` 目录。 */
function visualSpecs(): Array<{
  spec: string;
  shotDir: string;
  names: string[];
}> {
  const dir = path.join(ROOT, VISUAL_DIR);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".visual.spec.ts"))
    .map((f) => ({
      spec: `${VISUAL_DIR}/${f}`,
      shotDir: `${VISUAL_DIR}/${f}-snapshots`,
      names: declaredShotNames(
        readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n"),
      ),
    }));
}

describe("像素基线成对齐全且入库（§11.8）", () => {
  const specs = visualSpecs();

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
    for (const { spec, names } of specs) {
      const found = snapshotsFor(`${spec}-snapshots`);
      for (const name of names) {
        for (const platform of SUPPORTED_PLATFORMS) {
          if (!(found.get(name) ?? []).includes(platform)) {
            missing.push(`${spec} → ${name} 缺 ${platform}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("基线 PNG 全部入库（磁盘上有而 git 没跟踪 = 只在本机绿）", () => {
    const tracked = new Set(trackedFiles(VISUAL_DIR));
    const untracked: string[] = [];
    for (const { spec } of specs) {
      const shotDir = `${spec}-snapshots`;
      if (!existsSync(path.join(ROOT, shotDir))) continue;
      for (const file of readdirSync(path.join(ROOT, shotDir))) {
        if (!file.endsWith(".png")) continue;
        if (!tracked.has(`${shotDir}/${file}`))
          untracked.push(`${shotDir}/${file}`);
      }
    }
    expect(untracked).toEqual([]);
  });

  it("没有未登记的平台后缀，也没有查无此名的孤儿基线", () => {
    const orphans: string[] = [];
    for (const { spec, names } of specs) {
      const shotDir = `${spec}-snapshots`;
      if (!existsSync(path.join(ROOT, shotDir))) continue;
      for (const file of readdirSync(path.join(ROOT, shotDir))) {
        if (!file.endsWith(".png")) continue;
        const parsed = parseBaseline(file);
        if (!parsed || !names.includes(parsed.name)) {
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
    // ④ 认得 linux 的形状、但不认它进口径 —— 所以「贴回一张旧 linux 基线」会被孤儿那条点名。
    expect(parseBaseline("login-desktop-chromium-linux.png")?.platform).toBe(
      "linux",
    );
    expect(SUPPORTED_PLATFORMS).not.toContain("linux");
  });
});
