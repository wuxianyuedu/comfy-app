/**
 * envfile.ts —— 项目 `.env` 的最小读写器，不依赖任何第三方库。
 *
 * 自定义节点设置接口用它，让用户能在界面上配 CUSTOM_NODES_PATH，
 * 而不必手工编辑 `.env`。
 *
 * - 先读 `.env.local`，再读 `.env`（与 Next.js 的优先级一致），
 *   因此即使在 `.env.local` 不存在时，`.env` 里设的值也能读到。
 * - 写入只动 `KEY=...` 那一行（不存在则追加），其余各行、注释与顺序全部保留，
 *   绝不重写整个文件。
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";

function envPath(name: string): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), name);
}

/* 从磁盘上的 .env.local / .env 读单个变量（不是从 process.env 读）。 */
export function readEnvVar(key: string): string | null {
  for (const file of [".env.local", ".env"]) {
    const fullPath = envPath(file);

    if (!fs.existsSync(fullPath)) continue;

    const text = fs.readFileSync(fullPath, "utf-8");

    for (const line of text.split("\n")) {
      const match = /^\s*([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);

      if (match?.[1] === key) {
        let value = match[2]!;

        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        return value;
      }
    }
  }

  return null;
}
