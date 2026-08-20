import MarkdownIt from "markdown-it";
import cjkFriendly from "markdown-it-cjk-friendly";
import { highlightCode } from "./highlight";

// html:false で生 HTML をエスケープ（信頼できるローカルデータだが安全側に倒す）。
// linkify はしない（webview がリンク先へ遷移してしまうのを避け、リンクは明示記法のみ）。
const md = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: true,
  highlight: (str, lang) => `<pre class="md-code hljs-diff"><code>${highlightCode(str, lang || "")}</code></pre>`,
});

// CommonMark の flanking 規則は CJK 句読点・仮名に隣接する **強調** を閉じられず、
// 日本語を挟んだ **太字** が素通りする。CJK 文字を強調区切りとして扱えるようパッチする。
md.use(cjkFriendly);

export function renderMarkdown(src: string): string {
  return md.render(src);
}
