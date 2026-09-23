// ── LLM 密钥落库加密 ─────────────────────────────────────────────
// 需求：API Key 不以明文写入本地 SQLite（db.sqlite / extraModels JSON）。
// 采用 AES-256-GCM 对称加密。密钥来自本机 data/ 目录下随机生成的密钥文件
// （git-ignored、chmod 600，Next server 与 Workshop MCP 进程共用同一文件
// 保证加解密密通）；文件不可用时回落到环境变量 LLM_SECRET。
// GCM 自带认证标签（tag），同时保证机密性与完整性。
//
// 密文格式 `enc:v1:<iv_b64>:<tag_b64>:<ct_b64>`。明文不落盘，任何读到 DB
// 文件的一方拿到的都是无密钥不可解的密文；校验失败时解密返回 null，调用方
// 按「未配置」处理，绝不抛错把读取流程打断。本模块不依赖 server-only，
// 供 Next server 与纯 Node 的 Workshop MCP 两侧共用。

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1:";
const KEY_FILE = join(process.cwd(), "data", "llm-secret.key");
const ENV_VAR = "LLM_SECRET";

// 缓存派生后的主密钥。三处赋值全产 Buffer，"未初始化" 只用 undefined 表达；
// 声明里刻意不留 null——否则 loadOrCreateKey 里 `!== undefined` 之后还剩
// `Buffer | null`，函数返回 Buffer 的契约只能靠非空断言兜住，那是用 `!` 遮
// 类型声明本身写错。
let cachedKey: Buffer | undefined;

function deriveKey(material: string): Buffer {
  // 32 字节主密钥：任意长度的口令/文件内容都先经 SHA-256 归一化到密钥长度。
  return createHash("sha256").update(material).digest();
}

function loadOrCreateKey(): Buffer {
  if (cachedKey !== undefined) return cachedKey;
  // 优先持久化在本机 data/ 的密钥文件：Next server 与 Workshop MCP 进程都从
  // 项目根拉起，读同一文件即用同一密钥，加密 / 解密互通。文件不可用时再退回
  // 环境变量或进程内随机兜底。
  try {
    if (!existsSync(KEY_FILE)) {
      mkdirSync(join(process.cwd(), "data"), { recursive: true });
      // 文件里放一个随机口令，由它派生 AES 密钥；不直接存密钥字节。
      const fileKey =
        randomUUID().replace(/-/g, "") + randomBytes(16).toString("hex");
      writeFileSync(KEY_FILE, fileKey, { encoding: "utf-8", mode: 0o600 });
    }
    cachedKey = deriveKey(readFileSync(KEY_FILE, "utf-8").trim());
    return cachedKey;
  } catch {
    const envSecret =
      process.env[ENV_VAR] ?? process.env[ENV_VAR.toLowerCase()];
    if (envSecret && envSecret.trim().length >= 8) {
      cachedKey = deriveKey(envSecret.trim());
      return cachedKey;
    }
    // 只读部署且无 env：用进程内随机密钥兜底（重启后旧密文不可解，但不崩溃）。
    cachedKey = deriveKey(randomBytes(32).toString("hex") + process.pid);
    return cachedKey;
  }
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptLlmKey(
  plaintext: string | null | undefined,
): string | null {
  if (!plaintext) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, loadOrCreateKey(), iv);
  const ct = Buffer.concat([
    cipher.update(String(plaintext), "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptLlmKey(enc: string | null | undefined): string | null {
  if (!enc) return null;
  if (!isEncrypted(enc)) return enc; // 兼容历史上遗留的明文值
  try {
    const body = enc.slice(PREFIX.length);
    const [ivB64, tagB64, ctB64] = body.split(":");
    if (!ivB64 || !tagB64 || !ctB64) return null;
    const decipher = createDecipheriv(
      ALGO,
      loadOrCreateKey(),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]);
    return pt.toString("utf-8");
  } catch {
    return null;
  }
}
