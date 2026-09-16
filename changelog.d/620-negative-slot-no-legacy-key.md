## Changed

- **「负向提示词」口不再兼容读取历史键 `<节点 id>|negative`**：这一口现在只认
  契约口径的键 `negative`（作者在画布上画的那条线）与端口名判据，判不出来就
  如实显示成「未配置」。旧键属于「按工作流聚类」时代的键空间，与现在的
  `source.mode:<模式>` 不是同一套口径 —— 读它等于让一个本应「未配置」的口凭空
  多出落点，而那个落点是否属于当前模式无从判定。为此删除了
  `workflow-library/workflow-negative-slot.ts`（该模块只做这一件事），
  `deriveLibraryParamCards` 直接按契约条目解析落点，不再有翻译层与兜底推断。
