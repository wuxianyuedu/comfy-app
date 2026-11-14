/**
 * 数据存放位置的登记 —— 「这一类数据存在哪儿」的**单一出处**（ISSUE #3625）。
 *
 * 为什么要有这一层：应用里的数据散在好几个地方 —— 本机 SQLite 库、应用数据目录下的
 * 文件、项目代码库里的文件、用户自己磁盘上的目录，另有一份先落在浏览器存储里、
 * 还有一份托管在远端服务上。此前这些落点只在各自的实现里各写一句（界面文案、备份说明、
 * 注释），于是「模型适配的数据存在哪」这件事**只有读过实现的人才答得出** ——
 * 而它恰恰是迁移数据时第一个要问的问题。
 *
 * 这一层是**纯数据**（无 IO、无 React、无 Node 内建），所以浏览器侧与服务端侧读的是
 * 同一份口径；界面上的那枚图标徽标与「数据存放位置」清单都从这儿取，不会再出现两处
 * 各写一份落点的情况（§12.18 复用优先 · 写之前先查）。
 *
 * **图标按「存放位置类别」配，不按数据种类配**：用户问的是「存在哪儿」，同一个落点上的
 * 数据（模型适配 / 远程模型 / 任务记录……）用的是同一枚图标 —— 这正是界面上那枚徽标
 * 要表达的意思。
 *
 * **「种类」与「位置」是两层**：一种数据可能落在不止一个地方（模式契约既有本机覆盖又有
 * 项目默认；画布既有浏览器索引又有服务端镜像），所以登记项的单位是「一种数据 × 它的
 * 某一个存放位置」，而 `kind` 把它们收回同一类数据下。
 *
 * `target` 与 `migration` 是**界面文案**（不是 Markdown）：落点那一句按等宽字体渲染，
 * 迁移那一句是一句能照着做的话，两者都不带反引号。
 */

import { compareText } from "~/lib/ordered-set";

/**
 * 存放位置的类别：图标按这一层配（用户问的是「存在哪儿」，不是「是哪类数据」）。
 *
 * 这五类就是本应用**实际**用到的全部落点 —— 每一类数据都落在本机的某处（库里 /
 * 应用数据文件 / 项目代码库 / 用户磁盘 / 浏览器存储），应用不把任何数据托管到远端
 * 服务上，所以登记表里没有「远端服务」这一类（不预置「将来可能用到」的位置）。
 */
export type DataLocationCategory =
  | "app-data-file"
  | "browser-storage"
  | "database"
  | "local-disk"
  | "repo-file";

/** 一类存放位置的展示口径：图标 / 名称 / 徽标语义色。 */
export type DataLocationCategoryInfo = {
  /** `~/components/ui/icon` 的图标键。键写错时那枚图标会**静默不渲染**，用例钉着这一点。 */
  icon: string;
  /** 类别名（界面与提示语里说这一类叫什么）。 */
  label: string;
  /** 徽标语义色（`ui/badge` 的 `tone` 轴）：区分「这份数据有多脆」。 */
  tone: "danger" | "neutral" | "primary" | "success" | "warning";
};

/** 数据种类（用户心里的一类数据；同一类可能有多个存放位置，如「模式契约」）。 */
export type DataKind =
  | "app-settings"
  | "appearance"
  | "backup"
  | "database"
  | "llm-config"
  | "log-categories"
  | "mode-contract"
  | "model-adapter"
  | "model-tag"
  | "project-canvas"
  | "remote-model"
  | "sidebar-tab"
  | "task-artifacts"
  | "update-check"
  | "user-account"
  | "workflow-library"
  | "workshop-draft";

/** 一份数据的登记项（= 一种数据 × 它的某一个存放位置）。 */
export type DataLocationEntry = {
  /** 存放位置类别（图标由这一层决定）。 */
  category: DataLocationCategory;
  /** 这一份属于哪类数据。 */
  kind: DataKind;
  /** 数据种类的显示名。 */
  kindLabel: string;
  /** 迁移这一份要走哪几步（悬浮说明与清单里给用户看的那句）。 */
  migration: string;
  /** 具体落点：路径 / 表名 / 目录。 */
  target: string;
};

/** 登记项的 id（= 一种数据 × 它的某一个存放位置）。 */
export type DataLocationId =
  | "app-database"
  | "app-settings"
  | "appearance"
  | "backup-archive"
  | "canvas-browser"
  | "canvas-server"
  | "llm-config"
  | "log-categories"
  | "mode-contract-local"
  | "mode-contract-project"
  | "model-adapter"
  | "model-tag-library"
  | "remote-model"
  | "sidebar-tab-local"
  | "sidebar-tab-project"
  | "task-artifacts-db"
  | "task-artifacts-disk"
  | "update-check"
  | "user-account"
  | "workflow-library-db"
  | "workflow-library-disk"
  | "workshop-draft-browser"
  | "workshop-draft-server";

/** 按存放位置类别分的展示口径 —— 徽标与清单都从这儿取图标。 */
export const DATA_LOCATION_CATEGORIES: Record<DataLocationCategory, DataLocationCategoryInfo> = {
  "app-data-file": {
    icon: "save",
    label: "本机应用数据",
    tone: "neutral",
  },
  "browser-storage": {
    icon: "monitor",
    label: "浏览器存储",
    tone: "danger",
  },
  database: {
    icon: "database",
    label: "数据库",
    tone: "primary",
  },
  "local-disk": {
    icon: "harddrive",
    label: "本机磁盘",
    tone: "warning",
  },
  "repo-file": {
    icon: "foldergit2",
    label: "项目代码库",
    tone: "success",
  },
};

/**
 * 登记本体 —— 「每种数据存在哪儿、迁移时怎么搬」的**唯一事实来源**。
 *
 * 落点与迁移办法都对着实现写，改动落点时必须同批改这里（否则界面会开始说谎）。
 */
export const DATA_LOCATIONS: Record<DataLocationId, DataLocationEntry> = {
  "app-database": {
    category: "database",
    kind: "database",
    kindLabel: "应用数据库",
    migration:
      "整库就是 db.sqlite（路径由 DATABASE_URL 指定）：迁移时先停应用，把 db.sqlite 连同 -wal / -shm 一起拷到新机器的同一路径；走「备份与恢复」的库快照更稳（快照是单文件、不带 WAL）。",
    target: "db.sqlite（DATABASE_URL 指定）",
  },
  "app-settings": {
    category: "app-data-file",
    kind: "app-settings",
    kindLabel: "应用设置",
    migration:
      "这份文件只跟着这台机器走：迁移时把 data/app-settings.json 拷到新机器的同一路径（它记的是 ComfyUI 装在哪、端口、实例目录这类本机事实）。",
    target: "data/app-settings.json",
  },
  appearance: {
    category: "browser-storage",
    kind: "appearance",
    kindLabel: "外观偏好",
    migration:
      "跟着浏览器走：换机器 / 清浏览器数据会回到默认；自定义字体的字体文件在浏览器的 IndexedDB 里，迁移时也要一并导出。",
    target: "浏览器 localStorage（comfyapp:appearance-v1）",
  },
  "backup-archive": {
    category: "app-data-file",
    kind: "backup",
    kindLabel: "数据库备份",
    migration:
      "备份是库的快照，迁移时先在旧机器点「立即备份」，再把 data/backups/ 里的快照拷到新机器的同一目录，在新机器「恢复备份」并重启应用。",
    target: "<应用根>/data/backups/",
  },
  "canvas-browser": {
    category: "browser-storage",
    kind: "project-canvas",
    kindLabel: "项目画布",
    migration:
      "浏览器存储跟着浏览器走、不跟着应用走：换机器要么把旧浏览器的这份数据导过去，要么改用服务端镜像那份；清浏览器数据会连它一起清掉。",
    target: "浏览器 localStorage（comfyapp.canvas.projects.v1 等键）",
  },
  "canvas-server": {
    category: "database",
    kind: "project-canvas",
    kindLabel: "项目画布",
    migration: "服务端镜像在 project 表里，跟着库走（备份 / 恢复库即覆盖它）。",
    target: "project 表",
  },
  "llm-config": {
    category: "database",
    kind: "llm-config",
    kindLabel: "本地模型配置",
    migration:
      "Ollama 的连接地址、默认模型与按任务的温度都记在 llmConfig 表里，跟着库走；在新机器上重新填一次也可以。",
    target: "llmConfig 表",
  },
  "log-categories": {
    category: "browser-storage",
    kind: "log-categories",
    kindLabel: "日志分类",
    migration: "跟着浏览器走：换机器 / 清浏览器数据会回到默认。",
    target: "浏览器 localStorage（comfyapp.logCategories.enabled）",
  },
  "mode-contract-local": {
    category: "app-data-file",
    kind: "mode-contract",
    kindLabel: "模式契约",
    migration:
      "本机覆盖只跟着这台机器走（不入库）：迁移时把 data/workshop-mode-contracts.json 拷到新机器的同一路径，它会盖掉新机器上已有的本机覆盖。",
    target: "data/workshop-mode-contracts.json",
  },
  "mode-contract-project": {
    category: "repo-file",
    kind: "mode-contract",
    kindLabel: "模式契约",
    migration:
      "项目默认入库、跟代码走：迁移就是把这个文件一起提交（src/lib/workshop/mode-contract-defaults.json），别的检出与桌包都是这一份。",
    target: "src/lib/workshop/mode-contract-defaults.json",
  },
  "model-adapter": {
    category: "database",
    kind: "model-adapter",
    kindLabel: "模型适配",
    migration:
      "每条远程模型的工坊字段映射存在 remoteModel 表的 workshopAdapters 列里，跟着库走；换机器时带库，或在新机器重新配一遍字段映射。",
    target: "remoteModel 表：workshopAdapters 列",
  },
  "model-tag-library": {
    category: "database",
    kind: "model-tag",
    kindLabel: "模型标签",
    migration:
      "标签与「标签 ↔ 工作流」的绑定都在 workflowModelTag / workflowModelTag_workflowTemplate 表里，跟着库走：换机器时带库即可。",
    target: "workflowModelTag 表",
  },
  "remote-model": {
    category: "database",
    kind: "remote-model",
    kindLabel: "远程模型与供应商",
    migration:
      "供应商与模型在 llmProvider / remoteModel 表里，跟着库走；API Key 以密文存放，换机器要在新机器上重新填（或用新机器的密钥重新加密）。",
    target: "llmProvider / remoteModel 表",
  },
  "sidebar-tab-local": {
    category: "app-data-file",
    kind: "sidebar-tab",
    kindLabel: "侧栏页签行为",
    migration:
      "本机覆盖只跟着这台机器走：迁移时把 data/sidebar-tab-behavior.json 拷到新机器的同一路径，它会盖掉项目默认那份。",
    target: "data/sidebar-tab-behavior.json",
  },
  "sidebar-tab-project": {
    category: "repo-file",
    kind: "sidebar-tab",
    kindLabel: "侧栏页签行为",
    migration: "项目默认入库、跟代码走：迁移就是把这个文件一起提交，别的检出与桌包都是这一份。",
    target: "src/lib/shell/sidebar-tab-defaults.json",
  },
  "task-artifacts-db": {
    category: "database",
    kind: "task-artifacts",
    kindLabel: "任务与产物",
    migration: "任务记录与产物索引在 task / taskImage 表里，跟着库走。",
    target: "task / taskImage 表",
  },
  "task-artifacts-disk": {
    category: "local-disk",
    kind: "task-artifacts",
    kindLabel: "任务与产物",
    migration:
      "产物的字节在 generated/ 目录里，库里只存路径：迁移要单独把整个 generated/ 目录拷过去（否则记录还在、图没了）。",
    target: "<应用根>/generated/",
  },
  "update-check": {
    category: "browser-storage",
    kind: "update-check",
    kindLabel: "更新检测偏好",
    migration: "本地偏好存在浏览器的 localStorage 里：换机器 / 清浏览器数据会回到默认（开）。",
    target: "浏览器 localStorage（更新检测开关）",
  },
  "user-account": {
    category: "database",
    kind: "user-account",
    kindLabel: "账号与会话",
    migration:
      "账号、登录态与会话在 user / account / session 表里，跟着库走；换机器后旧会话失效、需重新登录。",
    target: "user / account / session 表",
  },
  "workflow-library-db": {
    category: "database",
    kind: "workflow-library",
    kindLabel: "工作流库",
    migration: "导入后的工作流记录在 workflowTemplate 表里，跟着库走。",
    target: "workflowTemplate 表",
  },
  "workflow-library-disk": {
    category: "local-disk",
    kind: "workflow-library",
    kindLabel: "工作流库",
    migration:
      "工作流的原件在用户自己配的目录（LOCAL_WORKFLOWS_PATH / ComfyUI 的 workflows 目录）里：迁移要把那个目录整个拷过去，并在新机器重新指到同一目录，否则只有记录没有原件。",
    target: "LOCAL_WORKFLOWS_PATH / ComfyUI workflows 目录",
  },
  "workshop-draft-browser": {
    category: "browser-storage",
    kind: "workshop-draft",
    kindLabel: "工坊草稿",
    migration:
      "草稿先落在浏览器 localStorage 里，跟着浏览器走：清浏览器数据会清掉它，重要草稿等服务端镜像写回后再清。",
    target: "浏览器 localStorage",
  },
  "workshop-draft-server": {
    category: "database",
    kind: "workshop-draft",
    kindLabel: "工坊草稿",
    migration: "草稿的服务端镜像在 workshopDraft 表里，跟着库走。",
    target: "workshopDraft 表",
  },
};

/** 一类数据的登记项集合（「数据存放位置」清单按它分组渲染）。 */
export type DataLocationGroup = {
  /** 数据种类。 */
  kind: DataKind;
  /** 数据种类的显示名。 */
  kindLabel: string;
  /** 这一类数据占用的存放位置（每一项带自己的登记项 id 与落点）。 */
  locations: Array<{ entry: DataLocationEntry; id: DataLocationId }>;
};

/**
 * 判据：这个字符串是不是一个已登记的存放位置 id。
 *
 * 用它而不是 `as` 断言：断言只是把「可能不存在」说成「一定存在」，登记本体增删
 * 条目时那一侧不会跟着红 —— 于是「取到了 undefined 却当成有值」这类失效会一路
 * 流到界面上（徽标不画、总表少一行）。
 */
export function isDataLocationId(value: string): value is DataLocationId {
  return Object.hasOwn(DATA_LOCATIONS, value);
}

/** 判据：这个字符串是不是一个已登记的存放位置类别（同上，不用断言收窄）。 */
export function isDataLocationCategory(value: string): value is DataLocationCategory {
  return Object.hasOwn(DATA_LOCATION_CATEGORIES, value);
}

/**
 * 把登记本体按「数据种类」分组，供清单视图渲染。
 *
 * 分组顺序 = 种类名按当前区域设置的字典序（走 `~/lib/ordered-set` 的 `compareText`，
 * 别处不另写一份 `localeCompare`）；组内按落点类别名排 —— 同一类数据的那几行因此
 * 读起来是「同一个地方的不同份」，而不是随机顺序。
 */
export function listDataLocationGroups(): Array<DataLocationGroup> {
  const groups = new Map<DataKind, DataLocationGroup>();
  for (const id of Object.keys(DATA_LOCATIONS).filter(isDataLocationId)) {
    const entry = DATA_LOCATIONS[id];
    const existing = groups.get(entry.kind);
    if (existing === undefined) {
      groups.set(entry.kind, {
        kind: entry.kind,
        kindLabel: entry.kindLabel,
        locations: [{ entry, id }],
      });
      continue;
    }
    existing.locations.push({ entry, id });
  }
  const list = [...groups.values()];
  for (const group of list) {
    group.locations.sort((left, right) =>
      compareText(
        DATA_LOCATION_CATEGORIES[left.entry.category].label,
        DATA_LOCATION_CATEGORIES[right.entry.category].label,
      ),
    );
  }
  return list.sort((left, right) => compareText(left.kindLabel, right.kindLabel));
}
