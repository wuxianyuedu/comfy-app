## Fixed

- 资产库页左侧大片空白：内容区从 `width="wide"`（1200px 居中窄栏）改为 `width="full"`
  （ISSUE #5002），文件夹树贴齐内容区左边距，只保留统一容器的 `px-*` 内边距。
  资产库纳入 `project-view-container` 收口清单，并补源码契约用例，防止居中窄栏回潮。
