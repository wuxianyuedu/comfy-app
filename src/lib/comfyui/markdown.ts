/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * 轻量的 markdown → 安全 HTML 渲染器，服务于 ComfyUI 的便签正文。
 *
 * 覆盖范围（刚好够让 z_image_int8 的 `Note: Model Links` 看着正常）：
 *   - ## ### #### 标题（h2 / h3 / h4）
 *   - 围栏 ``` 代码块     → <pre><code>
 *   - 行内 `code`         → <code>
 *   - **粗体**、*斜体*、__下划线__
 *   - [文字](链接)        → <a href="…" target="_blank" rel="noreferrer">
 *   - - / * 列表项        → 连续的 <li>，外面包 <ul>
 *   - > 引用块            → <blockquote>
 *   - 水平分隔线 --- / ***
 *   - GFM 风格表格        → <table><thead>…<tbody>…；判据是 `| … |` 的表头行
 *     后面紧跟一行 `| --- | --- |` 分隔行
 *   - 白名单内的行内 HTML：<br>、<b>、<strong>、<i>、<em>、<u>、<s>、
 *     <del>、<mark>、<small>、<sub>、<sup>、<kbd>。其余一律保持转义
 *     （例如 <script>、<iframe>、<a href="javascript:…">）
 *
 * 不在范围内：图片、脚注、HTML 透传、子列表、用 `:---:` / `---:` / `:---`
 * 表达的对齐（我们一律左对齐）。
 *
 * 输出是 XSS 安全的：整份输入先做 HTML 转义，随后只拼回**我们自己生成**的标签
 * （markdown 的那批 + 白名单 HTML 集合）。链接 href 会按 URL scheme 白名单核对
 * （`http://`、`https://`、`mailto:`、绝对路径或相对路径）。
 */

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** 转义任何要输出成 HTML 的文本。 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (char) => HTML_ESCAPE[char] ?? char);
}

/** 输出 <a href="…"> 之前先校验 URL。禁掉 javascript: 及其它可执行的 scheme。 */
function safeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // 允许：http(s)、mailto、相对 / 绝对路径
  if (/^(https?:|mailto:|\/|#)/i.test(trimmed)) return trimmed;
  // 只有裸主机名、没有 scheme → 当成 https
  if (/^[\w-]+(\.[\w-]+)+/.test(trimmed) && !/[\s"'<>]/.test(trimmed))
    return "https://" + trimmed;
  return null;
}

/** 把一段 markdown 文本渲染成已消毒的 HTML。 */
export function markdownToHtml(text: string): string {
  if (!text) return "";
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // 围栏代码块（``` … ```）
    const fence = /^```/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        code.push(lines[i]!);
        i++;
      }
      i++; // skip closing ```
      out.push(
        `<pre style="background:var(--color-md-code-bg);border:1px solid var(--color-md-border);border-radius:4px;padding:6px 8px;margin:6px 0;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;line-height:1.45;"><code>${escapeHtml(
          code.join("\n"),
        )}</code></pre>`,
      );
      continue;
    }

    // Heading (#### h4, ### h3, ## h2)
    const heading = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const txt = renderInline(escapeHtml(heading[2]!));
      const sizes = ["18px", "16px", "14px", "12.5px"];
      out.push(
        `<h${level + 1} style="font-weight:700;margin:8px 0 4px;font-size:${sizes[level - 1]!};color:var(--color-ink-bright);">${txt}</h${level + 1}>`,
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(\*\*\*|---|___)\s*$/.test(line)) {
      out.push(
        '<hr style="border:none;border-top:1px solid var(--color-md-border);margin:8px 0;">',
      );
      i++;
      continue;
    }

    // 引用块：把连续的 `> …` 行归到一起
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        body.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      out.push(
        `<blockquote style="border-left:3px solid var(--color-md-quote-border);padding:2px 0 2px 8px;margin:6px 0;color:var(--color-ink-soft);">${renderInline(
          escapeHtml(body.join("\n")),
        )}</blockquote>`,
      );
      continue;
    }

    // GFM 表格：表头行 `| a | b | … |` 后面紧跟一行分隔行
    //  `| --- | :--- | ---: | … |`。
    //  判据：某行含至少一个 `|`，且它的下一行是分隔行；
    //  该行前面那一行（若也以 `|` 开头）就是表头。
    //  表体行一直收到空行或非管道行为止。
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1]!)
    ) {
      // 往回挪一行把表头捞进来，以防调用方的解析器
      // 递给我们的片段是从表格中间开始的。
      let headerIdx = i;
      while (
        headerIdx > 0 &&
        lines[headerIdx - 1]!.includes("|") &&
        !isTableSeparator(lines[headerIdx - 1]!)
      ) {
        headerIdx--;
      }
      const headerCells = splitRow(lines[headerIdx]!);
      const sepCells = splitRow(lines[headerIdx + 1]!);
      const bodyRows: string[][] = [];
      let j = headerIdx + 2;
      while (
        j < lines.length &&
        lines[j]!.includes("|") &&
        !isTableSeparator(lines[j]!)
      ) {
        bodyRows.push(splitRow(lines[j]!));
        j++;
      }
      out.push(renderTable(headerCells, bodyRows, sepCells));
      i = j;
      continue;
    }

    // 无序列表：把连续的 `-` / `*` 行归到一起
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push(
        `<ul style="margin:4px 0 4px 18px;padding:0;list-style-type:disc;">${items
          .map(
            (it) =>
              `<li style="margin:2px 0;">${renderInline(escapeHtml(it))}</li>`,
          )
          .join("")}</ul>`,
      );
      continue;
    }

    // 空行 → 段落分隔
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 默认段落 —— 收拢连续行并做行内渲染
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^(#{1,4}\s|```|>\s?|\*\*\*|---|___|[-*]\s+)/.test(lines[i]!) &&
      !(
        lines[i]!.includes("|") &&
        i + 1 < lines.length &&
        isTableSeparator(lines[i + 1]!)
      )
    ) {
      para.push(lines[i]!);
      i++;
    }
    out.push(
      `<p style="margin:4px 0;line-height:1.5;">${renderInline(escapeHtml(para.join("\n")))}</p>`,
    );
  }

  return out.join("");
}

/** 对已经转义过的字符串做行内替换（粗体、斜体、代码、链接、安全 HTML）。
 *  必须在 escapeHtml **之后**跑 —— 用户输入才是 XSS 安全的；
 *  这里只识别我们认得、并且知道怎么转换的「已转义」markdown / 安全 HTML 标记。 */
function renderInline(escapedText: string): string {
  // 1) Inline code: `…` — 先整段替换掉，正文暂存进 `codeStash`，字面量里只留
  //   一个「数字 id」。这里的**关键前提是：本条替换是 `renderInline` 的第一步**，
  //   下面的安全 HTML / 链接 / 粗体 / 斜体 / 下划线都跑在它之后，因此它们那几组
  //   正则面对的是一份**已经没有反引号**的文本 —— 正文自己带的 `*` `_` `[` `&lt;`
  //   不会再被二次解释，这正是「` `<br>` ` 渲染成字面量 `<br>` 而不是真的换行」
  //   的成因。判据一句话：**「接下来跑的正则能不能看到代码正文」**。
  //
  //   历史上这里用 NUL（`\0`）把 id 包成 `\0CODE<n>\0`，理由是「没有别的正则
  //   会碰 NUL」。这理由站不住、代价却很大：源码里嵌一个真的 NUL 字节会让整个
  //   文件被 git / diff / grep / 大多数编辑器判成**二进制文件** —— `git diff`
  //   只回一句「Binary files differ」，评审看不到改动，`grep -rn` 直接跳过不搜。
  //   按「规则要机器可判」的口径，`<数字 id>` 与 NUL 是**同构**的：id 串里既没有
  //   反引号、也没有 `*` `_` `[` `&lt;`，上面那几组正则一个都命中不了。
  //   论证与门禁见 docs/standards/12-代码组织与文件结构.md §12.11。
  const codeStash: string[] = [];
  let text = escapedText.replace(/`([^`]+?)`/g, (_, c) => {
    const idx = codeStash.length;
    codeStash.push(
      `<code style="background:var(--color-md-inline-code-bg);border:1px solid var(--color-md-border);padding:0 3px;border-radius:3px;font-size:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${c}</code>`,
    );
    return `<${idx}>`;
  });

  // 2) 白名单行内 HTML —— 只作用于非代码文本：便签正文里写的 <br>
  //   会变成真正的换行，而反引号里捕获到的 <br> 原样不动（保持转义）。
  text = renderSafeInlineHtml(text);
  // 3) 链接 [文字](链接) —— 文字部分已经是转义形态，& 等都处理过了
  text = text.replace(/\[([^\]]+?)\]\(([^)\s]+)\)/g, (_, txt, url) => {
    const safe = safeHref(url);
    if (!safe) return txt;
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer" style="color:var(--color-md-link);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px;">${txt}</a>`;
  });
  // 4) Bold **…**  → <strong>
  text = text.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  // 5) 斜体 *…* → <em>（不能把已被粗体消费掉的成对星号再吞一遍）
  text = text.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  // 6) Underline __…__
  text = text.replace(/__([^_]+?)__/g, "<u>$1</u>");
  // 7) 还原前面暂存起来的代码片段。
  text = text.replace(/<(\d+)>/g, (_, idx) => codeStash[Number(idx)]!);
  return text;
}

/** 我们愿意反向转义的**白名单**行内 HTML 元素。
 *  其余一律保持转义（包括 <script>、<iframe>、<a>、<style>、on*= 属性等）。
 *  键是小写的规范标签名；值是包裹型标签的 [开标签, 闭标签]，
 *  或自闭合空元素的单字符串哨兵。 */
const SAFE_INLINE_HTML: Record<string, readonly [string, string] | string> = {
  br: "<br />", // void element — <br>, <br/>, <br /> all → <br />
  b: ["<b>", "</b>"],
  strong: ["<strong>", "</strong>"],
  i: ["<i>", "</i>"],
  em: ["<em>", "</em>"],
  u: ["<u>", "</u>"],
  s: ["<s>", "</s>"],
  del: ["<del>", "</del>"],
  mark: ["<mark>", "</mark>"],
  small: ["<small>", "</small>"],
  sub: ["<sub>", "</sub>"],
  sup: ["<sup>", "</sup>"],
  kbd: ["<kbd>", "</kbd>"],
};

/** 把白名单行内 HTML 的**已转义**形态（&lt;…&gt;）还原成真标签。
 *  在 escapeHtml **之后**跑，因此输入里是 `&lt;br&gt;` 而不是原始的 `<br>`。
 *  不在白名单里的一律保持转义，输出因此始终是 XSS 安全的。 */
function renderSafeInlineHtml(escapedText: string): string {
  // 先处理自闭合的空元素。匹配 `<br>`、`<br/>`、`<br />`，

  //  以及它们的大写变体 —— 但只针对白名单里的标签。

  let text = escapedText.replace(
    /&lt;\s*([A-Za-z][A-Za-z0-9]*)\s*\/?\s*&gt;/g,

    (whole, tag) => {
      const key = tag.toLowerCase();

      const entry = SAFE_INLINE_HTML[key];

      if (typeof entry === "string") return entry; // self-closing

      return whole; // wrapping tag — handled by the next pass
    },
  );

  // 包裹型标签：<b>…</b>、<strong>…</strong>、<em>…</em> 等。

  text = text.replace(
    /&lt;\s*(\/?)\s*([A-Za-z][A-Za-z0-9]*)\s*&gt;/g,

    (whole, slash, tag) => {
      const key = tag.toLowerCase();

      const entry = SAFE_INLINE_HTML[key];

      if (typeof entry !== "object") return whole; // not a wrapping tag we know

      return slash ? entry[1] : entry[0];
    },
  );

  return text;
}

/** 给调用方的一个顺手助手：渲染成可直接用于
 *  `dangerouslySetInnerHTML`. */
export function renderMarkdown(text: string): string {
  return markdownToHtml(text);
}

/* ──────────────────────────────────────────────────────────────────────
 * GFM 表格助手
 * ────────────────────────────────────────────────────────────────────── */

/** 表格分隔行形如 `| --- | :--- | ---: | :---: | …` ——
 *  由一个或多个「横线 / 冒号」单元格组成，彼此用 `|` 隔开。
 *  刻意允许首尾空白与任意单元格宽度。 */
function isTableSeparator(line: string): boolean {
  if (!line?.includes("|")) return false;
  const cells = splitRow(line);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/** 把 `| a | b | c |` 这样的一行拆成单元格。两侧管道符造成的首尾空单元格
 *  会被丢掉 —— 与 GFM 的行为一致（`|a|b|` 拆出 2 个而不是 4 个）。 */
function splitRow(line: string): string[] {
  let trimmed = line.trim();
  // 各剥掉一个首尾管道符，拆出来的单元格里才不会多出幽灵空项。
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  if (!trimmed) return [];
  return trimmed.split("|").map((col) => col.trim());
}

/** 把解析好的表格渲染成 HTML。单元格内容仍会过一遍 `renderInline`，
 *  因此 **粗体**、`代码`、[链接] 在单元格里都生效。
 *  我们一律左对齐 —— 分隔行里的对齐冒号为了解析兼容会被接受，
 *  但视觉上不予兑现。 */
function renderTable(
  headerCells: string[],
  bodyRows: string[][],
  sepCells: string[],
): string {
  const colCount = Math.max(
    headerCells.length,
    sepCells.length,
    ...bodyRows.map((bodyRow) => bodyRow.length),
  );
  const padCell = (c: string | undefined) => c ?? "";
  const head = headerCells
    .map(
      (headerCell) =>
        `<th style="padding:4px 8px;border:1px solid var(--color-md-border);background:var(--color-md-inline-code-bg);font-weight:600;color:var(--color-ink-bright);text-align:left;vertical-align:top;">${renderInline(escapeHtml(padCell(headerCell)))}</th>`,
    )
    .join("");
  const rows = bodyRows
    .map((row) => {
      const cells: string[] = [];
      for (let k = 0; k < colCount; k++) {
        cells.push(
          `<td style="padding:4px 8px;border:1px solid var(--color-md-border);color:var(--color-ink-subtle);text-align:left;vertical-align:top;">${renderInline(
            escapeHtml(padCell(row[k])),
          )}</td>`,
        );
      }
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");
  return (
    `<table style="border-collapse:collapse;margin:6px 0;width:100%;font-size:11px;line-height:1.45;">` +
    `<thead><tr>${head}</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>`
  );
}
