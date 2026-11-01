#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：版本号三处同步（供 .githooks/pre-commit 的 D 组调用）
/**
 * 三处版本号同步守卫 —— 规范见 docs/standards/launch-and-build.md §7。
 *
 * ── 立案现场（ISSUE #1611 阶段三 D7）────────────────────────────────
 *
 * 同一个「产品版本号」被手抄在三个文件里，而**没有任何一处判据认识它**：
 *
 *   · `package.json` 的 `version`（npm 生态读它）
 *   · `src-tauri/tauri.conf.json` 的 `version`（决定安装包 / 更新的版本）
 *   · `src-tauri/Cargo.toml` 的 `[package] version`（壳二进制的版本）
 *
 * 三处都是 `0.1.0`，且没有同步守卫 —— 这不只是「改名要去三个地方改」的麻烦，
 * 而是**打包链上一条静默的错位**：
 *
 *   ① `tauri.conf.json` 的版本被**编译期内嵌**进壳可执行文件，也是
 *      `tauri-plugin-updater` 判「更新新旧」的基准。只升 `package.json` 时，
 *      安装包与更新判定还停在旧版本 ⇒ 用户看到「检查更新：已是最新」，而
 *      实际发布的已经是新构建；
 *   ② 三处**现在恰好相等**，所以这个错位今天还看不出来 —— 而第一次忘记升某处
 *      的那一刻起，错位就永久静默（没有任何东西会红）。
 *
 * 这也是 P0-4（Sentry release / source map 关联）刻意**不取** `package.json`
 * `version` 当 release 的原因 —— release 取 git sha；拿一个「三处手工重复、
 * 无同步守卫」的数当发布标识，会在第一次忘记升版本时把两次发布并成一条。
 * 本判据把那个前提补上：三处要么一起动，要么谁都不动。
 *
 * ── 判什么（只判「三处相等」，不判「该不该升」）──────────────────────
 *
 *   · 三处都能读到版本号（读不出 = 文件被改名 / 结构被改，判失败）；
 *   · 三处**逐字相等**（不做语义化版本比较 —— 那是第二套版本语义，本判据管的是
 *     「同一个数只许有一份」）；
 *   · 形态是 `MAJOR.MINOR.PATCH`（可带 `-pre` / `+build` 后缀）。
 *
 * **刻意不判的**：版本号是不是比上一次大、该不该发版、changelog 里有没有对应条目 ——
 * 那些是发布判断，不是「单一事实」判据（§12.18：不为「该不该升」再写一个启发式扫描器）。
 *
 * ── 为什么不合成一份来源 ────────────────────────────────────────────
 *
 * 三个文件都得各写各的版本号：`package.json` 由 npm / pnpm 读，
 * `tauri.conf.json` 由 tauri-build **在编译期**读（生成不了 `include!` 之类的东西），
 * `Cargo.toml` 由 cargo 读。让其中一个去 `import` 另一个，是在三个工具各自的
 * 清单格式里塞第四个语言 —— 收益是省一次改三处，代价是每次升级都要赌那个语法还支持。
 * 所以本仓库的取向是**守住相等**（判据在场、机器每次提交判一次），而不是造第二份来源。
 *
 * 用法：
 *   node scripts/check-app-version.cjs           # 检查（pre-commit / 按需召唤）
 *   node scripts/check-app-version.cjs --report   # 只打印三处读数，不判失败
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const REPORT_ONLY = process.argv.includes("--report");

/** 版本号的形态：`MAJOR.MINOR.PATCH`（允许 `-pre` / `+build` 后缀）。 */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * 三处的**唯一出处**：`package.json` / `tauri.conf.json` / `Cargo.toml`。
 *
 * 每一处给一条提取规则（不是「从某个文件里 grep 一个数字」——那样会把注释 /
 * 依赖行里的同形数字也读进来）。提取不出即判失败：文件被改名、字段被挪进
 * `[workspace.package]`、或 JSON 结构变了，都必须有人知道，而不是静默放行。
 */
const SOURCES = [
  {
    label: "package.json 的 version",
    file: "package.json",
    extract: (text) => {
      const m = /^\s*"version"\s*:\s*"([^"]*)"/m.exec(text);
      return m ? m[1] : null;
    },
  },
  {
    label: "src-tauri/tauri.conf.json 的 version",
    file: "src-tauri/tauri.conf.json",
    extract: (text) => {
      const m = /^\s*"version"\s*:\s*"([^"]*)"/m.exec(text);
      return m ? m[1] : null;
    },
  },
  {
    label: "src-tauri/Cargo.toml 的 [package] version",
    file: "src-tauri/Cargo.toml",
    extract: (text) => {
      /* 只认 **`[package]` 段内**的那一行 —— `Cargo.toml` 后面还有
       * `[dependencies]`，而依赖行也可能是 `version = "…"`（`[dependencies.foo]`
       * 形态），裸 grep 会把依赖版本读成产品版本。实测形态：`tauri-build = { version
       * = "2", … }` 是内联表（不命中 `^version`），但 `[dependencies.x]` 的
       * 独立行会命中 —— 所以这里按段切。 */
      let inPackage = false;
      for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (/^\[.*\]$/.test(line)) {
          inPackage = line === "[package]";
          continue;
        }
        if (!inPackage) {
          continue;
        }
        const m = /^version\s*=\s*"([^"]*)"/.exec(line);
        if (m) {
          return m[1];
        }
      }
      return null;
    },
  },
];

function readVersion(src) {
  let text;
  try {
    text = fs.readFileSync(path.join(ROOT, src.file), "utf8");
  } catch (error) {
    return { error: `读不到 ${src.file}（${error.code ?? error.message}）` };
  }
  const value = src.extract(text);
  if (value == null) {
    return { error: `${src.file} 里提取不出 ${src.label} —— 字段被改名 / 挪位了？` };
  }
  return { value };
}

function main() {
  const problems = [];
  /** @type {Array<{label: string, value: string}>} */
  const reads = [];
  for (const src of SOURCES) {
    const r = readVersion(src);
    if (r.error) {
      problems.push(r.error);
    } else {
      reads.push({ label: src.label, value: r.value });
    }
  }

  /* 形态检查与相等检查分开报：形态不对时「三处相等」是一条没有意义的话
   * （三处都写成 `0.1` 也会相等），分开报才指得出该改哪儿。 */
  for (const r of reads) {
    if (!SEMVER_RE.test(r.value)) {
      problems.push(`${r.label} 不是 MAJOR.MINOR.PATCH 形态：${JSON.stringify(r.value)}`);
    }
  }

  if (reads.length === SOURCES.length) {
    const [first, ...rest] = reads;
    for (const r of rest) {
      if (r.value !== first.value) {
        problems.push(
          `版本号三处不一致：${first.label} = ${first.value}，而 ${r.label} = ${r.value}`,
        );
      }
    }
  }

  if (REPORT_ONLY) {
    for (const r of reads) {
      process.stdout.write(`  ${r.label}：${r.value}\n`);
    }
    if (problems.length) {
      process.stdout.write(`  （另有 ${problems.length} 处读不出/形态异常）\n`);
    }
    return 0;
  }

  if (problems.length) {
    process.stderr.write(
      `[app-version] ✗ 版本号三处必须同步（ISSUE #1611 阶段三 D7）：\n      · ${
        problems.join("\n      · ")
        }\n        ${SOURCES.map((s) => s.file).join(" / ")} 三处都写、且逐字相等。` +
        `\n        为什么不是「改一处就够」：tauri.conf.json 的版本在**编译期**内嵌进壳，` +
        `\n        也是 tauri-plugin-updater 判「更新新旧」的基准 —— 只升 package.json 时，` +
        `\n        安装包与更新判定还停在旧版本，用户会看到「已是最新」。` +
        `\n        规范：docs/standards/launch-and-build.md §7.1.1\n`,
    );
    return 1;
  }

  process.stdout.write(
    `  [ok] 版本号三处同步：${reads[0].value}（${reads.map((r) => r.label).join(" / ")}）\n`,
  );
  return 0;
}

process.exit(main());
