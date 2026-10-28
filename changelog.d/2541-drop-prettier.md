## Changed

- **删掉 `prettier` 与 `prettier-plugin-tailwindcss` 这两个开发依赖**（issue #2541 的收尾）。
  格式化器上一批（#2546）已经换成 oxfmt：`check-format.cjs` / `check-reformat-only.cjs` /
  `ci-format-fixup.mjs` 三条判据与 `format:check` / `format:write` 全部走 oxfmt，
  `.oxfmtrc.json` 里带着 `oxfmt --migrate prettier` 搬过来的 `ignorePatterns`，Tailwind
  类名排序由内置的 `sortTailwindcss` 接管 —— 两个包自此**没有任何消费方**。
  - 为什么分两批：上一批删 `prettier.config.js` 时若同批删依赖，基线快照的 tsc 会撞
    TS2307（主干那份配置里的 `import("prettier").Config`），合并前复算 inconclusive。
    现在主干上那份配置已经不在，删依赖才是安全的。
  - 同批删 `.prettierignore`：它那两条（`src-tauri/target/`、
    `tests/.setup-cleanup-probe-*.test.tsx`）已经搬进 `.oxfmtrc.json` 的
    `ignorePatterns`，留着只会让人以为仓库里还有第二个格式化器。
  - 没删的是**叙述性**引用（历史台账 / 注释里讲「prettier 时代怎样怎样」的那些），
    它们不构成消费方，逐条改写只会把 diff 撑大、且把史实抹掉。
