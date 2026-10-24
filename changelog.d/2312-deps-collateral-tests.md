## Fixed

#2279/#2280 依赖升级（`437c30d1`）的两处连带用例真红，随本笔收掉（ISSUE #2312）：

- `tests/lockfile-diff.test.ts`：那条「机器值原样透出」把替换锚写成了字面量
  `'@alloc/quick-lru@5.2.0'`，升级后真 lockfile 是 5.3.0 ⇒ `replace` 落空、diff 为空。
  改成按该文件自家约定从真 lockfile **现取**锚点，并加「替换必须真的发生」自守 ——
  锚点再失效时红的是这句哨兵，不是那条断言。
- `src/components/ui/disclosure.test.tsx`：`@base-ui/react` 1.8.0 → 1.9.0 把 disabled
  Trigger 从 `aria-disabled="true"` 改成原生 `disabled` + `data-disabled`（键盘不可聚焦、
  读屏跳过 —— 上游行为变更，如实记录在注释里）；「点了不动」两条版本都有，
  用例改钉新形态。
