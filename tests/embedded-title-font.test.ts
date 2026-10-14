/**
 * 内嵌标题字体这条链的同步判据（LFS 接线 + 字体资产 + CSS 引用）。
 *
 * 为什么这条链必须有执行者：它每一环失效都**不报错**，而且是三种不同的静默形态：
 *   · 缺 `filter.lfs.*` ⇒ 字体按**原字节**进 git 历史，8.6 MB 永久化，
 *     想摘掉只能重写共享远端的历史；
 *   · 缺 `.githooks/pre-push` ⇒ 提交里是 LFS 指针、对象却留在本机，别人克隆回来
 *     拿到一段 `version https://git-lfs.github.com/spec/v1` 文本，标题静默回退；
 *   · `@font-face` 的 family 与 `--font-title` 的首选对不上 ⇒ 字体装了但没人用，
 *     8.6 MB 白背着。
 * 三种都不红。所以按「接线类判据」的老规矩写：**解析，不要按字面量包含**
 *（`toContain` 拦得住删行、拦不住在同一行前面加 `# `）。
 *
 * ── 载体从 TTF 换成 woff2 之后，这条链多出来的两个静默形态（本轮补）──────
 *   · **`format()` 与文件真实载体对不上**：写成 `url(...woff2) format("truetype")`
 *     时 Chromium **不会拒绝**（它按嗅探出的载体解码，`format()` 只是「要不要下载」
 *     的门），于是浏览器里一切正常、判据也绿 —— 但 `format()` 是喂给**别的**解析器的
 *     （Safari 老版本 / 我们自己的 CSS 工具链），错的那一端不会喊。
 *     所以本文件判的是「扩展名 / `format()` / 磁盘文件 / LFS 属性」**四者同名**。
 *   · **`.gitattributes` 只认 `*.ttf`**：换载体时只改文件与 CSS、忘了加一行属性，
 *     LFS 过滤器就不接这条路径 —— 表现与上面第一种完全相同（原字节进历史），
 *     而「`*.ttf` 有 lfs 过滤器」那条断言照样是绿的。所以属性断言改成**逐载体**核。
 *
 * 载体换过之后**渲染等价**这件事在这里是**说明**、不是判据：等价性用真 Chromium
 * 对拍过（同一段中英混排文本，TTF 与 woff2 各截一图，**逐字节相同**；把 `font-display`
 * 换成 `block` 等修改不影响结论），而反向对照也真跑过 —— 故意把字体文件改名之后
 * 截图**不同**（回退栈画出来的字面肉眼可辨），说明「截图相同」不是空判断。
 * 这一段之所以不做成用例：跑它要拉真浏览器，代价与这条链的静态判据不在一个量级。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FONT_REL = "public/fonts/SarasaGothicSC-Bold.woff2";
/** 站点根路径 → 仓库路径（`/fonts/x.woff2` 落在 `public/fonts/x.woff2`）。 */
const PUBLIC_REL_OF = (sitePath: string) => `public${sitePath}`;
/** 文件载体 → CSS 里该写的扩展名与 `format()`，两者必须同一项。 */
const FONT_CARRIERS = [
  { ext: ".woff2", format: "woff2", glob: "*.woff2" },
  { ext: ".ttf", format: "truetype", glob: "*.ttf" },
] as const;
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

/**
 * 解析 `.gitattributes` 里某个模式的属性表；模式没有该属性时返回 null。
 *
 * ⚠️ 返回的是**第一条**匹配行上的值（与 git 自己的合并顺序相反：git 后写胜出）——
 * 这个方向是刻意的，因为「按行读属性」的实现都取首条，而同一 glob 写两行时
 * 首条漏了 `filter=lfs` 就是静默失效。所以这里另有 `duplicateGlobs()` 把
 * 「同一个 glob 出现多次」直接判成红，而不是靠取哪一条来决定结论。
 */
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

/**
 * 同一个 glob 在属性表里出现了几次。
 *
 * 为什么单独判它：git 按「后写胜出」合并，而**按行读**的实现取首条 —— 两处各写
 * 一条、其中一条没有 `filter=lfs`（实例：`*.woff2 binary` 曾与后面的字体规则并存），
 * 表现是「两条都看得见、LFS 却不生效」，而任何一条按 glob 取值的断言都可能照样绿。
 * 判据不让这两种读法有分叉的机会：出现两次即红。
 */
function countGlob(pattern: string): number {
  let n = 0;
  for (const line of read(".gitattributes").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.split(/\s+/)[0] === pattern) n += 1;
  }
  return n;
}

/** 读 index 里某路径的对象内容（提交前就能判它是指针还是原字节）。 */
function indexBlob(path: string): string {
  return execFileSync("git", ["cat-file", "-p", `:${path}`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

describe("字体走 git-lfs 的三条接线", () => {
  it("每一种字体载体的扩展名都路由到 lfs 过滤器（换载体必须同批加属性）", () => {
    for (const { glob } of FONT_CARRIERS) {
      expect(attrOf(glob, "filter"), `${glob} 没走 lfs 过滤器`).toBe("lfs");
      expect(countGlob(glob), `${glob} 在属性表里出现了多次`).toBe(1);
    }
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

  it("反向对照：换载体时只改文件不加上面的属性 ⇒ 上面那条必须红", () => {
    // 真实形态就是「在 .gitattributes 里加 `*.ttf` 那一行时顺手抄了 woff2，
    // 后来换载体只改了文件与 CSS」—— 属性表里于是没有 *.woff2 这一条。
    // 这里按**属性解析**（不是字面量包含）复算一遍，确认它会红。
    const attrsWithoutWoff2 = "*.ttf   binary filter=lfs diff=lfs -text\n";
    const parsed = new Map<string, string>();
    for (const line of attrsWithoutWoff2.split("\n")) {
      const [glob, ...rest] = line.trim().split(/\s+/);
      for (const kv of rest) {
        const [k, v = ""] = kv.split("=");
        if (k === "filter") parsed.set(glob ?? "", v);
      }
    }
    expect(
      parsed.get("*.woff2"),
      "属性表里没有 *.woff2 ⇒ 上面那条断言应当红",
    ).toBe(undefined);
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
      "index 里这个字体不是 LFS 指针 —— 说明提交时过滤器没生效，8.6 MB 已经原字节进历史",
    ).not.toBeNull();
    const onDisk = statSync(
      fileURLToPath(new URL(`../${FONT_REL}`, import.meta.url)),
    );
    expect(
      Number(pointer?.[2]),
      "指针记的 size 与磁盘字节数不一致（拷贝过的文件与提交出去的不是同一份）",
    ).toBe(onDisk.size);
    // 下界同时钉两件事：这是一份**完整 CJK**（subet 过的会在 100 KB 量级），
    // 且没有退回未压缩的 TTF（同一份字形 23.9 MB，压缩后才 8.6 MB）。
    expect(
      onDisk.size,
      "一个完整 CJK weight 的 woff2 不该小于 4 MB",
    ).toBeGreaterThan(4_000_000);
    expect(
      onDisk.size,
      "字体比 woff2 的合理上限还大 —— 多半是又把未压缩的 TTF 换回来了",
    ).toBeLessThan(16_000_000);
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
    const src =
      /src:\s*url\("([^"]+\.(?:woff2|ttf))"\)\s*format\("([^"]+)"\)/.exec(
        source,
      );
    expect(
      src,
      "@font-face 的 src 不是 `url(<字体>.<ext>) format(<载体>)` 形态",
    ).not.toBeNull();
    const [, url, declaredFormat] = src ?? [];
    // 四者同名：扩展名 / format() / 磁盘文件 / LFS 属性。任何一处单独漂开都**不报错** ——
    // format() 写错时浏览器照嗅探照解码（它只是「要不要下载」的门），所以只有这里能拦。
    const carrier = FONT_CARRIERS.find((c) => url?.endsWith(c.ext));
    expect(
      carrier,
      `@font-face 指向 ${url}，那不是本仓库认的字体载体`,
    ).toBeTruthy();
    expect(
      declaredFormat,
      `url 的扩展名是 ${carrier?.ext}，format() 却写着 "${declaredFormat}" —— 错的那一端不会喊`,
    ).toBe(carrier?.format);
    expect(
      attrOf(carrier?.glob ?? "", "filter"),
      `${carrier?.glob} 走了 CSS 却没进 lfs —— 它会按原字节进 git 历史`,
    ).toBe("lfs");
    // url 是**站点根**路径（Next 把 public/ 挂在 /），磁盘上落在 public/ 下 ——
    // 两者差一层，直接拼 `..${url}` 会指到仓库根的 fonts/ 而判「文件不在」。
    expect(
      existsSync(
        fileURLToPath(
          new URL(`../${PUBLIC_REL_OF(url ?? "")}`, import.meta.url),
        ),
      ),
      `@font-face 指向 ${url}，但 public 下没有对应文件`,
    ).toBe(true);
  });

  it("只嵌 Bold 一档 ⇒ font-weight 必须是 700（调用点全是 700）", () => {
    const face = /@font-face\s*\{([^}]*)\}/.exec(css())?.[1] ?? "";
    expect(face).toMatch(/font-weight:\s*700/);
    expect(
      /public\/fonts\/[^"]*-SemiBold/.test(css()),
      "没有 600 档调用点，多嵌一档就是白搬一份 8.6 MB 字面进安装包",
    ).toBe(false);
  });
});
