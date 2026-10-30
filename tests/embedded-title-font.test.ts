/**
 * 内嵌字体这条链的同步判据（LFS 接线 + 字体资产 + CSS 引用）。
 *
 * 为什么这条链必须有执行者：它每一环失效都**不报错**，而且是三种不同的静默形态：
 *   · 缺 `filter.lfs.*` ⇒ 字体按**原字节**进 git 历史，每份 8 MB 永久化，
 *     想摘掉只能重写共享远端的历史；
 *   · 缺 `.githooks/pre-push` ⇒ 提交里是 LFS 指针、对象却留在本机，别人克隆回来
 *     拿到一段 `version https://git-lfs.github.com/spec/v1` 文本，正文/标题静默回退；
 *   · `@font-face` 的 family 与 `--font-sans` / `--font-title` 的首选对不上 ⇒
 *     字体装了但没人用，字节白背着。
 * 三种都不红。所以按「接线类判据」的老规矩写：**解析，不要按字面量包含**
 *（`toContain` 拦得住删行、拦不住在同一行前面加 `# `）。
 *
 * ── 载体从 TTF 换成 woff2 之后，这条链多出来的两个静默形态 ──────────────
 *   · **`format()` 与文件真实载体对不上**：写成 `url(...woff2) format("truetype")`
 *     时 Chromium **不会拒绝**（它按嗅探出的载体解码，`format()` 只是「要不要下载」的
 *     门），于是浏览器里一切正常、判据也绿 —— 但 `format()` 是喂给**别的**解析器的
 *     （Safari 老版本 / 我们自己的 CSS 工具链），错的那一端不会喊。
 *     所以本文件判的是「扩展名 / `format()` / 磁盘文件 / LFS 属性」**四者同名**。
 *   · **`.gitattributes` 只认一种载体**：换载体时只改文件与 CSS、忘了加一行属性，
 *     LFS 过滤器就不接这条路径 —— 表现与上面第一种完全相同（原字节进历史），
 *     而「另一种载体有 lfs 过滤器」那条断言照样是绿的。所以属性断言**逐载体**核。
 *
 * ── 从「内嵌一个标题字面」扩到「内嵌三档字面」之后，多出来的一种静默失效 ──
 *   · 这一档（正文 / 等宽）**每一档都 8 MB 上下**，而它们的失效形态比标题那一档更隐蔽：
 *     标题掉回回退栈时字形宽度不同、肉眼可辨，正文掉回系统 CJK 则**看着完全正常**
 *     （那是它此前的常态），所以「字节白背着」这件事没有任何可见症状。
 *     判据因此从「一个文件名写死」改成**逐个内嵌字面**：`EMBEDDED_FACES` 里每一条
 *     都要过一遍「四者同名 + `--font-*` 首选 + 磁盘在位 + 权重与落点相符」，
 *     新增一档只许往那张表里加一行（加了两处不同步 = 红）。
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

/** 站点根路径 → 仓库路径（`/fonts/x.woff2` 落在 `public/fonts/x.woff2`）。 */
const PUBLIC_REL_OF = (sitePath: string) => `public${sitePath}`;
/** 文件载体 → CSS 里该写的扩展名与 `format()`，两者必须同一项。 */
const FONT_CARRIERS = /* SAFETY: 类型断言已复核 */ [
  { ext: ".woff2", format: "woff2", glob: "*.woff2" },
  { ext: ".ttf", format: "truetype", glob: "*.ttf" },
] as const;
const LICENSE_REL = "public/fonts/OFL-Sarasa-Gothic.txt";

/**
 * 每一档内嵌字面：`@font-face` 的 family、它服务的 `--font-*` 首选、磁盘文件名、
 * 权重、以及这一档**为什么必须内嵌**（谁在画它）。
 *
 * 加一档 = 加一行；改一档的载体 / 权重 = 改这一行。表外的东西判据一概不看，
 * 于是「新增了 `@font-face` 却没登记」与「登记了却没接线」两头都能拦
 *（前者的判据在下面 `@font-face` 的条数核对，后者的判据是每条的 family 必须
 * 真出现在某个 `--font-*` 的首选位上）。
 */
const EMBEDDED_FACES = /* SAFETY: 类型断言已复核 */ [
  {
    file: "public/fonts/SarasaGothicSC-Bold.woff2",
    family: "Sarasa Gothic SC",
    /** 服务哪个 `--font-*` 变量，以及**它必须排在第几位**才算生效。 */
    cssVar: "--font-title",
    weight: "700",
    why: "标题（`font-title` / `.u-title-*`，全部落点都是 700）",
  },
  {
    file: "public/fonts/SarasaUiSC-Regular.woff2",
    family: "Sarasa UI SC",
    cssVar: "--font-sans",
    weight: "400",
    why: "正文 CJK（`--font-sans` 的 CJK 段此前整段落回系统字体）",
  },
  {
    file: "public/fonts/SarasaMonoSC-Regular.woff2",
    family: "Sarasa Mono SC",
    cssVar: "--font-mono",
    weight: "400",
    why: "等宽 CJK（日志 / 路径 / 节点 id 里的中文此前落回系统 mono，常掉成比例字面）",
  },
] as const;

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
}

/** 取一个 sh 文件里**非注释**的命令行（用来判「这步到底还跑不跑」）。 */
function activeShellCommands(source: string): Array<string> {
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

/** 一条 `@font-face { … }` 块，按出现顺序。 */
function fontFaces(css: string): Array<string> {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
}

/** 某个 `--font-*` 变量的值里，第几个位置是 `family`（0 起算；找不到为 -1）。 */
function familyPosition(css: string, cssVar: string, family: string): number {
  const value = new RegExp(`${cssVar}:\\s*\\n?\\s*([^;]+);`).exec(css)?.[1];
  if (value === undefined) return -1;
  const names = [...value.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return names.indexOf(family);
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
    const calls = activeShellCommands(source).filter((l) => l.startsWith("git lfs pre-push"));
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
        /^\s*const lfs = git\(\["lfs", "install", "--local", "--manual"\]\);?$/.test(l.trim()),
      );
    expect(wired, "git lfs install --local --manual 没在 postinstall 里被调用").toBe(true);
    // 反向：钩子安装必须被 --manual 挡掉，否则它会往 .githooks/ 里写第二套
    expect(source).toContain("--manual");
  });

  it("反向对照：把钩子那行注释掉，判据要红", () => {
    const muted = '# git lfs pre-push "$@"\n';
    expect(
      activeShellCommands(muted).filter((l) => l.startsWith("git lfs pre-push")).length,
      "注释行仍含同一段字面量 —— 在场判据不能按字面量包含",
    ).toBe(0);
  });

  it("反向对照：换载体时只改文件不加上面的属性 ⇒ 上面那条必须红", () => {
    // 真实形态就是「在 .gitattributes 里加一行时顺手抄了另一行，
    // 后来换载体只改了文件与 CSS」—— 属性表里于是没有这一条。
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
    expect(parsed.get("*.woff2"), "属性表里没有 *.woff2 ⇒ 上面那条断言应当红").toBe(undefined);
  });
});

describe("每一份内嵌字面本身", () => {
  it("逐个内嵌字面：index 里存的是 LFS 指针，且指针的 size 与工作树字节数一致", () => {
    for (const { file, why } of EMBEDDED_FACES) {
      const blob = indexBlob(file);
      const pointer =
        /^version https:\/\/git-lfs\.github\.com\/spec\/v1\s+oid sha256:([0-9a-f]{64})\s+size (\d+)$/m.exec(
          blob,
        );
      expect(
        pointer,
        `${file}（${why}）在 index 里不是 LFS 指针 —— 说明提交时过滤器没生效，` +
          "整份字体已经按原字节进历史",
      ).not.toBeNull();
      const onDisk = statSync(fileURLToPath(new URL(`../${file}`, import.meta.url)));
      expect(
        Number(pointer?.[2]),
        `${file} 指针记的 size 与磁盘字节数不一致（拷贝过的文件与提交出去的不是同一份）`,
      ).toBe(onDisk.size);
      // 下界同时钉两件事：这是一份**完整 CJK**（subset 过的会在 1 MB 量级），
      // 且没有退回未压缩的 TTF（同一份字形 24 MB，压缩后才 8 MB）。
      expect(
        onDisk.size,
        `${file} 比一个完整 CJK weight 的 woff2 小得多 —— ` +
          "多半是被 subset 过（那会把生僻字悄悄扔回系统字体，正是这条链要防的）",
      ).toBeGreaterThan(4_000_000);
      expect(
        onDisk.size,
        `${file} 比 woff2 的合理上限还大 —— 多半是又把未压缩的 TTF 换回来了`,
      ).toBeLessThan(16_000_000);
    }
  });

  it("OFL 许可全文随字体一起放（再分发时这是条件，不是礼节）", () => {
    expect(existsSync(fileURLToPath(new URL(`../${LICENSE_REL}`, import.meta.url)))).toBe(true);
    const license = read(LICENSE_REL);
    // 按这份 LICENSE 的**实际**措辞断言（`SIL Open Font License v1.1` 那一行），
    // 不是按记忆里「全大写标题」的形态 —— 后者在这份文本里根本不存在。
    expect(license).toMatch(/This Font Software is licensed under the SIL Open Font License/);
    expect(license).toMatch(/SIL Open Font License v1\.1/);
    expect(license).toMatch(/Copyright \(c\)/);
  });
});

describe("@font-face 与 --font-* 必须指向同一个名字", () => {
  const css = () => read("src/app/globals.css");

  it("每一个 @font-face 都登记在 EMBEDDED_FACES 里，且没有登记了却没写的", () => {
    const declared = [...css().matchAll(/@font-face\s*\{[^}]*font-family:\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );
    // 两头都判：写了没登记（8 MB 白背而没人管）与登记了没写（CSS 指向空气）
    // 都是静默形态，而任何一个方向的单边断言都拦不住另一边。
    expect(
      [...declared].sort(),
      "globals.css 的 @font-face 集合与 EMBEDDED_FACES 对不上 —— " +
        "新增一档内嵌字面必须往那张表里加一行（并同批接线）",
    ).toEqual(EMBEDDED_FACES.map((f) => f.family).sort());
  });

  it("逐个内嵌字面：url / format / 磁盘文件 / LFS 属性四者同名，且权重与落点相符", () => {
    const source = css();
    const faces = fontFaces(source);
    for (const face of EMBEDDED_FACES) {
      const block = faces.find((b) => new RegExp(`font-family:\\s*"${face.family}"`).test(b));
      expect(block, `没有 ${face.family} 的 @font-face`).toBeTruthy();
      const src = /src:\s*url\("([^"]+\.(?:woff2|ttf))"\)\s*format\("([^"]+)"\)/.exec(block ?? "");
      expect(
        src,
        `${face.family} 的 src 不是 \`url(<字体>.<ext>) format(<载体>)\` 形态`,
      ).not.toBeNull();
      const [, url, declaredFormat] = src ?? [];
      // 四者同名：扩展名 / format() / 磁盘文件 / LFS 属性。任何一处单独漂开都
      // **不报错** —— format() 写错时浏览器照嗅探照解码（它只是「要不要下载」的门），
      // 所以只有这里能拦。
      const carrier = FONT_CARRIERS.find((c) => url?.endsWith(c.ext));
      expect(carrier, `${face.family} 指向 ${url}，那不是本仓库认的字体载体`).toBeTruthy();
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
      const onDisk = PUBLIC_REL_OF(url ?? "");
      expect(
        existsSync(fileURLToPath(new URL(`../${onDisk}`, import.meta.url))),
        `@font-face 指向 ${url}，但 public 下没有对应文件`,
      ).toBe(true);
      expect(
        onDisk,
        `${face.family} 的 @font-face 指向 ${url}，登记的却是 ${face.file} —— ` +
          "换载体 / 换文件名时必须同批改这里",
      ).toBe(face.file);
      // 权重：Bold 档只嵌 700、正文与等宽只嵌 400。写错时浏览器会**合成**假粗体
      // （`font-synthesis` 默认开），看上去「有点糊」而不是「没用上」。
      expect(
        new RegExp(`font-weight:\\s*${face.weight}\\b`).test(block ?? ""),
        `${face.family} 的 font-weight 不是 ${face.weight}（${face.why}）`,
      ).toBe(true);
    }
  });

  it("逐个内嵌字面：family 出现在它该服务的那条栈的**首选位**上", () => {
    const source = css();
    for (const face of EMBEDDED_FACES) {
      // 只判「在不在栈里」不够：`--font-sans` 里 CJK 名排在 `var(--font-geist-sans)`
      // 之后是对的（拉丁走 Geist），而排在**任何一个别的 CJK 名之后**就等于没接上
      // （前一个命中了就不会走到它）。所以逐档按自己的位置规则判。
      const pos = familyPosition(source, face.cssVar, face.family);
      expect(
        pos,
        `${face.cssVar} 的首选里没有 "${face.family}" —— 字体装了但没人用，` +
          `${face.why}这一档白背着`,
      ).toBeGreaterThanOrEqual(0);
      const cjkRivals = ["PingFang SC", "Microsoft YaHei", "Noto Sans SC"];
      const firstRival = cjkRivals
        .map((n) => familyPosition(source, face.cssVar, n))
        .filter((p) => p >= 0)
        .sort((a, b) => a - b)[0];
      if (firstRival !== undefined) {
        expect(
          pos,
          `${face.cssVar} 里 "${face.family}"（第 ${pos} 位）排在系统 CJK` +
            `（第 ${firstRival} 位）之后 —— 系统字体先命中，内嵌这份永远不会被用到`,
        ).toBeLessThan(firstRival);
      }
    }
  });
});
