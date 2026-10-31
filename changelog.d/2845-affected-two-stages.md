## Changed

- **固定/受影响用例从「一条 stage 两个块」拆成两个 CI stage**（ISSUE #2845）：
  新增 `固定结构用例` 一格（`COMFY_AFFECTED_SEGMENT=fixed`），`受影响用例` 只跑增量面
  （`COMFY_AFFECTED_SEGMENT=affected`）。两格共用同一份入口链
  （`ci-affected-tests.mjs` → `run-affected-tests.mjs`，判据一字未改），平台日志各有
  自己的格、junit 与收尾复述按格各出，两段摘要不再互相掺杂。
  **fixed 段不解析改动面**（PR 三点 diff 拿不到 / 为空都照跑——固定结构清单是静态契约，
  与「这次改了什么」无关）；affected 段映射到 0 份用例（纯文档 PR）时响亮念一句后按绿收，
  不冒充「整格没判」。缺省（本地不设段开关）= both，跑法与拆分前逐字一致。
  格名单 `COMFYAPP_CI_GATES` 与预算钉子（no-platform-ci-config 的 timeout 清单）同批对齐。
