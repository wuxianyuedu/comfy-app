/**
 * 依赖面（the dependency face）—— **一份**关于「哪些输入决定 `node_modules` 长什么样」的声明。
 *
 * 单独成模块是为了断掉一条环：`ci-install-deps.mjs`（要不要装）与
 * `ci-slot-apply.mjs`（装到哪儿、能不能复用槽）判的是**同一份输入**，而这一份此前住在
 * 前者里。让后者 import 前者、前者又 import 后者，就成一个每一次构建都要过的脚本上的
 * ESM 循环依赖 —— 那种东西不会当场报错，它报错的形态是将来有人在这两个文件之一加了
 * 一行顶层求值。所以这份声明抽到这个叶子上，两边单向依赖它。
 *
 * 抽的只是**数据与它的摘要**，判定逻辑（`decideInstall` / `planSlot`）留在各自文件里：
 * 它们回答的是两个不同的问题（「装不装」与「接谁」），合并成一个才是错的。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** 依赖面：碰了任一项就必须真装（判据口径见 `ci-install-deps.mjs` 头注「判据」那一段）。 */
export const DEP_FILES = [
  "pnpm-lock.yaml",
  "package.json",
  "pnpm-workspace.yaml",
  "next.config.js",
];

/**
 * 「这一套依赖是照这一次装出来的」—— 装之前算出的指纹落盘处。
 *
 * 归 `node_modules/`：它描述的就是那份产物，`node_modules` 被清掉时它一起消失
 * （于是「没有证据」与「产物不在」是同一件事），也不必往 .gitignore 里加一行。
 */
export const FINGERPRINT_FILE = "node_modules/.ci-deps-fingerprint";

/**
 * `patches/` 的摘要（文件名 + 内容）。目录不在时回一句固定的话（**不是**空串：
 * 「没有补丁」也是一种状态，它要与「读不到目录」区分开）。
 *
 * @param {string} root 仓库根
 * @returns {string}
 */
export function readPatchesDigest(root) {
  const dir = path.join(root, "patches");
  let names;
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return "patches:absent";
  }
  const hash = crypto.createHash("sha256");
  for (const name of names) {
    hash.update(name);
    try {
      hash.update(fs.readFileSync(path.join(dir, name)));
    } catch {
      return "patches:unreadable";
    }
  }
  return `patches:${hash.digest("hex")}`;
}

/**
 * 依赖面的**内容**指纹：锁文件 + 三份配置 + 补丁目录。
 *
 * 为什么不直接复用 `DEP_FILES` 的 mtime / 存在性：全新 clone 上它们全都「存在且
 * 是刚写的」，那种判据在那里恒真。这里要的是「装的那一次」与「现在」同一份输入。
 *
 * 补丁目录单独成一项（而不是遍历进文件清单）：`patches/` 里换一个文件，
 * `pnpm install` 的产物就不同，而它不在 `DEP_FILES` 里（那是**变更清单**的判据，
 * 两份清单职责不同）。
 *
 * @param {string} root 仓库根
 * @returns {string | null} 算不出来（读不到锁文件 / 配置）时 null —— 调用方据此真装
 */
export function pnpmInstallFingerprint(root) {
  const hash = crypto.createHash("sha256");
  for (const file of DEP_FILES) {
    try {
      hash.update(file);
      hash.update(fs.readFileSync(path.join(root, file)));
    } catch {
      return null;
    }
  }
  hash.update(readPatchesDigest(root));
  return hash.digest("hex");
}
