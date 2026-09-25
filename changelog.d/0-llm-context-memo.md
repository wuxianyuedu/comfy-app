## Fixed

- **`LLMProvider` 的 Context value 每次渲染都换（`src/components/workshop/LLMContext.tsx`）**：
  value 是现拼的对象字面量（含两个内联箭头函数），本 Provider 的任何一次重渲染
  （包括 `settingsOpen` 翻转本身）都会让**所有** `useLLM()` 消费方跟着重渲染 —— Context
  没有字段级订阅，value 引用一变就是整棵子树。现在 `useMemo` 固化 value，依赖写明到位。
