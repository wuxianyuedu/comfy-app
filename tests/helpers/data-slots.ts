/**
 * 扫出 `src/**` 里真实写过的 `data-slot` 值，供 `tests/reduced-motion-tiers.test.ts` 第 ④ 档消费；
 * 判的是 `globals.css` 里 `[data-slot="x"]` 点名的 slot 组件是否还写：改名/删掉不报错，只会静默
 * 不命中，「减弱动态效果」对那个表面悄悄失效 —— tsc / eslint / 构建都看不见（用户开关后唯一会撞上）。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));

/** 递归列出目录下的文件（跳过 `node_modules` 与构建产物那一类点开头目录）。 */
function walk(dir: string): Array<string> {
  const out: Array<string> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(?:tsx|ts)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * `data-slot` 的值集合。只认**字面量**写法（`data-slot="foo"`）——
 * 动态拼出来的（`data-slot={name}`）本仓库没有这种形态，真出现了这条判据
 * 会因「查无此名」而红，那是正确形态的红（它在告诉你：口径变了）。
 */
export function collectDataSlots(): { files: number; slots: Set<string> } {
  const slots = new Set<string>();
  const files = walk(SRC_DIR);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/data-slot="(?<slot>[^"]+)"/g)) {
      const slot = m.groups?.slot ?? "";
      if (slot !== "") {
        slots.add(slot);
      }
    }
  }
  return { slots, files: files.length };
}
