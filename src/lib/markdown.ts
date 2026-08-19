import MarkdownIt from "markdown-it";
import { highlightCode } from "./highlight";

// html:false で生 HTML をエスケープ（信頼できるローカルデータだが安全側に倒す）。
// linkify はしない（webview がリンク先へ遷移してしまうのを避け、リンクは明示記法のみ）。
const md = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: true,
  highlight: (str, lang) => `<pre class="md-code hljs-diff"><code>${highlightCode(str, lang || "")}</code></pre>`,
});

export function renderMarkdown(src: string): string {
  return md.render(src);
}
