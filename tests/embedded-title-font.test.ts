/**
 * 内嵌标题字体这条链的同步判据（LFS 接线 + 字体资产 + CSS 引用）。
 *
 * 为什么这条链必须有执行者：它每一环失效都**不报错**，而且是三种不同的静默形态：
 *   · 缺 `filter.lfs.*` ⇒ `*.ttf` 按**原字节**进 git 历史，23 MB 永久化，
 *     想摘掉只能重写共享远端的历史；
 *   · 缺 `.githooks/pre-push` ⇒ 提交里是 LFS 指针、对象却留在本机，别人克隆回来
 *     拿到一段 `version https://git-lfs.github.com/spec/v1` 文本，标题静默回退；
 *   · `@font-face` 的 family 与 `--font-title` 的首选对不上 ⇒ 字体装了但没人用，
 *     23 MB 白背着。
 * 三种都不红。所以按「接线类判据」的老规矩写：**解析，不要按字面量包含**
 *（`toContain` 拦得住删行、拦不住在同一行前面加 `# `）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FONT_REL = "public/fonts/SarasaGothicSC-Bold.ttf";
const LICENSE_REL = "public/fonts/OFL-Sarasa-Gothic.txt";

function read(rel: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../${rel}`, import.meta.url)),
    "utf8",
  );
}

/** 取一个 sh 文件里**非注释**的命令行（用来判「这步到底还跑不跑」）。 */
function activeShellCommands(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

/** 解析 `.gitattributes` 里某个模式的属性表；模式没有该属性时返回 null。 */
function attrOf(pattern: string, key: string): string | null {
  for (const line of read(".gitattributes").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [glob, ...rest] = trimmed.split(/\s+/);
    if (glob !== pattern) continue;
    for (const kv of rest) {
      const [k, v] = kv.split("=");
      if (k === key) return v ?? "true";
    }
    return null;
  }
  return null;
}

/** 读 index 里某路径的对象内容（提交前就能判它是指针还是原字节）。 */
function indexBlob(path: string): string {
  return execFileSync("git", ["cat-file", "-p", `:${path}`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

describe("字体走 git-lfs 的三条接线", () => {
  it(".gitattributes 把 *.ttf 路由到 lfs 过滤器", () => {
    expect(attrOf("*.ttf", "filter"), "*.ttf 没走 lfs 过滤器").toBe("lfs");
  });

  it(".githooks/pre-push 存在，且那行 git lfs pre-push 是**活命令**不是注释", () => {
    const source = read(".githooks/pre-push");
    const calls = activeShellCommands(source).filter((l) =>
      l.startsWith("git lfs pre-push"),
    );
    expect(
      calls.length,
      "本仓库 core.hooksPath=.githooks 会整目录覆盖 .git/hooks，" +
        "少这个文件就是「指针进了 git、对象没上传」",
    ).toBe(1);
  });

  it("postinstall 注册过滤器，且带 --manual（不让它往 .githooks 写自己那套钩子）", () => {
    const source = read("scripts/install-git-hooks.mjs");
    // 判「真的被调用」：要求是一行独立语句，而不是出现在注释里或被注掉
    const wired = source
      .split(/\r?\n/)
      .some((l) =>
        /^\s*const lfs = git\(\["lfs", "install", "--local", "--manual"\]\);?$/.test(
          l.trim(),
        ),
      );
    expect(
      wired,
      "git lfs install --local --manual 没在 postinstall 里被调用",
    ).toBe(true);
    // 反向：钩子安装必须被 --manual 挡掉，否则它会往 .githooks/ 里写第二套
    expect(source).toContain("--manual");
  });

  it("反向对照：把钩子那行注释掉，判据要红", () => {
    const muted = '# git lfs pre-push "$@"\n';
    expect(
      activeShellCommands(muted).filter((l) => l.startsWith("git lfs pre-push"))
        .length,
      "注释行仍含同一段字面量 —— 在场判据不能按字面量包含",
    ).toBe(0);
  });
});

describe("字体资产本身", () => {
  it("index 里存的是 LFS 指针，且指针的 size 与工作树字节数一致", () => {
    const blob = indexBlob(FONT_REL);
    const pointer =
      /^version https:\/\/git-lfs\.github\.com\/spec\/v1\s+oid sha256:([0-9a-f]{64})\s+size (\d+)$/m.exec(
        blob,
      );
    expect(
      pointer,
      "index 里这个 .ttf 不是 LFS 指针 —— 说明提交时过滤器没生效，23 MB 已经原字节进历史",
    ).not.toBeNull();
    const onDisk = statSync(
      fileURLToPath(new URL(`../${FONT_REL}`, import.meta.url)),
    );
    expect(
      Number(pointer?.[2]),
      "指针记的 size 与磁盘字节数不一致（拷贝过的文件与提交出去的不是同一份）",
    ).toBe(onDisk.size);
    expect(onDisk.size, "一个完整 CJK weight 不该小于 10 MB").toBeGreaterThan(
      10_000_000,
    );
  });

  it("OFL 许可全文随字体一起放（再分发时这是条件，不是礼节）", () => {
    expect(
      existsSync(fileURLToPath(new URL(`../${LICENSE_REL}`, import.meta.url))),
    ).toBe(true);
    const license = read(LICENSE_REL);
    // 按这份 LICENSE 的**实际**措辞断言（`SIL Open Font License v1.1` 那一行），
    // 不是按记忆里「全大写标题」的形态 —— 后者在这份文本里根本不存在。
    expect(license).toMatch(
      /This Font Software is licensed under the SIL Open Font License/,
    );
    expect(license).toMatch(/SIL Open Font License v1\.1/);
    expect(license).toMatch(/Copyright \(c\)/);
  });
});

describe("@font-face 与 --font-title 必须指向同一个名字", () => {
  const css = () => read("src/app/globals.css");

  it("font-face 的 family 正是 --font-title 的首选，url 指向真实文件", () => {
    const source = css();
    const declared = /@font-face\s*\{[^}]*font-family:\s*"([^"]+)"/.exec(
      source,
    );
    expect(
      declared,
      "globals.css 里没有 @font-face —— 字体装了没人用",
    ).not.toBeNull();
    const firstFamily = /--font-title:\s*\n?\s*"([^"]+)"/.exec(source);
    expect(
      declared?.[1],
      "@font-face 的 family 与 --font-title 首选对不上，标题不会用上内嵌字面",
    ).toBe(firstFamily?.[1]);
    const url = /src:\s*url\("([^"]+\.ttf)"\)/.exec(source)?.[1];
    expect(url, "@font-face 没有 src").toBeTruthy();
    // url 是**站点根**路径（Next 把 public/ 挂在 /），磁盘上落在 public/ 下 ——
    // 两者差一层，直接拼 `..${url}` 会指到仓库根的 fonts/ 而判「文件不在」。
    expect(
      existsSync(fileURLToPath(new URL(`../public${url}`, import.meta.url))),
      `@font-face 指向 ${url}，但 public 下没有对应文件`,
    ).toBe(true);
  });

  it("只嵌 Bold 一档 ⇒ font-weight 必须是 700（调用点全是 700）", () => {
    const face = /@font-face\s*\{([^}]*)\}/.exec(css())?.[1] ?? "";
    expect(face).toMatch(/font-weight:\s*700/);
    expect(
      /public\/fonts\/[^"]*-SemiBold/.test(css()),
      "没有 600 档调用点，多嵌一档就是白搬 23 MB 进安装包",
    ).toBe(false);
  });
});
