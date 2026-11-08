## Added

- **应用内「运行反馈」入口**（ISSUE #3371）：底部状态栏新增「反馈」按钮，
  点开界面可填问题描述、附加最多 6 张截图、勾选是否附带运行日志诊断包。
  「生成反馈包」把描述 / 截图 / 诊断 zip 收成一份本机反馈包落进
  `log/exports/feedback-<时刻>/`，并生成预填好的 Issue 标题与正文；
  「复制 Issue 正文」+「打开新建 Issue 页」把提交动作铺平。
  桌包不持有 CNB 凭证，故应用不代提 issue，由有平台身份的一侧粘贴提交。
  落点：`src/components/feedback/`、`src/lib/feedback/`、
  `src/app/api/feedback/export/route.ts`；需求口径见 FR-MC-05。
