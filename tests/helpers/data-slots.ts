/**
 * 扫出 `src/**` 里真实写过的 `data-slot` 值。
 *
 * 为什么单独成文件而不是埋在用例里：这件事要遍历上百个 `.tsx`，而调用方
 * （`tests/reduced-motion-tiers.test.ts` 第 ④ 档）要的只是**一个名字集合**。
 *
 * 判的是「CSS 选择器点名的那个 slot，组件里到底还写不写」：`globals.css` 里的
 * `[data-slot="x"]` 在 `x` 被改名或删掉之后**不会有任何报错**，只会静默不再命中
 * 任何元素 —— 于是「减弱动态效果」那一档对那个表面悄悄失效，而这正是系统设置里
 * 开了开关的用户唯一会撞到、而 tsc / eslint / 构建全都看不见的一类故障。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));

/** 递归列出目录下的文件（跳过 `node_modules` 与构建产物那一类点开头目录）。 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * `data-slot` 的值集合。只认**字面量**写法（`data-slot="foo"`）——
 * 动态拼出来的（`data-slot={name}`）本仓库没有这种形态，真出现了这条判据
 * 会因「查无此名」而红，那是正确形态的红（它在告诉你：口径变了）。
 */
export function collectDataSlots(): { slots: Set<string>; files: number } {
  const slots = new Set<string>();
  const files = walk(SRC_DIR);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/data-slot="([^"]+)"/g)) {
      if (m[1]) slots.add(m[1]);
    }
  }
  return { slots, files: files.length };
}
