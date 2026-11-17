// 「曾直接写进 src/** 的存量项目默认」→ 本机运行时目录的一次性搬迁（ISSUE #4150）。
//
// 背景：三族「项目默认」（侧栏页签 / 工坊模式契约 / 尺寸配置表）的 defaults JSON
// 既是**编译进包的默认值**（静态 import 的编译源），又被「保存为项目默认」当成
// 运行时可写存储 —— 两个职责挤在同一份被 git 跟踪的 src 文件里。运行期写 src 的
// 代价：工作树常挂 M（有被顺手提交进库的风险）+ dev 下每次写 src 都触发 Turbopack
// 模块图失效（服务端模块的内存态随旧实例变孤儿，#4140 / #4146）。
//
// #4150 起「保存为项目默认」改写**本机运行时落点**（各族自己的 `data/` 文件），
// src 那份只剩编译期默认值、运行期不再写它。本模块只做一件事：把**遗留**写进
// src 的用户态搬去新落点 ——
//
//   · 迁移判据：runtime 文件不存在 && src 文件在 && 内容 ≠ 编译快照
//     （canonical JSON 比较）。内容与快照一致 = 那份文件就是编译源本体、
//     没有用户态 → **不迁移**（runtime 保持缺省回落，本机不钉住任何东西 ——
//     否则一次搬迁会把基线钉在搬迁那一刻，后续提交的默认改动全被旧副本遮住）；
//   · 迁移只写 runtime 落点，**不回头改 src 文件**：运行期进程不做源码手术
//     （那正是本单要拔掉的根），遗留的工作树 M 由人 `git checkout -- <文件>`
//     收掉；
//   · 失败（读不到 / 写不进）按「没迁移」处理并返回 false —— 读侧照常回落
//     编译快照，行为与迁移前完全一致（best-effort，不该把读取链路打成 500）；
//   · 调用方（三族各自的 load）在 runtime 文件存在后天然不再进本判据，
//     无需额外的「只跑一次」标记。
import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

/** 原子写（tmp + rename，ISSUE #3859 同口径）：读侧不会撞到半截 JSON。 */
async function atomicWriteText(file: string, text: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, text, "utf8");
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** 两份 JSON 的**语义**相等判定：双方各自 parse → 稳定序列化后比较。
 *  直接比原文会把「同内容、不同排版」（手改 / 旧版序列化器）误判成用户态。 */
function canonicalEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 遗留 src 默认文件的存量搬迁。
 *
 * @param {object} options
 * @param {string} options.srcFile 遗留落点（src/** 下的被跟踪 JSON）的绝对路径
 * @param {string} options.runtimeFile 本机运行时落点（data/ 下）的绝对路径
 * @param {unknown} options.snapshot 编译进包的那份默认值（结构化对象，非字符串）
 * @returns {Promise<boolean>} true = 完成了搬迁（runtime 文件此轮由本函数写出）
 */
export async function migrateLegacyDefaultsFile(options: {
  runtimeFile: string;
  snapshot: unknown;
  srcFile: string;
}): Promise<boolean> {
  const { srcFile, runtimeFile, snapshot } = options;
  try {
    if (
      await fs.access(runtimeFile).then(
        () => true,
        () => false,
      )
    ) {
      return false; // 新落点已有内容：它才是生效基线，不做任何事
    }
    const raw = await fs.readFile(srcFile, "utf8");
    const legacy = JSON.parse(raw) as unknown;
    if (canonicalEqual(legacy, snapshot)) {
      return false; // 与编译快照一致 = 那就是编译源本体，没有用户态可搬
    }
    await fs.mkdir(path.dirname(runtimeFile), { recursive: true });
    await atomicWriteText(runtimeFile, `${JSON.stringify(legacy, null, 2)}\n`);
    return true;
  } catch {
    return false; // 读不到 / 解析失败 / 写不进：按「没迁移」处理，读侧回落快照
  }
}
