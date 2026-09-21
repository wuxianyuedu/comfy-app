/**
 * splash-assets.mjs — 启动页副本的同步（**副本清单与同步动作只此一处**）
 *
 * 约定见 docs/standards/07-日志系统.md 的「三份副本」两条与硬规则 5。
 *
 * 背景：`public/splash.html` 是**源**；`src-tauri/splash-assets/` 是
 * `tauri.conf.json` 的 `build.frontendDist` 指向的目录，其内容在**编译期被嵌进
 * exe**（启动页由壳直接加载，不经 dev server）。该目录下要放**两个文件名**，
 * 缺一不可：
 *   · `splash.html` —— 窗口配置显式引用的那个（`windows[0].url`）；
 *   · `index.html`  —— 直接访问根路径时的兜底（缺了会渲染出旧版画面）。
 * 它们是**同一份内容的两个文件名**，由两种加载方式各取一个，不是两条要分别
 * 维护的内容 —— 所以「各自同步一遍」看起来天经地义，恰恰是漏掉一个的来源。
 *
 * 为什么要收成一处：这两个名字此前在四处各写了一遍（`src-tauri/build.rs` 的
 * 编译期同步、`scripts/dev-launcher.mjs`、`scripts/build-desktop.mjs`、
 * `tools/scripts/build-tauri-release.ps1`），而 `dev-launcher.mjs` 那份
 * **只同步了 `splash.html`**。漏一个名字是**静默**的：入库的 `index.html` 长期
 * 停在旧版 → 任何一次 `cargo build`（`build.rs` 会把两份都刷新）之后，工作区里
 * 就多出一个「被修改」的**入库**文件，`tests/check-file-structure.test.ts` 的
 * 「三份启动页副本一致」当场变红。修法因此不是「在漏的那处补一行」——
 * 那只是把同一个失误推到下一次新增加载方式时 —— 而是让「副本有哪几份」
 * 只有一个定义、同步动作只有一个实现。
 */
import fs from "node:fs";
import path from "node:path";

/** 启动页的源文件（仓库根相对）。 */
export const SPLASH_SOURCE_REL = "public/splash.html";

/** 副本目录（仓库根相对）：`tauri.conf.json` 的 frontendDist。 */
export const SPLASH_ASSETS_DIR_REL = "src-tauri/splash-assets";

/** 副本文件名 —— **两个都要**（显式 URL 引用的 + 根路径兜底）。 */
export const SPLASH_ASSET_NAMES = ["splash.html", "index.html"];

/** 源文件绝对路径。 */
/** @param {string} root @returns {string} */
export function splashSourcePath(root) {
  return path.join(root, SPLASH_SOURCE_REL);
}

/** 副本目录绝对路径。 */
/** @param {string} root @returns {string} */
export function splashAssetsDir(root) {
  return path.join(root, SPLASH_ASSETS_DIR_REL);
}

/** 错误对象 → 可读文案（调用方只拿来记日志）。 */
/** @param {unknown} error @returns {string} */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 把 `public/splash.html` 同步成副本目录下的**全部**副本。
 *
 * 判据与 `src-tauri/build.rs` 的同名步骤一致：**内容相同就不写盘**。这不是省事 ——
 * 写盘会推进 mtime，而 `dev-launcher.mjs` 的壳时效判据（`shellStaleWarning`）比的
 * 正是该目录下的最新 mtime：每次启动都无脑刷一遍，就会让「正在运行旧版桌面壳」
 * 的提醒**每次都报**，真正的源码改动反而被这层噪声盖掉。
 *
 * 不抛异常：它在启动链路上，同步失败应当由调用方记 WARN 后继续启动，而不是把
 * 用户挡在门外（`build.rs` 在下次编译时还会再同步一遍）。
 *
 * @param {string} root 检出根
 * @returns {{
 *   status: "ok" | "unchanged" | "missing-source" | "error",
 *   dir: string,
 *   names: string[],
 *   written: string[],
 *   message: string | null,
 * }}
 */
export function syncSplashAssets(root) {
  const dir = splashAssetsDir(root);
  /** 恒定的那几项：状态与 written 由下面各分支补齐。 */
  const base = {
    dir,
    names: [...SPLASH_ASSET_NAMES],
    written: /** @type {string[]} */ ([]),
    message: null,
  };

  /** @type {Buffer} */
  let content;
  try {
    content = fs.readFileSync(splashSourcePath(root));
  } catch (error) {
    return { ...base, status: "missing-source", message: messageOf(error) };
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    return { ...base, status: "error", message: messageOf(error) };
  }

  const written = [];
  for (const name of SPLASH_ASSET_NAMES) {
    const target = path.join(dir, name);
    try {
      // 逐字节比对（含换行符）：模板里少一个换行也算「内容变了」，与 build.rs 一致。
      if (fs.existsSync(target) && fs.readFileSync(target).equals(content)) {
        continue;
      }
      fs.writeFileSync(target, content);
      written.push(name);
    } catch (error) {
      return { ...base, status: "error", written, message: messageOf(error) };
    }
  }

  return {
    ...base,
    status: written.length > 0 ? "ok" : "unchanged",
    written,
  };
}
