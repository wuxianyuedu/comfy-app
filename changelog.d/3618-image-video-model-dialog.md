## Changed

- 设置页「远程模型」：图像 / 视频模型的「添加 / 编辑模型」弹窗按用途分叉——
  不再出现「智能配置」「上下文窗口」「最大输出 Token」「高级配置」与「API 格式」
  下拉（文本协议三词表对图像 / 视频端点无意义），换成只读的「接口端点」展示
  `POST {base}{路径}`，路径复用 `defaultUsageTestPath()`（图像
  `/images/generations`、视频 `/videos/generations`，Agnes 视频按 host 判
  `/videos`）；供应商详情里的模型行摘要同批分叉：文本模型念「上下文 / 输出 /
  接口格式」，图像 / 视频模型念自己的端点路径。（#3618）
