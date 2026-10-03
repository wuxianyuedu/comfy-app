## Fixed

- **eslint 增量缓存在依赖变化后重放旧判决**（`scripts/eslint-cache-fingerprint.mjs`，
  规范 §13.5.11，ISSUE #1399）：`pnpm run lint` 带 `--cache`，而 eslint 的缓存键
  只含「文件内容 + 解析后的 eslint 配置」—— **不含装了哪些依赖**，而
  `@typescript-eslint/no-unsafe-*` 是**类型化规则**。于是依赖一变旧判决被整片重放，
  两个方向都会错：**假红**拦住从该缓存起的所有提交（#623 后无 CI 兜底、`--no-verify`
  又不许用 → 最容易被拿去换掉的是判据本身）、**假绿**洗掉新依赖带进来的真违规。
  现场实测：依赖已装好仍报 3 条 `no-unsafe-assignment`，加 `--no-cache` 与删缓存后
  都是 0 条。
  此前唯一的处理是钩子里那句 ⚠️「升级 eslint 之后先手动删缓存目录」—— 触发面写窄了
  （真实触发是**任何**依赖变化）、把「不是判据问题」当结论（它同时会造假红）、
  而且**靠人记得删 = 没有执行者**。
  现在按指纹自动失效：`postinstall` 比 `pnpm-lock.yaml` + `node_modules/.pnpm/lock.yaml`
  - `tsconfig.json` 的字节哈希（前两份是「声明要装什么」与「实际装上了什么」，见 §13.5.9；
    `eslint.config.js` 已在 eslint 自己的缓存键里，不重复），变了就删
    `node_modules/.cache/eslint`，没变就留着（稳态热跑 28.8–46.3s 的代价不能被白付）。
    指纹落盘（`node_modules/.cache/eslint-fingerprint.json`），任何异常一律咽掉退 0 ——
    `postinstall` 非零会带走整次 `pnpm install`。
    代价：真装完依赖后第一次提交多等约 4.5 分钟（冷跑实测 316s），买回「判决来自当前
    依赖树」。
    入口并进既有唯一 postinstall 入口 `scripts/install-git-hooks.mjs`（不再挂第二条命令：
    `checkPostinstall()` 的跨平台契约拦的正是那种拼接形态），并把该入口里两条提前
    `process.exit(0)` 改成不退出 —— 它们恰好是最常见的两种 install 形态。
    判据见 `tests/eslint-cache-fingerprint.test.ts`（两个方向各一组：变了 → 真删、
    没变 → 保留），登记在 `scripts/affected-tests.mjs` 的固定清单里。

- **顺带订正 ISSUE #1381 上那条归因推断**：它曾把原因写成「`satisfies Meta<typeof X>`
  这个形状过不了 eslint 的类型化规则」。合进 storybook 线新加的 18 份 story 之后，
  **20 份 `.stories.tsx` 里 17 份用同一个形状且全绿**，只有那 3 份红 —— 形状不是原因，
  缓存才是。另一条回复把同样的红归成「当时 `node_modules` 落后，后来补齐依赖就不再
  复现」并据此判「不需要再单开一刀」：后半句对（现在冷跑确实 0 条），但它解释不了
  **为什么装完依赖之后它还红着** —— 同一批文件、同样已装好的依赖，带缓存 3 条、
  `--no-cache` 0 条、删缓存后冷跑 0 条，差的就是那份缓存。「依赖落后」是一次性诱因，
  **缓存不随依赖失效**才是会复发的机制。

## Added

- `scripts/eslint-cache-fingerprint.mjs`（并进既有唯一 postinstall 入口
  `scripts/install-git-hooks.mjs`，不新增第二条命令）：指纹 = `pnpm-lock.yaml` +
  `node_modules/.pnpm/lock.yaml` + `tsconfig.json` 三者字节哈希；变了删
  `node_modules/.cache/eslint` 并落新指纹，没变保留。
- `scripts/install-git-hooks.mjs`：两条提前 `process.exit(0)` 改成不退出 —— 它们恰好是
  最常见的两种 install 形态，提前退出等于让这一步在最常见路径上静默跳过。
- `tests/eslint-cache-fingerprint.test.ts`（14 条）+ 规范 §13.5.11。
  其中两条专守「接线不许漂移」：清的目录与 `package.json` 的 `--cache-location`
  逐字同源（改了参数而脚本盯着老路径 = 白清），以及钩子不把「手动删缓存」写回机制位。

## Verified

- 反向验证：把 `runFingerprint` 的删除分支短路成 `if (false && …)` → 3 条挂
  （「变了 → 真删」两个方向那条 + 入口真跑那条），还原后回绿。
- `tests/postinstall-cross-platform.test.ts` 13/13 —— #636 的跨平台契约未被破坏
  （本 PR 的接线形态正是为满足它：`postinstall` 拼接第二条命令会被判 POSIX shell 违规）。
- 真跑双向：指纹未变 → 缓存保留；改 `tsconfig.json` 一个字节 → 目录被删；还原后又判一次变化。
- `pnpm doc:render` + `render --check` + `doc:check` 全过；新脚本只在开发期用，
  **不进分发产物**（未登记进 `RUNTIME_SCRIPTS`，按硬规则 17 的默认拒绝）。
