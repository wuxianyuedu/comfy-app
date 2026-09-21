// ── 「把一组 props 转成另一个键的 props」的唯一出口（规范 16 §16.2.4.66）──
//
// 按**形态**扫出来的账：全库有 **42 处** `onChange={(e) => FUNC(e.target.value)}`
// 这一族写法。它们都做同一件事 —— 把一个 DOM 事件里取出来的**值**，
// 交给一个只关心值的回调。而写法分四派，每一派都编译、都运行、类型都对：
//
//   · **取值路径** —— 绝大多数取 `target.value`，但复选框 / 开关那一族
//     要的是 `target.checked`；
//   · **事件参数名** —— `event` / `ev` / `e` 三种混用，看不出是不是同一件事；
//   · **就地转换** —— `Number(e.target.value)`、`e.target.value.replace(/[^\d]/g, "")`
//     这类转换写在箭头函数体里，同一件事在别处又写一遍（而规则各写各的）；
//   · **对象改写** —— `(e) => c.patchLlm({ model: e.target.value })`：
//     值的来源一样，去处是「某个对象的某个键」，**键名只能靠人眼核对**。
//
// 前两派是纯粹的样板。真正的病灶是**第三、四派**：转换散在视图里时，
// 「这个输入框收不收小数 / 允不允许负号」就变成了每处各自实现的行为 ——
// 同一个「时长」字段在两处各判各的，用户能在其中一处打出另一处打不出的字符；
// 键名靠人眼对齐时，与 `value={cfg.model}` 写错一个字符就编译通过、
// 运行时**静默写到另一个字段上**。
//
// 口径（本文件是全库唯一的定义处）：
//   · **回调只收值**（`(value: string) => void`）—— 视图不再接触事件对象；
//   · **转换经参数显式给出**（`transform`），不写成箭头函数体；
//   · **`checkbox` / `number` 各给一支** —— 它们取的字段不同，
//     不是同一件事的三种写法；
//   · **键名改写给 `bindKey`** —— 消除「照着上一段抄键名」这一类错误。

/** 一个「只关心值」的回调 —— 本模块所有适配器产出的形状。 */
export type ValueHandler<T = string> = (value: T) => void;

/** 本模块所有适配器接受的「事件」形状（只读它真正用到的字段）。 */
type ValueEvent = { target: { value: string } };
type CheckedEvent = { target: { checked: boolean } };

/**
 * 文本类控件（`input[type=text]` / `textarea` / `select`）的 `onChange` 适配器。
 *
 * 用法：`<input value={q} onChange={textHandler(setQ)} />`；
 * 要就地改写对象则 `onChange={textHandler((name) => patch({ name }))}`。
 *
 * `transform` 是**显式**的：过滤 / 限长这类转换写在调用处、以具名函数传入，
 * 而不是塞进箭头函数体 —— 同一件事就不再有两处各自实现的机会。
 *
 * 两条重载的意义：`T = string` 时可以省 `transform`（取到的原值就是最终值）；
 * `T` 是别的类型时**必须**显式给 —— 早期单签 + `transform = (raw) => raw as unknown as T`
 * 的默认值，会让 `textHandler<number>(cb)` 忘记传 transform 时把 `"42"` 的字符串
 * 原文交给 `(value: number) => void` 的回调：TypeScript 看不出、运行时下游
 * `Number.isFinite(str)` 一律 false 走 fallback、或者直接落库变字符串。
 * 「值转换是可选的」在这个模块的定位（全库唯一 props 适配器出口）里就是谎言，
 * 现在把它从**类型契约**上就掐掉。
 */
export function textHandler(
  onValue: ValueHandler<string>,
): (event: ValueEvent) => void;
export function textHandler<T>(
  onValue: ValueHandler<T>,
  transform: (raw: string) => T,
): (event: ValueEvent) => void;
export function textHandler<T>(
  onValue: ValueHandler<T>,
  transform?: (raw: string) => T,
): (event: ValueEvent) => void {
  // 走到这里 transform 一定存在，除非调用方命中的是「T = string」那条重载 ——
  // 这时把 raw 原样交给回调就是恒等，`as unknown as T` 只在**编译器已经
  // 通过重载决议把 T 锁到 string** 的路径上生效，不再有「非 string T 忘传
  // transform」的漏口。
  const fn: (raw: string) => T = transform ?? ((raw) => raw as unknown as T);
  return (event) => onValue(fn(event.target.value));
}

/**
 * 复选框（`input[type=checkbox]` / `Switch`）的适配器 —— 取的是 `checked`。
 *
 * 为什么单独一支而不是给 `textHandler` 加个开关：一个适配器同时认两种取值
 * 路径，调用处就得自己记得传对参数，而传错的后果是**静默的**（`undefined`
 * 被当成 `false`，开关永远打不开）。
 */
export function checkedHandler(
  onValue: (checked: boolean) => void,
): (event: CheckedEvent) => void {
  return (event) => onValue(event.target.checked);
}

/**
 * 数字类控件的适配器 —— 取 `value` 再转数。
 *
 * `fallback` 是**必填**的：`Number("abc")` 是 `NaN`（会一路传播到 `style` /
 * 落库），而 `Number("")` 更隐蔽 —— 它是 **`0`**，`Number.isFinite` 拦不住。
 * 两者都不该被悄悄写进状态（后者会让「清空输入框」变成「设为 0」）。
 * 调用处必须说出「读不出来时算几」。
 */
export function numberHandler(
  onValue: (value: number) => void,
  fallback: number,
): (event: ValueEvent) => void {
  return (event) => {
    const raw = event.target.value.trim();
    if (raw === "") {
      onValue(fallback);
      return;
    }
    const parsed = Number(raw);
    onValue(Number.isFinite(parsed) ? parsed : fallback);
  };
}

/**
 * 把「值回调」绑到对象的某个键上 —— 消除「照着上一段抄键名」的错误。
 *
 * 用法：`const setModel = bindKey(patchLlm, "model")`，
 * 随后 `<input value={cfg.model} onChange={textHandler(setModel)} />`。
 *
 * 收口前这一族写的是 `(event) => c.patchLlm({ model: event.target.value })`：
 * 键名与 `value={cfg.model}` 的键名靠人眼对齐，写错一个字符就编译通过、
 * 运行时静默写到另一个字段上。经 `bindKey` 之后键名只出现一次。
 */
export function bindKey<T extends object, K extends keyof T>(
  patch: (partial: Pick<T, K>) => void,
  key: K,
): (value: T[K]) => void {
  return (value) => patch({ [key]: value } as Pick<T, K>);
}

/**
 * 就地取值：把事件里的值交给回调，**返回 `void`**。
 *
 * 给那些「必须在同一个事件里做别的事」的落点用 —— 例如输入框要在 `change`
 * 里读 `scrollHeight` 调整高度，不能把整个 `onChange` 换成 `textHandler(...)`。
 *
 * 用法：在 `onChange` 里先 `readTextInput(event, setInput)`，
 * 再继续用同一个 `event` 做别的事（例如重设 `event.target.style.height`）。
 *
 * 与 `textHandler` 共用「取值只有一处」的口径：这条路径读的也是
 * `target.value`，没有第二份取法可言。
 */
export function readTextInput(
  event: ValueEvent,
  onValue: ValueHandler<string>,
): void {
  onValue(event.target.value);
}

/**
 * 只保留数字字符的输入转换 —— 「这个框只收整数」这条规则的一处定义。
 *
 * 收口前它写在 `WorkflowCanvasDecorations` 的箭头函数体里
 *（`event.target.value.replace(/[^\d]/g, "")`），于是「画布上那个尺寸输入框
 * 收不收小数 / 负号 / 空格」只能靠读那一行才能知道。经 `textHandler` 的第二
 * 参数传入之后，规则与「把值交出去」这两件事各只有一处。
 *
 * 用法：`<input value={draft} onChange={textHandler(setDraft, digitsOnly)} />`。
 *
 * 刻意**不**处理负号与小数点：这条规则的名字就是「只要数字」，要收小数的
 * 字段该走 `numberHandler`（它连「读不出来算几」都要求调用处说出来）。
 */
export function digitsOnly(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}
