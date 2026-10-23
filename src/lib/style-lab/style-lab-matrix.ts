// ── 风格实验室 · 组合与预算判据（§17.2 第①层：纯函数，无 React / 无 IO）──────
//
// 这一屏在批量扇出之前要把「这套选择会展开成多少格」算清楚并显示出来 —— 因为 GPU 一次
// 只跑一张图：本机执行链的并发上限是 `MAX_CONCURRENCY = 1`（`src/lib/comfyui/runner-state.ts`
// 里那条常量与它的注释），所谓「跑一批」实际是把这些格**串行**排队。用户提交前看不见
// 「N 张、约多久」，就会一次交出去几十格然后卡在队列前等 —— 所以这里的两条预算档位
// （劝退 / 拒绝）与那条实测路径不是装饰，是把「串行」这个物理事实翻译成界面上的数字。
//
// 判据本体全在 `src/lib`（不碰视图），因此可在 node 环境直接断言（规范 17 §17.1 那条
// 「删掉 JSX 还能不能跑测试」）。
//
// 批量扇出真正落地后，本模块管三件事：一格怎么变成一个可拼提示词的角色卡
// （{@link cellToCharacter}）、一格在库里的**稳定身份键**（{@link cellTraitKey} 与
// {@link cellMatchKey}，落库与重跑判重都读它），以及整批的座位表怎么展开
// （{@link planStyleLabSeats}，seed 由 {@link batchBaseSeed} + {@link cellTaskSeed} 派生）。
// 它们放在这里而不是写进路由，是因为界面预览、服务端入队、以及重跑时的「哪些座位
// 已经跑过」必须吃同一条算式（同一个形状写两处就会漂）。

import type { Character } from "~/lib/workshop/types";
import { buildCharacterPrompt } from "~/lib/workshop/prompt-builder";
import { randomSeed } from "~/lib/comfyui/random-seed";
import type { StyleLabTraits } from "./style-lab-types";

/* 下面两条是**策略**（人定的档位），不是测量：它们回答的是「这批该不该劝退 / 该不该拦住」，
 * 而「这批要多久」必须由 {@link medianSeconds} 那条**实测**路径回答 —— 拿一个拍出来的
 * 每秒数去换算，界面上那句「约 34 分钟」就是假数（同一个数字既当预算又当 ETA 时，
 * 它改一次、两屏各错一次，而没有任何一处会红）。两条的分工：
 *   · 软上限：只提示、不拦提交 —— 用户知道自己要挂着等，那就让他等（长批是这一屏的正当用法）；
 *   · 硬上限：直接拒绝 —— 超过它时「等着」不再是用户想要的，而是把串行队列压满的事故，
 *     拆成几次才是那批格子应有的形状，所以这里必须有闸。 */

/**
 * 软上限（格）：超过就提示「这批会很久」，但**不拦提交**。
 */
export const MATRIX_SOFT_LIMIT = 24;

/**
 * 硬上限（格）：超过就拒绝这一批，并要求拆成几次（`runBatch` 挡在提交之前）。
 */
export const MATRIX_HARD_LIMIT = 60;

/**
 * 已测出的单张耗时（秒）→ 中位数；**没有样本时返回 `null`，绝不给一个兜底数字**。
 *
 * 为什么是 `null` 而不是某个常数：调用方（界面的 ETA 那一格）需要区分「本机还没跑过图」
 * 与「跑过、大概这么久」。返回 `null` 让前者显示成一句实话（「本机还没有可参考的出图耗时」），
 * 而不是显示一个看起来像测量的假数。
 *
 * 为什么取中位数而不是平均数：单张耗时是个**重尾**分布（首次跑要加载模型、显存不够要
 * 回收、工作流偶尔多一步 upscale），一次异常慢的样本会把平均数抬到不像话，而中位数
 * 描述的是「正常一张要多久」——那正是提交前想问的那件事。
 */
export function medianSeconds(durations: readonly number[]): number | null {
  const n = durations.length;
  if (n === 0) return null;
  const sorted = [...durations].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  /* 奇数取正中那一枚、偶数取中间两枚的均值（中位数的定义）。
   * 用 slice 取中间段而不是下标取值：下标读在 `noUncheckedIndexedAccess` 下是可空的，
   * 于是要么写 `as number`（eslint 判该用 !）、要么写 `!`（撞本仓 check-non-null-assertions
   * 硬闸，存量已清零）—— 换成切片后这里根本不存在可空索引，两条判据都不碰。 */
  const middle =
    n % 2 === 1 ? sorted.slice(mid, mid + 1) : sorted.slice(mid - 1, mid + 1);
  const sum = middle.reduce((a, b) => a + b, 0);
  return sum / middle.length;
}

/**
 * 某一维参与扇出的取值个数：**没选任何值 = 1（不约束）**，而不是 0。
 *
 * 判据为什么这样定：把「没选」算成 0 会让整个乘积归零，于是「只挑了风格、一维特征都没勾」
 * 这种最常见的形状会被显示成「0 格」—— 而它其实是「这一批不约束特征、每个风格各出一张」。
 * 空维给 1 才是这句话的算术表达。
 */
function axisCardinality(values: readonly string[] | undefined): number {
  return values && values.length > 0 ? values.length : 1;
}

/**
 * 组合数 = 各维取值个数的乘积（空维按 1 计）。
 *
 * 没有任何维度时返回 1（一套风格、不约束特征 ⇒ 就一格），而不是 0 —— 0 会让「只填了
 * 名字什么都没选」的半成品显示成「零格」，与「选了但展开成一格」混为一谈。
 */
export function combinationCount(traits: StyleLabTraits): number {
  let total = 1;
  for (const values of Object.values(traits)) {
    total *= axisCardinality(values);
  }
  return total;
}

/**
 * 枚举全部组合：返回 `Record<维度 id, 选中值>[]`（按 `traits` 的键序展开）。
 *
 * 「不约束」的那一维在结果里落成空串 `""` —— 它是「这一维不进入提示词」的显式标记，
 * 而不是「这一维不存在」（键一直在，值可空），下游拼提示词据此判断要不要带这一段。
 *
 * 结果长度恒等于 {@link combinationCount} 的返回值：这两条判据必须对得上，否则界面上
 * 「K 格」与真正会展开出来的清单会各报一个数（同一个形状写两处就会漂）。
 */
export function enumerateCombinations(
  traits: StyleLabTraits,
): Array<Record<string, string>> {
  const axisIds = Object.keys(traits);
  let combos: Array<Record<string, string>> = [{}];
  for (const axisId of axisIds) {
    const values = traits[axisId];
    // 空维 → 用一个空串占位，保证这一维仍出现在每个组合里、且只贡献一种取值。
    const candidates = values && values.length > 0 ? values : [""];
    const next: Array<Record<string, string>> = [];
    for (const combo of combos) {
      for (const value of candidates) {
        next.push({ ...combo, [axisId]: value });
      }
    }
    combos = next;
  }
  return combos;
}

/**
 * 一格 → 一份能交给 `buildCharacterPrompt` 的角色卡。
 *
 * 这一屏存的不是角色卡而是「组合」，但提示词的组装口只有角色卡那一份
 * （`~/lib/workshop/prompt-builder`：身份 → 氛围 → 风格标签 → 技能模板）。批量扇出
 * 要复用那条顺序，就得把一格临时投影成一个 `Character` —— 投影而不是另写一份拼接：
 * 拼接逻辑抄第二遍时，工坊那边改了顺序、这边还出旧秩序的提示词（§12.12）。
 *
 * 几条刻意的取舍：
 *  · `name` 用风格标签占位。它只是这一格的展示替身，不是真人物角色的名字 ——
 *    矩阵的语义就是「同一个座位换风格」，所以风格才是这一格的身份；
 *  · `positivePrompt` / `negativePrompt` 留空串。它们是 `buildCharacterPrompt`
 *    的**输出**、不是输入：把已经拼好的句子再塞回角色卡，就有了两处真值（角色卡
 *    里那份、格子里那份），而这一屏要存的提示词只在 `styleExperimentCell.prompt`
 *    落一次；
 *  · 四个特征维度按**固定轴 id** 读（`costume` / `appearance` / `personality` /
 *    `temperament`，即 `CHARACTER_ATTRIBUTES` 去掉 `styleTags` 那几维）。这里只能
 *    写死键名，因为 `Character` 的字段本来就是这四个一一对应的具名属性。
 *
 * **已知限制**（照此实现，不在这次改动里补 UI）：创建表单目前不收 `ageGender`、
 * 也不收技能选择，所以这两个值只能来自试验的 `params` 快照 —— 快照里没有就是空 /
 * 缺席。要给用户加这两栏，得先立「它存进 params 还是 traits」的口径，那不属于这一刀。
 */
export function cellToCharacter(input: {
  experimentId: string;
  style: string;
  /** 一维一个值，来自 {@link enumerateCombinations}（空串 = 这一维不约束）。 */
  combo: Record<string, string>;
  /** 这一格在整批里的座位号，只用来造 id。 */
  index: number;
  /** 试验的 `params` 快照（原样带进角色卡，供下游读尺寸 / 采样器这些）。 */
  params: Record<string, unknown>;
}): Character {
  const { experimentId, style, combo, index, params } = input;
  const rawAgeGender = params.ageGender;
  const rawSkillSlug = params.skillSlug;
  const character: Character = {
    id: `${experimentId}#${String(index)}`,
    name: style,
    ageGender: typeof rawAgeGender === "string" ? rawAgeGender : "",
    appearance: combo.appearance ?? "",
    costume: combo.costume ?? "",
    personality: combo.personality ?? "",
    temperament: combo.temperament ?? "",
    styleTags: [style],
    positivePrompt: "",
    negativePrompt: "",
    params,
  };
  /* 只在快照真的给了字符串时才挂上 skillSlug：写 `undefined` 与「没有这个键」在类型上
   * 等价、在 JSON 上不等价（角色卡会被整包序列化进任务 params），所以这里条件赋值。 */
  if (typeof rawSkillSlug === "string") character.skillSlug = rawSkillSlug;
  return character;
}

/**
 * 一组的特征键 —— 这一格在库里的**身份**，不是给人读的那句文案。
 *
 * 为什么带轴 id（`costume=汉服;temperament=清冷`）而不是只拼取值：重跑一批要按这个键
 * 判「这一格是不是已经跑过」。只取值时，一旦两个特征维度出现同一个词（四轴今天的
 * 词表互不重字，将来加词并不保证），两格会撞成同一个键 —— 表现是矩阵**静默少出
 * 一张图**，而界面上「N 风格 × M 特征 = K 格」那句仍照算式报 K。身份键必须按构造
 * 唯一；「这句怎么显示」是另一件事，由视图层的 `traitKeyDisplayText` 现推。
 *
 * 分隔符取 `;` 与 `=`：实测本仓四轴词表里没有任何取值含这两个字符（真引入了也不影响
 * 键的唯一性，只是展示那一列会多出一个分号）。不约束的维度整对省略，全空 ⇒ `""`。
 */
export function cellTraitKey(combo: Record<string, string>): string {
  return Object.entries(combo)
    .filter(([, value]) => value !== "")
    .map(([axisId, value]) => `${axisId}=${value}`)
    .join(";");
}

/**
 * 一格的匹配键 = 风格 + 特征键。
 *
 * 分隔符选换行而不是 `" · "`：特征键自己也是靠分隔符连起来的，拿展示用的连接符当
 * 这里的分隔符会让「`A · B` 配 `C`」与「`A` 配 `B · C`」撞成同一个键（于是某一格
 * 被误判成已跑过、静默少出一张图）。换行不出现在词表标签里，也不在「按码位扫源码
 * 控制字符」那条硬规则禁的字符内（它豁免的正是制表 / 换行 / 回车）。
 */
export function cellMatchKey(style: string, traitKey: string): string {
  return `${style}\n${traitKey}`;
}

/**
 * 这一批的基准 seed。
 *
 * **每批只定一次**（不是每格定一次）：这一屏的缺省语义是「整批共用一枚、只让风格与
 * 特征变」（见 {@link cellTaskSeed}），在格内现算就成了「每格各随机一次」，那恰好
 * 把要控制的变量放掉了。快照里没存 seed（或存的不是有限数）时随机定一枚 —— 与工坊
 * 那侧「空值 ⇒ 每次新的随机 seed」的口径一致（`randomSeed()` 是全库唯一的随机 seed
 * 出口）；定出来这一次整批复用，所以「同一批里两次调用拿到同一个值」是用例之一。
 */
export function batchBaseSeed(params: Record<string, unknown>): number {
  const raw = params.seed;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  return randomSeed();
}

/**
 * 这一格的 seed，按试验存的 `seedMode` 派生。
 *
 * 显式档有三：`random` 每格各随机一枚、`increment` / `decrement` 按座位号偏移
 * （递减压到 0 为止，ComfyUI 的 seed 不接受负数）。**其余一切形状（含没存
 * `seedMode`）都共用基准** —— 缺省档为什么是「共用」而不是「随机」：
 *
 * 这一屏要回答的问题是「换个风格会怎样」，那么 seed 就是必须钉住的那个变量。
 * 每格各随机一枚时，两张图的差别里混着 seed 的差别，用户看到的「风格差异」其实
 * 有一半是抽样噪声 —— 而这屏的存在意义正是替角色卡挑风格。
 * 担心过的反面是「整批共用一枚 ⇒ 每格长得一样，像出图故障」：不成立，因为每格的
 * 提示词本来就各不相同（风格标签与特征就是它们的差异来源），共用 seed 给的是
 * 「底子相同、风格不同」，那正是矩阵要的对照形状。
 *
 * 不认识的值同样按缺省而不是随机：「这批每格换个 seed」是用户的显式选择，
 * 不该由一个拼错的 `seedMode` 静默给出。
 */
export function cellTaskSeed(input: {
  params: Record<string, unknown>;
  baseSeed: number;
  index: number;
}): number {
  const mode = input.params.seedMode;
  if (mode === "random") return randomSeed();
  if (mode === "increment") return input.baseSeed + input.index;
  if (mode === "decrement") return Math.max(0, input.baseSeed - input.index);
  return input.baseSeed;
}

/**
 * 一格座位：矩阵展开后的**一枚待办**，字段与 `styleExperimentCell` 的列对得上。
 *
 * 这里刻意**不含 seed**：基准每批只定一次（{@link batchBaseSeed}），而定基准这件事
 * 发生在服务端拿到整批规模之后。座位只带 `index`，由 {@link cellTaskSeed} 现算。
 */
export interface StyleLabSeat {
  /** 整批里的座位号，从 0 起 —— seed 的递增/递减按它算。 */
  index: number;
  style: string;
  /** 特征键（身份），见 {@link cellTraitKey}。 */
  traitKey: string;
  /** 落库与判重用的组合键（`style` + `traitKey`）。 */
  seatKey: string;
  /** 这一格提交给工作流的提示词（由角色卡投影拼出）。 */
  prompt: string;
  /** 每个风格的第一枚是浏览代表位 —— 墙上一行一枚，格子多了也不会糊成一片。 */
  isRepresentative: boolean;
}

/**
 * 把「这套风格 × 这组特征」展开成整批座位（顺序 = 风格外层 × 组合内层）。
 *
 * 两条与算式对齐的口径：
 *  · `styles` 为空时按「不约束风格」占**一列**（seat 的 `style` 是空串）。这与
 *    {@link combinationCount} 给空维按 1 计同一条判据 —— 否则「只勾了特征、没勾
 *    风格」会展开成 0 格，而界面上那句「N 风格 × M 特征 = K 格」按同一口径给的是
 *    `1 × M = M`，两边各报一个数就是这一屏最难查的那类错。
 *  · 结果长度恒等于风格数 × {@link enumerateCombinations} 的长度，因此也恒等于
 *    界面预览的格数。
 *
 * 落库的只有 `style` 与 `traitKey` 两列：`seatKey` 是**读回来现算**的比对键（重跑时
 * 「这一格跑过了」判的就是它）。把组合键也存一列，等于给同一个事实两个真值 ——
 * 改了一边、另一边仍在参与判重，就会静默少出一张图。
 */
export function planStyleLabSeats(input: {
  experimentId: string;
  styles: readonly string[];
  traits: StyleLabTraits;
  params: Record<string, unknown>;
}): StyleLabSeat[] {
  const styleValues = input.styles.length > 0 ? input.styles : [""];
  const combos = enumerateCombinations(input.traits);
  const seats: StyleLabSeat[] = [];
  for (const style of styleValues) {
    for (const combo of combos) {
      const traitKey = cellTraitKey(combo);
      const index = seats.length;
      seats.push({
        index,
        style,
        traitKey,
        seatKey: cellMatchKey(style, traitKey),
        prompt: buildCharacterPrompt(
          cellToCharacter({
            experimentId: input.experimentId,
            style,
            combo,
            index,
            params: input.params,
          }),
        ),
        isRepresentative: index % combos.length === 0,
      });
    }
  }
  return seats;
}
