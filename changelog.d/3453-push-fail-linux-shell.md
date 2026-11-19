## Fixed

- **push 档 `失败立案` 格在平台池 Linux 容器里退 127（ISSUE #3453）**：现场 build
  `cnb-0r7-1k6vvkmt3` 的 `stage-endStages-0`（`push 失败立案`）日志只有
  `sh: 1: =[Text.Encoding]::UTF8: not found`，`Finished, code: 127`。根因是 #3378
  把这一格从自托管主列（Windows PowerShell）内联进 `GitHub master 镜像（平台池）`
  的 `endStages` 时，**照抄了自托管那句** `$enc=[Text.Encoding]::UTF8; [Console]::OutputEncoding=$enc;`
  和 `ci-cp936-exit.mjs` 外壳 —— 平台池是 `node:26` Linux 容器，stage shell 是 `sh`，
  PowerShell 语法当场被拆成「命令找不到」；CP936 转码那一跳本来也只属中文 Windows。
  修法三件同批：① 该格 script 收成 `node scripts/ci-pr-failure-issue.mjs --no-block
  --lane push`（Linux 原生形态）；② `.cnb/ci-image/Dockerfile` 全局装
  `@cnbcool/cnb-cli` 并 `cnb --version` 自证 —— 立案脚本整条判决链走 `cnb` 子进程，
  容器里原本没有这个二进制，只去掉 PS 前缀会让它「绿着空转」（取不到读数、
  `--no-block` 折成退 0），比红更坏；③ `tests/no-platform-ci-config.test.ts` 补三条
  防复发判据：平台池两条流水线的 script 行不许带 `[Text.Encoding]` / 不许包
  `ci-cp936-exit.mjs`、push 出口的 `endStages` 必须挂立案格、Dockerfile 必须装 CLI。
  两种坏形态（放回 PS 前缀 / 注掉 Dockerfile 的 RUN）都已变异实测当场红、还原复绿。
  顺带删掉已无人引用的 `.push-fail-stage` 死锚点，并把两处「没在 push 节点上单独
  实测过」的旧注释按这次实测结论改掉。规范 §13.5.33.3 / §13.5.35 + 生成态镜像
  同批同步。**另一层边界单独立账 #3457**：平台池容器装 CLI 之后，push 事件的
  `CNB_TOKEN` 是否带 `repo-cnb-history:r` / `repo-issue:rw` 仍待下一跑坐实。
