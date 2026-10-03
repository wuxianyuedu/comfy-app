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
