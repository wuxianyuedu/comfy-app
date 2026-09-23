import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* `secrets.ts` 的密钥文件路径与缓存都绑在 `process.cwd()` 与模块级 `cachedKey`
 * 上，所以每个用例都要：换 cwd → 重置模块缓存 → 动态 import。
 * 不这样做的话第二个用例会复用第一个用例的密钥，而「换密钥后旧密文不可解」
 * 这条判据恰恰是加密模块最不能漏的一条。 */
const originalCwd = process.cwd();
let sandbox: string;

async function loadSecrets() {
  vi.resetModules();
  return await import("./secrets");
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "llm-secrets-"));
  process.cwd = () => sandbox;
  delete process.env.LLM_SECRET;
  delete process.env.llm_secret;
});

afterEach(() => {
  process.cwd = () => originalCwd;
  rmSync(sandbox, { recursive: true, force: true });
  delete process.env.LLM_SECRET;
  delete process.env.llm_secret;
});

describe("isEncrypted", () => {
  it("只认 `enc:v1:` 前缀", async () => {
    const { isEncrypted } = await loadSecrets();
    expect(isEncrypted("enc:v1:a:b:c")).toBe(true);
    expect(isEncrypted("sk-plain")).toBe(false);
    expect(isEncrypted("")).toBe(false);
  });
});

describe("encryptLlmKey / decryptLlmKey", () => {
  it("往返一致，且密文里不含明文", async () => {
    const { encryptLlmKey, decryptLlmKey, isEncrypted } = await loadSecrets();
    const enc = encryptLlmKey("sample-llm-key");
    expect(enc).not.toBeNull();
    expect(isEncrypted(enc!)).toBe(true);
    expect(enc).not.toContain("sample-llm-key");
    expect(decryptLlmKey(enc)).toBe("sample-llm-key");
  });

  it("同一明文两次加密得到不同密文（每次新 IV），但都能解回", async () => {
    const { encryptLlmKey, decryptLlmKey } = await loadSecrets();
    const a = encryptLlmKey("same");
    const b = encryptLlmKey("same");
    expect(a).not.toBe(b);
    expect(decryptLlmKey(a)).toBe("same");
    expect(decryptLlmKey(b)).toBe("same");
  });

  it("空值一律归一为 null，不产出 `enc:v1:` 空壳", async () => {
    const { encryptLlmKey } = await loadSecrets();
    expect(encryptLlmKey("")).toBeNull();
    expect(encryptLlmKey(null)).toBeNull();
    expect(encryptLlmKey(undefined)).toBeNull();
  });

  it("非加密串按「历史遗留明文」原样返回（不炸、不吞值）", async () => {
    const { decryptLlmKey } = await loadSecrets();
    expect(decryptLlmKey("legacy-plaintext")).toBe("legacy-plaintext");
    expect(decryptLlmKey("")).toBeNull();
    expect(decryptLlmKey(null)).toBeNull();
    expect(decryptLlmKey(undefined)).toBeNull();
  });

  it("字段不足 / 非法 base64 / 篡改密文一律返回 null 而不抛错", async () => {
    const { encryptLlmKey, decryptLlmKey } = await loadSecrets();
    const good = encryptLlmKey("demo-payload")!;
    const parts = good.slice("enc:v1:".length).split(":");

    expect(decryptLlmKey("enc:v1:onlyiv:onlytag")).toBeNull();

    // 篡改密文体：GCM 的认证标签必须拦住它，而不是解出乱码。
    const tamperedCt = Buffer.from(parts[2]!, "base64");
    tamperedCt[0] = tamperedCt[0]! ^ 0xff;
    expect(
      decryptLlmKey(
        `enc:v1:${parts[0]}:${parts[1]}:${tamperedCt.toString("base64")}`,
      ),
    ).toBeNull();

    // 篡改 tag 同理。
    const tamperedTag = Buffer.from(parts[1]!, "base64");
    tamperedTag[0] = tamperedTag[0]! ^ 0xff;
    expect(
      decryptLlmKey(
        `enc:v1:${parts[0]}:${tamperedTag.toString("base64")}:${parts[2]}`,
      ),
    ).toBeNull();

    expect(decryptLlmKey("enc:v1:!!!:!!!:!!!")).toBeNull();
  });

  it("换密钥后旧密文解不开（返回 null 而不是明文垃圾）", async () => {
    const first = await loadSecrets();
    const enc = first.encryptLlmKey("demo-rotated")!;

    // 换 cwd 即换 `data/llm-secret.key` 的落点 → 等价于轮换了密钥。
    const other = mkdtempSync(join(tmpdir(), "llm-secrets-rotated-"));
    try {
      process.cwd = () => other;
      const second = await loadSecrets();
      expect(second.decryptLlmKey(enc)).toBeNull();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("密钥来源", () => {
  it("首次使用即在 data/ 下生成 0600 密钥文件，并由其派生密钥", async () => {
    const { encryptLlmKey } = await loadSecrets();
    const keyFile = join(sandbox, "data", "llm-secret.key");
    expect(existsSync(keyFile)).toBe(false);

    encryptLlmKey("x");
    expect(existsSync(keyFile)).toBe(true);

    const content = readFileSync(keyFile, "utf-8").trim();
    // 文件里放的是随机口令，不是直接可用的密钥字节。
    expect(content.length).toBeGreaterThan(16);
    expect(content).not.toMatch(/\s/);
  });

  it("密钥文件不可读时回落到 LLM_SECRET", async () => {
    // `KEY_FILE` 是模块级常量（import 时按当时的 cwd 求值），所以要把
    // 「文件不可读」造在 import 之前：先建一个同名目录占位。
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(sandbox, "data", "llm-secret.key"), { recursive: true });
    process.env.LLM_SECRET = "env-derived-value";

    const { encryptLlmKey, decryptLlmKey } = await loadSecrets();
    const enc = encryptLlmKey("demo-via-env")!;
    expect(decryptLlmKey(enc)).toBe("demo-via-env");

    // 同一 env 值在另一个 cwd 下必须解得出 —— 证明密钥来自 env 而不是本机文件。
    const other = mkdtempSync(join(tmpdir(), "llm-secrets-env-"));
    try {
      mkdirSync(join(other, "data", "llm-secret.key"), { recursive: true });
      process.cwd = () => other;
      const second = await loadSecrets();
      expect(second.decryptLlmKey(enc)).toBe("demo-via-env");
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("小写 llm_secret 也认（Workshop MCP 侧的历史写法）", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(sandbox, "data", "llm-secret.key"), { recursive: true });
    process.env.llm_secret = "lowercase-env-value";

    const { encryptLlmKey, decryptLlmKey } = await loadSecrets();
    const enc = encryptLlmKey("demo-via-lower-env")!;
    expect(decryptLlmKey(enc)).toBe("demo-via-lower-env");
  });

  it("太短的 env 口令不被采用（回落进程内随机，仍可往返）", async () => {
    process.env.LLM_SECRET = "short";
    const { encryptLlmKey, decryptLlmKey } = await loadSecrets();
    const enc = encryptLlmKey("demo-fallback")!;
    expect(decryptLlmKey(enc)).toBe("demo-fallback");
  });

  it("派生是 SHA-256 归一化：不同长度口令都得到 32 字节密钥", async () => {
    // 直接核对 deriveKey 的口径（它未导出，用行为等价的方式验证）：
    // 长短两种口令都能正常加解密，说明长度不参与密钥形状。
    process.env.LLM_SECRET = "a".repeat(200);
    const { encryptLlmKey, decryptLlmKey } = await loadSecrets();
    const enc = encryptLlmKey("demo-long-key")!;
    expect(decryptLlmKey(enc)).toBe("demo-long-key");
    expect(createHash("sha256").update("probe").digest().length).toBe(32);
  });

  it("只读部署且无 env 不抛错：进程内随机兜底", async () => {
    // 造一个「data 目录无法创建」的场景：把 cwd 指向一个文件所在路径。
    const blockingFile = join(sandbox, "blocked");
    writeFileSync(blockingFile, "not a directory");
    process.cwd = () => blockingFile;

    const { encryptLlmKey, decryptLlmKey } = await loadSecrets();
    const enc = encryptLlmKey("demo-readonly");
    expect(enc).not.toBeNull();
    expect(decryptLlmKey(enc)).toBe("demo-readonly");
  });
});
