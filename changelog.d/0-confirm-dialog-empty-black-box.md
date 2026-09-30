## Fixed

- **确认弹窗「空黑框」**：数据库结构过期 →「点击同步」弹出的确认框只剩一块空黑面板，标题/描述/按钮全部不可见。根因是 `ConfirmDialog` 把 `overlayClass("modal", …)`（**遮罩层**的「铺满内容区」定位：`fixed top-title-bar inset-x-0 bottom-0`）传给了 `DialogContent` —— 那是弹窗**卡片**（base-ui Popup），基元自带 `fixed top-1/2 left-1/2 -translate-1/2` 居中定位，两套定位打架：卡片被拉伸成整块内容区又被 −50% 平移，真正的 420px 实体卡被甩到视口左上角之外。改为仓库自绘弹窗的统一惯例（`className="bg-transparent p-0 ring-0"` + `popupClassName="w-fit"`），卡片外观仍由内部 div 决定。新增防回归测试：弹窗卡片本体不得携带遮罩定位 class（`src/components/ui/confirm-dialog.test.tsx`）。所有 `ConfirmDialog` 消费方（删除工作流、清空画布、画布项目删除等）一并修复。
