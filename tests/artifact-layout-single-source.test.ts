/**
 * 「产物布局只有一处定义」判据（台账 A8 的第二段，#12 的前置）。
 *
 * 一句话：`src/` 里不许再出现第二处「产物根 / 产物地址 / 地址→磁盘」的写法，
 * 全仓唯一出处是 `src/lib/media/output-paths.ts`。命中即红。
 *
 * 为什么这条判据值得存在（不是风格洁癖）：同一份布局此前有 **7 份实现**，
 * 其中两份**对同一个输入结论相反** ——
 *  · `compose-steps.ts` 把执行器写进库的 `/api/generated/…` 解析成
 *    `<cwd>/public/api/generated/…`（不剥 `api/` 段），那个目录不存在，
 *    「合成成片」对每一条镜头必败；而 `firstframe.ts` 那一份剥了，所以首帧一直是好的。
 *    同一句错在 `task.delete` 里也出现过一次（A8 当年修的就是那一处），
 *    **第二次实现活了下来** —— 这正是「复制实现」的代价：修一处不等于修完。
 *  · `media-source.server.ts` 的越界判据少了 `path.sep` 边界，同级 `generatedX`
 *    会被算作根内。
 *  · `scripts/comfyapp-open-folder.ps1` 还有一份**用另一种语言写的**允许根，
 *    在任何 TS 检索面之外 —— 搬根那天它不会跟着动，`comfyapp://open` 就会
 *    指着空目录 refuse 掉一切（下面第 3 条成对判据专门钉这一处）。
 *
 * 已知边界（说清比假装没有好）：**给人看的散文**不在这条判据的扫描面里 ——
 * `ProjectOutputs.tsx` / `ProjectOutputsMetadataSheet.tsx` / `MaterialLibraryPanel.tsx`
 * 三处 UI 文案写着 `public/generated/…`。它们不是路径构造、改了不影响行为，
 * 但「把产物根搬出 public/」（台账 A13 残留、任务 #12）那天必须一起改文案，
 * 已经写进那条目的清单里。判据不去断言文案，是为了不把「精确」换成「误报一片」。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";
import { generatedRoot } from "~/lib/media/output-paths";

const ROOT_OF_TRUTH = "src/lib/media/output-paths.ts";

/** 被禁的写法。每条都带「它在别的文件里长什么样」的实例，见反证用例。 */
const FORBIDDEN: readonly { name: string; pattern: RegExp }[] = [
  {
    // path.join(cwd, "public", "generated", …) —— 七份副本的共同形状
    name: "把 public 与 generated 拼成产物根",
    pattern: /["']public["']\s*,\s*["']generated["']/,
  },
  {
    // 同义的整段字面量写法："public/generated" / "public/generated/x" / "public\\generated"
    // 只认引号紧贴在 public 前的那种（UI 里给人看的散文「素材保存在 public/generated…」
    // 不算代码路径构造 —— 它们的处置记在台账 #12，理由见文件头）
    name: "把 public/generated 当字面量路径",
    pattern: /["']public[\\/]+generated([\\/]|["'])/,
  },
  {
    // 自己抄一遍地址前缀（`taskOutputUrl` / `artifactUrl` 之外不许有第二份）
    name: "手写 /api/generated 地址",
    pattern: /[`"']\/api\/generated\//,
  },
  {
    // 第二份「地址 → 磁盘」解析：`(?:api\/)?generated` 这类自己写的形状
    name: "自己解析产物地址",
    pattern: /\(\?:api\\/,
  },
  {
    name: "自己剥 /api/ 前缀来还原磁盘路径",
    pattern: /\.replace\(\/\^\\\/api\\\//,
  },
];

function collectSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "generated")
      continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectSource(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      out.push(full);
  }
  return out;
}

/** 扫描一段源码（先剥注释：判据针对代码，注释里正当会出现被禁的叙述本身）。 */
function offendersOf(text: string): string[] {
  const stripped = stripComments(text);
  return FORBIDDEN.filter(({ pattern }) => pattern.test(stripped)).map(
    ({ name }) => name,
  );
}

/** 从 `.ps1` 的 `$allowedRoot = …` 语句里抠出允许根的**各段**字面量。
 *
 * 取到「紧跟其后的第一条以 `$` 开头的顶层行」为止，因此对单行 / 多行两种写法都成立
 * （不能按固定的 `Join-Path` 嵌套形状取：那是把写法当契约，改一次排版判据就静默返回空）。
 * 找不到赋值语句返回 `null` —— 由调用点判「落空」，不能让它悄悄变成「零段 = 不用比」。 */
function allowedRootSegments(ps1: string): string[] | null {
  const start = ps1.search(/\$allowedRoot\s*=/);
  if (start < 0) return null;
  const rest = ps1.slice(start);
  const ends = rest.search(/\n\s*\$/);
  const statement = ends < 0 ? rest : rest.slice(0, ends);
  return [...statement.matchAll(/"([^"]*)"/g)]
    .map((m) => m[1]!)
    .filter((segment) => segment.length > 0);
}

describe("产物布局单一出处（台账 A8 第二段）", () => {
  const files = collectSource(path.join(process.cwd(), "src")).map((f) => ({
    rel: path.relative(process.cwd(), f).replace(/\\/g, "/"),
    text: readFileSync(f, "utf8"),
  }));
  const scanned = files.filter((f) => f.rel !== ROOT_OF_TRUTH);

  it("扫描面本身非空（空输入上「零违规」长得就像「收口了」）", () => {
    expect(scanned.length).toBeGreaterThan(150);
    // 唯一出处必须真的在扫描面里 —— 它被改名/删掉时这条判据会跟着失效，那不行
    expect(files.some((f) => f.rel === ROOT_OF_TRUTH)).toBe(true);
  });

  it("src 里没有第二处产物根 / 产物地址 / 地址解析", () => {
    const hits = scanned.flatMap(({ rel, text }) =>
      offendersOf(text).map((name) => `${rel} —— ${name}`),
    );
    expect(hits).toEqual([]);
  });

  it("判据自身可反证：五种被禁写法都被照出来，收口后的写法都不被照", () => {
    /* 形状取自本批真删掉的那七份副本 —— 每种各造一个实例，凑不齐五条就说明
     * 有条判据命中不了任何真实形状（那是装饰，不是判据）。 */
    const fixtures: readonly { body: string; expect: string }[] = [
      {
        body: `const dir = path.join(cwd, "public", "generated", "films");`,
        expect: "把 public 与 generated 拼成产物根",
      },
      {
        body: `const rel = "public/generated/x";`,
        expect: "把 public/generated 当字面量路径",
      },
      {
        body: "const localPath = `/api/generated/films/${id}.mp4`;",
        expect: "手写 /api/generated 地址",
      },
      {
        body: String.raw`const m = /^\/(?:api\/)?generated\/(.+)$/.exec(src);`,
        expect: "自己解析产物地址",
      },
      {
        body: String.raw`const abs = path.join(root, localPath.replace(/^\/api\//, ""));`,
        expect: "自己剥 /api/ 前缀来还原磁盘路径",
      },
    ];
    for (const { body, expect: name } of fixtures) {
      expect(offendersOf(body), `「${name}」没能照出自己的实例`).toContain(
        name,
      );
    }
    // 每条判据都得有一次命中（命中不了的判据 = 写着好看、什么都不挡）
    const fired = new Set(fixtures.map((f) => f.expect));
    expect(fired.size).toBe(FORBIDDEN.length);

    // 剥注释这一腿真的在起作用：同一段文本，未剥时会被照、剥完不算命中。
    // 少了这一腿，「注释里叙述被禁形状」就会红在一行文档上（各处门禁共用
    // `stripComments` 的理由见 tests/strip-comments-single-source.test.ts）。
    const onlyInComment = `// 以前这里是 path.join(cwd, "public", "generated")
      const dir = filmsRoot();`;
    expect(offendersOf(onlyInComment)).toEqual([]);
    expect(
      FORBIDDEN.some(({ pattern }) =>
        pattern.test(onlyInComment.split("\n")[0]!),
      ),
    ).toBe(true);

    // 收口后的两种写法都不该被照：从唯一出处取根、走 artifactUrl 拼地址
    expect(
      offendersOf(`import { filmsRoot, artifactUrl } from "~/lib/media/output-paths";
         const dir = filmsRoot();
         const url = artifactUrl(["films", name]);`),
    ).toEqual([]);
  });

  it("comfyapp:// 的 PowerShell 允许根与 TS 的产物根同形（跨语言成对判据）", () => {
    const scriptsDir = path.join(process.cwd(), "scripts");
    const ps1 = readFileSync(
      path.join(scriptsDir, "comfyapp-open-folder.ps1"),
      "utf8",
    );
    /* 抠的是 `Join-Path` 的**各段**，不是一条拼好的相对路径。
     *
     * 为什么判据长这样（ISSUE #1348 的形态在前一版里是错的）：`.ps1` 原先写
     * `Join-Path $PSScriptRoot "..\generated"` —— 一条**带平台分隔符**的字面量。
     * 判据得把它解析成绝对路径才能和 `generatedRoot()` 比，而 `path.resolve` 只在
     * Windows 上把 `\` 当分隔符：POSIX 上整串被当成一个文件名，
     * 得到 `<repo>/scripts/..\generated`，与 `<repo>/generated` 永不相等 ——
     * **Linux / CI 上恒红**。当时的补法是「解析前把 `\` 全换成 `/`」，
     * 那是在**猜写这个字符串的机器是哪一端的**，判据与平台绑定这件事没被解决，
     * 只是被藏进了 `replace`。真正的修法是让那段字面量不再带分隔符：
     * 各段分开写，`Join-Path` 用宿主自己的分隔符拼，判据也按段解析。 */
    const segments = allowedRootSegments(ps1);
    // 非空自证：那条允许根被删掉/改写时这里必须红，而不是「没找到 = 不用比」
    expect(
      segments,
      "ps1 里找不到 comfyapp:// 的允许根赋值，成对判据落空",
    ).not.toBeNull();
    expect(
      segments!.length,
      "ps1 的允许根里抠不出任何路径段，成对判据落空",
    ).toBeGreaterThan(0);
    /* 各段必须是**不带分隔符**的单个名字 —— 这才是这条判据的判据本身：
     * 谁再把 `..\generated` 那种拼好的字面量写回去（在任一平台上它都只对
     * 一端有意义），这里当场红，而不是等 CI 上再红一次。 */
    for (const seg of segments!) {
      expect(
        seg,
        `ps1 的允许根段 "${seg}" 带了分隔符 —— 应拆成各段，让 Join-Path 用宿主分隔符拼`,
      ).not.toMatch(/[\\/]/);
    }
    /* 比的是**解析后的绝对路径**，不是「段数」：写成 `.. / .. / generated`
     * 那种偏移一位的错法，段数一样，只有按 $PSScriptRoot 真解析一次才露出来。 */
    const resolved = path.resolve(scriptsDir, ...segments!);
    expect(resolved).toBe(generatedRoot(path.resolve(scriptsDir, "..")));
  });

  it("成对判据自身可反证：旧的「拼好的 Windows 字面量」写法会被照出来", () => {
    /* 判据的**判据本身**：它必须真的能拦住那条非跨平台的写法，否则这次改的
     * 就只是「换了一种也让判据绿」的写法，下一次还会长回来。
     * 三条形状各对应一种真实错法（都是这条判据历史上见过或险些放过的）。 */
    const scriptsDir = path.join(process.cwd(), "scripts");
    const expected = generatedRoot(path.resolve(scriptsDir, ".."));

    /** 把一段 `.ps1` 片段按判据的方式判一次，返回它是否被照出来。 */
    const flagged = (ps1: string): boolean => {
      const segments = allowedRootSegments(ps1);
      if (segments === null || segments.length === 0) return true; // 抠不到 = 落空 = 红
      return segments.some((segment) => /[\\/]/.test(segment));
    };
    /** 按判据的方式解析出允许根（用于断言「偏移会解析到别处」）。 */
    const resolveOf = (ps1: string): string =>
      path.resolve(scriptsDir, ...allowedRootSegments(ps1)!);

    // ① 旧的写法：一条带分隔符的相对路径字面量 —— 正是 Linux 上恒红的那一版
    const windowsLiteral =
      '$allowedRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\\generated"))';
    expect(
      flagged(windowsLiteral),
      "旧的「..\\generated」字面量没能被照出来 —— 判据挡不住这条非跨平台写法",
    ).toBe(true);

    // ② 偏移一位：段都是干净的，只有真解析一次才露出来
    const offset =
      '$allowedRoot = (Join-Path (Join-Path $PSScriptRoot "..") "..")\n$sep = 1';
    expect(flagged(offset)).toBe(false);
    expect(
      resolveOf(offset),
      "偏移一位的允许根解析到了产物根 —— 那这条判据只比了写法、没比位置",
    ).not.toBe(expected);

    // ③ 收口后的写法：两种排版（多行 / 单行）都要被接受，解析结果都等于产物根
    for (const ok of [
      '$allowedRoot = [IO.Path]::GetFullPath(\n  (Join-Path (Join-Path $PSScriptRoot "..") "generated"))\n$sep = 1',
      '$allowedRoot = (Join-Path (Join-Path $PSScriptRoot "..") "generated")\n$sep = 1',
    ]) {
      expect(flagged(ok), `收口后的写法被误报：${ok}`).toBe(false);
      expect(resolveOf(ok)).toBe(expected);
    }
  });
});
