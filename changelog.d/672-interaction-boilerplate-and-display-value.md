## Fixed

- **交互样板与判据口径三条账收口**（规范 16 §16.2.4.11，ISSUE #672）：
  上一批（§16.2.4.10）收尾时留下的三笔账，形状与「一个动作用几份实现」不同 ——
  这两条是**交互样板**，最后一条是**判断口径**。

  - **隐藏文件选择框 9 份 → 1 份**（`~/components/ui/file-picker` 的
    `useFilePicker` / `FilePickerButton`）。此前三种写法并存：`useRef` +
    `ref.current?.click()`（6 处）、`<label htmlFor>` 隐式关联（2 处，
    其中 `VideoQueueModal` 是全仓唯一靠 `id` 拼接触发的入口）、input 直接露在
    界面上（1 处）。**多数落点没有复位 `event.target.value`** —— 浏览器只在取值
    变化时派发 `change`，用户第二次选**同一个文件**时回调根本不触发，表现成
    「上传按钮坏了」；这条缺陷是静默的（没有报错、也没有告警）。
  - **一次性反馈 6 份 → 1 份**（`useFlashState` / `useFlashLatch`）。此前分两族：
    4 处裸 `setTimeout(() => setX(false), 1xx)` 的定时器**没人管**（组件卸载后仍
    `setState`，而**日志行会随翻页/锚点窗口被卸载**；连点时旧定时器没清，
    第一次的复位会**提前抹掉**第二次的亮起），2 处手写 `timerRef` + `clearTimeout`。
    复位时长 1200/1400/1500/8000 各不相同且**没有一处说得清为什么**；现在
    `DEFAULT_FLASH_MS` 是唯一默认值，需要不同的落点显式传值并写明理由。
  - **缺值占位符 31 处 → 1 处定义**（`~/lib/display-value`）。这条**不是重复、
    是口径**：`?? "—"` / `|| "—"` / `> 0 ? x : "—"` / `!= null ? String(x) : "—"`
    四种写法只差一两个字符，都编译、都运行、类型都对，差别只在「`0` 与空串算不算
    有值」这一个语义决定上 —— 而 `||` 那一族**把「步数 0」显示成了「—」**。
    现在口径写在一个文件头：`0` / `false` **照常显示**（真实测到的值不是缺值），
    想把 `0` 当缺值的**域**必须显式写自己的判据（如 `model-library-config.ts`
    的 `fmtSize`：模型列表里 `fileSize=0` 表示尚未探到）。

  **判据**：`check-ui-primitives.cjs` 新增 **P7**（视图里「隐藏 `<input type=file>`
  - 手工触发」）与 **P8**（视图里出现占位符字面量 `"—"`），与 P4~P6 同性质的
    **硬闸**（不进棘轮基线、`--update` 也不接受带违规的基线）。
    `tests/ui-primitives-coverage.test.ts` 从另一侧钉住 `file-picker` 的导出名与
    业务引用数；`use-flash-state` / `display-value` 按**时间轴**与**边界值**设用例
    （卸载后是否还 `setState`、连点是否被旧定时器打断、`0`/`false`/NaN 站哪一边）。

  ⚠️ P7 只管**隐藏**这一种形态：`FilmStudio` 的 BGM 选择器是**用户可见的表单
  字段**（靠 `file:` 伪元素美化、就地显示已选文件名），是另一种形态，不欠
  file-picker 的契约 —— 已进反面用例明确放行。P8 只管**视图**：出口模块与
  `src/lib/**` 里的域语义不在此列。

  三个新模块同批做完 §18.14 的三件事：`src/lib/display-value.ts` 登记
  `DOMAIN_EXEMPT`、两个 `ui/` 模块与它一起按**实测值**设覆盖率门槛。
