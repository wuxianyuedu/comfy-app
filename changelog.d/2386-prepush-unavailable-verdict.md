## Fixed

- **pre-push 的「取不到上游引用」从 reason 文案匹配改成三态判决**（ISSUE #2386）：
  `decidePremergePush` 的输出从 `{run: boolean}` 扩成 `{verdict: "run" | "skip" | "unavailable"}`
  —— 一个布尔承担不了「不需要跑」与「跑不了」两种语义，后者此前靠
  `reasons.startsWith("取不到")` 从跳过里分出来，改一句措辞就会把「没法复算」
  静默读成「没必要跑」（push 免检）。现在 `unavailable` ⇒ 退 2（出口 `git fetch`）、
  `skip` 保持原义（没有要合的分支 ref / 证明仍成立）、其余照跑复算；接线抽成
  `exitForNotRun()` 纯函数并用例钉住（unavailable ⇒ 2 这条此前没有任何用例）。
