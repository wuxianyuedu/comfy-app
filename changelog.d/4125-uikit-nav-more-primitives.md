## Added

- **UI 控件总览新增左侧大类导航并补全基元展示（#4125）**：左侧固定一列八个分区导航（语义 token 墙 / 基元速览 / 按钮徽标 / 输入选择 / 浮层对话框 / 导航布局 / 反馈状态 / 数据杂项），点击锚点跳分区，项多了也好找；分区清单 `ui-kit-gallery-categories` 是导航与各分区 id 的唯一出处。补全此前未展示的十个可视化基元 —— Icon / Separator / TruncatedText 进速览区，StepperInput / SelectMenu / MultiSegmentPopover / FilePickerButton 进输入分区，MediaThumbnail / PageHeader 进数据分区，StatusButton 进反馈分区。新增 3 条用例钉导航锚点、sr-only 标题与补全基元。
