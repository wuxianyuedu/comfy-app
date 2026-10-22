## Fixed

- **「`env:init` 能补缺失键，却没有任何时刻提醒人去跑它」——启动器现在会念（ISSUE #2205）**：
  #2186 让 `pnpm env:init` 能往已有 `.env` 补键，但唯一的读数是 `pnpm ship` 阶段 0 ——
  不跑 ship 的人（只提交 / 只建 PR / 只评论）永远看不到，那一行仍传不到别的检出
  （当场读数：本机四份并行检出里三份缺 `COMFYAPP_DEV_HANDLE`，而它们不会因为
  「ship 会念」而被动到）。现在启动应用的几条入口都会做一次非阻断读数
  （`envInitHint`）：`dev-launcher.mjs` 在环境预检**通过之后**、工具链门禁之前；
  `pnpm dev` / `pnpm start` 两条直达入口挂在共用的 `exitIfEnvNotReady` 上
  （编排器那条路的子进程输出进日志文件，屏幕上不会重复）。`.env` 若缺
  `.env.example` 里未注释的键，就打一行 `环境配置提醒：… ⇒ pnpm env:init`。
  三条边界：
  ① **只念不改** —— 不写文件、不改退出码，提醒不是闸；
  ② **判据只有一份** —— 补齐面与这条读数共用 `env-preflight.mjs` 的 `missingEnvKeys`
  （`env-init.mjs` 同步改为调用它），所以「念出来的键」与「真补上去的键」不会分叉；
  ③ **不重复念** —— `.env` 整份缺失时由阻断那条给 `env:init` 出口，这一格静默；
  `SKIP_ENV_VALIDATION` 下同样静默（与 `src/env.js` 同口径）。
  回归见 `tests/linux-env-bootstrap.test.ts` 新增五条（缺键要念且不阻断 / 键齐不念 /
  必填缺失不重复念 / `dev`·`start` 的共用预检也念 / `missingEnvKeys` 的顺序与注释键口径），
  规范 §9.1 与 §9.2 第 6 条同步。
