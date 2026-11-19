## Changed

- **组件工作台从 webpack 版框架迁到 vite 版**（`@storybook/nextjs` → `@storybook/nextjs-vite`，
  ISSUE #3372）：官方在 Storybook 11 已把 `@storybook/nextjs` 标记废弃、12 移除，
  推荐目标就是 `@storybook/nextjs-vite`。升级方会看到三处不同：
  ① 依赖图里整条 webpack 链消失 —— `pnpm why elliptic` / `pnpm why node-polyfill-webpack-plugin` /
     `pnpm why @storybook/builder-webpack5` / `pnpm why webpack-dev-middleware` 全部是空输出
     （原先 `elliptic` 经 `builder-webpack5 → node-polyfill-webpack-plugin → crypto-browserify`
     传递进来），`pnpm-lock.yaml` 净少约 3100 行（+1030 / −4140）；
  ② `pnpm-workspace.yaml` 的 `overrides` 少了 `'webpack-dev-middleware@6': '7.4.5'`、
     `allowBuilds` 少了 `core-js-pure` —— 两条都是 webpack 链带来的、现在不再命中；
  ③ 构建链换成了 vite builder（实测本仓 `storybook:build` 的 JS 打包阶段 27.9s）。
  **story 面向没有变化**：迁移前后 `storybook-static/index.json` 都是 **534 条**，
  story id 集合逐条相同（迁移前先跑一次 build 记基线，再迁移后比对）。
  随框架迁过去的两处**必要补正**（不补也不报错、只是静默不对）：
  - 应用 origin 的编译期内联改由 `.storybook/main.ts` 的 `viteFinal` + `define` 承担 ——
    vite builder 把 Storybook 的 `env` 落到 `import.meta.env`，而本仓的读取面是
    `process.env`（`app-origin-reader.ts` 的计算属性访问）；不补的话注入层会永远退回
    缺省端口 3100，工具栏旋钮与真 tRPC 链路的 origin 全是错的；
  - `.storybook/preview.tsx` 加 `parameters.nextjs.appDirectory = true` ——
    `next/navigation` 只在 app 目录下有桩，本仓只有 app 目录，按官方口径全局开。
