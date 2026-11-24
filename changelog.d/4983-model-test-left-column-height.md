## Fixed

- **测试模型页左栏高度随内容走，不再拉伸填补空白**（#4983）：左栏 aside 加 `h-fit`（不被父级弹性布局拉伸到整行高度），树形容器去掉自设的 `max-h-96` 内部滚动上限——内容矮就按内容高显示，超出显示区域才在左栏内部滚动查看。顺带把 `WorkflowNotesTab.test.tsx` 的 LLM 桩按真函数签名定型（清掉 master 上的 2 处 no-unsafe lint 红）。
