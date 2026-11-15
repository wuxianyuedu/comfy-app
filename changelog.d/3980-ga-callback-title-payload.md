## Fixed

- 构建历史里「API 自定义事件」那一列 100% 没生效（ISSUE #3980）。#3981 修好了「请求体没送
  `title`」，但标题本身**从来没取到**：自动档那一步读的是
  `github.event.pull_request.title`，而 `pr-gate.yml` 的触发面只有
  `repository_dispatch` / `workflow_dispatch`，那个表达式恒为空串 —— 于是那一步一次也没执行过。
  改为读镜像格送来的 `client_payload.pr_title`（与 `run-name` 同源），两条触发形态并成
  一个入口（env → payload → 站内 `GET /-/pulls/{n}` 依次回落），站内读所用的 PR 号也从
  同一份 payload 取。判据补上「`pull_request.title` 不在取值面」这一条，钉住那次恒假的分支。
