## Fixed

- **eslint 的增量缓存会在依赖变化之后重放旧判决**（`pnpm run lint` 带
  `--cache --cache-strategy content`，缓存键只有「文件内容 + 解析后的 eslint 配置」，
  **不含装了哪些依赖 / tsconfig 的解析口径**）。两个方向都错过：
  - **假红（今天真发生了）**：一次 `pnpm install` 补上 storybook 之后，`pnpm run lint`
    仍报 3 条 `@typescript-eslint/no-unsafe-assignment`
    （`src/components/ui/{badge,button,empty-state}.stories.tsx`），而这三个文件
    `--no-cache` 重跑 **0 条**、删掉缓存后全仓冷跑也 **0 条**。因为组 B 扫整个白名单，
    这条红会拦住之后每一次提交 —— 而本仓 #623 之后无 CI 兜底、又不许 `--no-verify`，
    最容易被拿去换掉的恰恰是判据本身。
  - **假绿（更要紧的那一面）**：新依赖 / 新类型口径带进来的真违规会被旧缓存洗掉，
    看起来全绿。
- 原先这条只写在 `.githooks/pre-commit` 的一句 ⚠️ 里（「升级 eslint 之后先手动删该目录」）——
  手动步骤既不在缓存键里、也没有执行者，所以它今天真的咬人了。现在由 `postinstall` 自动失效。
- 顺带订正我发在 ISSUE #1381 那条归因评论里的推断：它把原因写成「`satisfies Meta<typeof X>`
  这个形状过不了 eslint 的类型化规则」。合进 storybook 线新加的 18 份 story 之后，
  **20 份 `.stories.tsx` 里 17 份用同一个形状且全绿**，只有那 3 份红 —— 形状不是原因，
  缓存才是。已按实测在那条评论后面补一条订正（同一份证据链）。
- **另一条读法以及为什么它不够**：#1381 上另一条回复把同样的红归成「当时 `node_modules` 落后，
  后来 `#1396` 补齐依赖就不再复现」，并据此判「不需要再单开一刀」。那半句是对的（现在冷跑确实 0 条），
  但它解释不了**为什么装完依赖之后它还红着**：同一批文件、同样已装好的依赖，带缓存 3 条、
  `--no-cache` 0 条、删缓存后冷跑 0 条 —— 差的就是那份缓存。「依赖落后」是一次性诱因，
  **缓存不随依赖失效**才是会复发的机制（下一次谁装完依赖不手动删，就会再撞一次假红，
  或者更糟：真违规被旧缓存洗成绿）。这一刀修的是后者，不是去改任何人的 `Meta` 写法。

## Added

- `scripts/invalidate-lint-cache.mjs`（挂在 `package.json` 的 `postinstall`，接在
  `install-git-hooks.mjs` 之后）：指纹 = `pnpm-lock.yaml` + `node_modules/.pnpm/lock.yaml` +
  `tsconfig.json` 三者字节的哈希；变了就删 `node_modules/.cache/eslint` 并落下新指纹，
  没变就保留。前两份分别代表「声明要装什么」与「实际装上了什么」（两者本就不同形，见 §13.5.9），
  只取其一就会出现「改了声明但没重装」时的误失效。`eslint.config.js` 不参与 —— 它本来就在
  eslint 自己的缓存键里。**入口任何异常都咽掉并退 0**：`postinstall` 非零退出会带走整次
  `pnpm install`（`install-git-hooks.mjs` 文件头记着那条 Windows 事故）。
- `tests/eslint-cache-invalidation.test.ts`（8 条）：三样输入逐一改动都必须改变指纹（漏掉任一样，
  「它参与了指纹」就是空话）、首次保守清一次 / 同指纹保留 / 读不到输入只跳过不删、
  入口出错咽掉、`--cache-location` 与失效器盯的目录逐字同源（改了参数而它盯着老路径 = 白清）、
  确实接在 `postinstall` 上，以及跑真入口那条**用临时根目录**（`COMFYAPP_LINT_CACHE_ROOT`）——
  否则一个测试会在别人机器上清掉热缓存。
- 规范 §13.5.11 一节：机制、指纹为什么是三样、代价实测、以及它自己的执行者。

## Verified

- **原因先证伪了别的可能**：不是我这边依赖落后 —— 先 `pnpm install`（补上 `storybook@10.6.1` 等四件）
  再测，缓存态仍 3 条、`--no-cache` 同文件 0 条；也不是 `satisfies` 形状 —— 新落地的 17 份同形状 story
  全绿。⇒ 红在缓存，不在代码；这条判据本身没坏。
- **代价（本机全仓，写进 §13.5.11）**：冷跑 / 无缓存 `real 5m16.890s`（316s）；组 B 稳态热跑
  28.8–46.3s（这组数取 `.githooks/pre-commit` 里已量过的那份）。⇒ 真装完依赖后的第一次提交多等
  约 4.5 分钟，买回「判决来自当前依赖树」。
- **变异三种，各只红 1 条**（还原后 8 条全过；每条「只红 1 条」本身就是分工正确的证据）：
  ① 从 `postinstall` 里摘掉这一环 ⇒ 「确实挂在 postinstall 上」红（同文件里那条 spawn 仍绿 ——
  它测的是入口会不会退 0，不测接线；两半分开才知道哪一半在守什么）；
  ② 把 `tsconfig.json` 从指纹输入里删掉 ⇒ 「三样输入都真参与指纹」红；
  ③ 去掉入口 catch 里的「咽掉并回报」⇒ 「失效器自己抛错时入口咽掉」红。
- 「假红来自缓存」这条因果的**全部证据是同文件的两次对照**：带缓存 3 条 / `--no-cache` 0 条 /
  删缓存后冷跑 0 条（退出码 0、输出 0 字节）。那次冷跑的**墙钟不可用**（跑期间机器休眠过，
  计时成了 537 分钟）—— 所以 §13.5.11 里写的 316s 取自随后一次 `--no-cache` 全仓跑，
  不是取自那次冷跑。本次提交走的组 B 是热跑，它绿不绿与这条因果无关，别混着当证据用。
- `pnpm check`（eslint 零警告 + `tsc --noEmit`）、`doc:render` + `render --check`（30 份一致）+
  `doc:check` 全过；新脚本只在开发期用，**不进分发产物**（未登记进 `RUNTIME_SCRIPTS`，按硬规则 17 的默认拒绝）。
