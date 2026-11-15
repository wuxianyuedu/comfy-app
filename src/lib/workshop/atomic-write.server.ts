// ── 配置文件的**原子写**（tmp + rename）唯一实现 ─────────────────────────
// 此前这份八行在 `mode-contract.server.ts` 里是私有件（ISSUE #3859：并发写
// 配置时读侧撞到半截 JSON），模型适配的「保存为项目默认」（#3951）是第二个
// 用家 —— 按复用优先收到这里（§12.18），不再各写一份。
//
// 带 `server-only`：它只服务端用（浏览器侧没有这种落盘需求）。

import "server-only";

import { promises as fs } from "node:fs";
import process from "node:process";

/**
 * 把 `text` 原子写进 `file`：先写同目录临时件再 rename —— 读侧要么读到上一份
 * 完整内容、要么读到这一份，不会撞到写了一半的 JSON。失败时清掉临时件并把
 * 原错误抛回（调用方负责把「写到了哪个文件」带进可读的报错文案）。
 */
export async function atomicWriteText(file: string, text: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, text, "utf8");
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}
