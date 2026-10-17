import { readFile, rename, stat, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import { parse } from "parse5";
import { renderChatMarkdown } from "./chat-messages.js";

const BLOCK_ID = "lavish-review-comments";
const DATA_ID = "lavish-review-data";

function escape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function descendants(node) {
  return [node, ...(node.childNodes || []).flatMap(descendants)];
}

function attr(node, name) {
  return (node.attrs || []).find((item) => item.name === name)?.value || "";
}

// Resolve only the selector forms emitted by the annotation SDK. Unsupported selectors retain
// their verbatim selected context, without inventing a source link or matching by text alone.
function sourceNode(nodes, selector) {
  const parts = String(selector || "").split(/\s*>\s*/);
  function matches(node, part) {
    const match = /^([a-z][\w-]*)?(?:#([\w-]+))?(?::nth-of-type\((\d+)\))?$/i.exec(part);
    if (!match || (!match[1] && !match[2])) return false;
    if (match[1] && node.tagName !== match[1].toLowerCase()) return false;
    if (match[2] && attr(node, "id") !== match[2]) return false;
    if (match[3]) {
      const siblings = (node.parentNode?.childNodes || []).filter((item) => item.tagName === node.tagName);
      if (siblings.indexOf(node) + 1 !== Number(match[3])) return false;
    }
    return true;
  }
  const found = nodes.filter((node) => {
    let current = node;
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      if (!current || !matches(current, parts[index])) return false;
      current = current.parentNode;
    }
    return true;
  });
  return found.length === 1 ? found[0] : null;
}

function entryKey(entry) {
  return entry.prompt_id || entry.message_id || JSON.stringify([entry.role, entry.at, entry.text]);
}

function visualFrame(html, question) {
  // Self-contained widgets may run inline scripts, but cannot access the parent, network,
  // cookies, popups, forms, or top-level navigation. This also works in an exported local file.
  const policy =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
  const doc =
    '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
    policy +
    '"><style>body{font:16px system-ui;margin:20px;color:#20251f}*{box-sizing:border-box}img,svg{max-width:100%}</style></head><body>' +
    html +
    "</body></html>";
  return (
    '<div class="lavish-review-visual"><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="Visual answer: ' +
    escape(question) +
    '" srcdoc="' +
    escape(doc) +
    '"></iframe></div>'
  );
}

export function updateDocumentComments(html, incoming) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const nodes = descendants(document);
  const block = nodes.find((node) => attr(node, "id") === BLOCK_ID);
  const data = nodes.find((node) => attr(node, "id") === DATA_ID);
  let previous = [];
  if (data) previous = JSON.parse((data.childNodes || []).map((node) => node.value || "").join(""));
  const entries = new Map(previous.map((entry) => [entryKey(entry), entry]));
  for (const entry of incoming) {
    const id = entryKey(entry);
    entries.set(id, { ...entries.get(id), ...entry });
  }
  const all = [...entries.values()];
  const questions = all.filter((entry) => entry.role === "user" && entry.prompt_id);
  if (!questions.length) return html;
  const edits = [];
  const reserved = new Set(nodes.map((node) => attr(node, "id")).filter(Boolean));
  const sourceIds = new Map();
  for (const question of questions) {
    const previousSourceId = question.source_id;
    delete question.source_id;
    const target = previousSourceId
      ? nodes.find((node) => attr(node, "id") === previousSourceId)
      : sourceNode(nodes, question.source_selector || question.anchor?.selector);
    if (!target || !target.sourceCodeLocation?.startTag || (block && descendants(block).includes(target))) continue;
    let id = attr(target, "id");
    if (!id) {
      const existing = sourceIds.get(target);
      if (existing) id = existing;
      else {
        id = "lavish-source-" + question.prompt_id;
        while (reserved.has(id)) id += "-ref";
        reserved.add(id);
        sourceIds.set(target, id);
        const offset = target.sourceCodeLocation.startTag.endOffset - 1;
        edits.push({ start: offset, end: offset, text: ' id="' + escape(id) + '"' });
      }
    }
    question.source_id = id;
    const hasReference = nodes.some((node) => attr(node, "data-lavish-comment-ref") === question.prompt_id);
    if (
      !hasReference &&
      target.sourceCodeLocation.endTag &&
      !["html", "body", "head", "script", "style", "table", "tr", "thead", "tbody", "svg"].includes(target.tagName) &&
      target.namespaceURI === "http://www.w3.org/1999/xhtml"
    ) {
      const offset = target.sourceCodeLocation.endOffset;
      edits.push({
        start: offset,
        end: offset,
        text:
          '<a data-lavish-comment-ref="' +
          escape(question.prompt_id) +
          '" href="#lavish-comment-' +
          escape(question.prompt_id) +
          '" title="' +
          escape(question.text) +
          '">Review comment</a>',
      });
    }
  }
  const threads = questions
    .map((question) => {
      const replies = all.filter((entry) => entry.role === "agent" && entry.reply_to === question.prompt_id);
      const context = question.source_text || question.anchor?.excerpt || "";
      return (
        '<article class="lavish-review-thread" id="lavish-comment-' +
        escape(question.prompt_id) +
        '"><header><strong>Your comment</strong>' +
        (question.source_id ? '<a href="#' + escape(question.source_id) + '">View source passage</a>' : "") +
        "</header>" +
        (context ? "<blockquote>" + escape(context) + "</blockquote>" : "") +
        '<p class="lavish-review-question">' +
        escape(question.text) +
        "</p>" +
        (replies.length
          ? replies
              .map(
                (reply) =>
                  '<section class="lavish-review-answer"><strong>Answer</strong>' +
                  renderChatMarkdown(reply.text) +
                  (reply.visual_html ? visualFrame(reply.visual_html, question.text) : "") +
                  "</section>",
              )
              .join("")
          : '<p class="lavish-review-waiting">Awaiting answer</p>') +
        "</article>"
      );
    })
    .join("");
  const content =
    '<section id="' +
    BLOCK_ID +
    '" aria-label="Review comments"><style>a[data-lavish-comment-ref]{display:inline-block;font:12px system-ui;color:#624d1d;background:#fff4ce;border:1px solid #cfb36b;border-radius:6px;padding:4px 8px;margin:4px;text-decoration:none}#lavish-review-comments{font:16px/1.55 system-ui;color:#20251f;background:#faf8f3;padding:clamp(20px,4vw,48px);margin:40px auto;max-width:1000px;box-sizing:border-box;text-align:left}#lavish-review-comments *{box-sizing:border-box;min-width:0}#lavish-review-comments .lavish-review-thread{border:1px solid #cbd4ca;border-radius:12px;background:white;padding:24px;margin:20px 0;overflow-wrap:anywhere}#lavish-review-comments header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}#lavish-review-comments a{color:#376346}#lavish-review-comments blockquote{border-left:3px solid #b99a42;margin:16px 0;padding:8px 16px;color:#525b52;white-space:pre-wrap}#lavish-review-comments .lavish-review-question{white-space:pre-wrap;font-weight:600}#lavish-review-comments .lavish-review-answer{border-top:1px solid #dce2da;padding-top:18px;margin-top:18px}#lavish-review-comments .lavish-review-waiting{color:#697368}#lavish-review-comments .lavish-review-visual{height:420px;min-height:180px;resize:vertical;overflow:hidden;border:1px solid #cbd4ca;border-radius:8px}#lavish-review-comments iframe{display:block;width:100%;height:100%;border:0}#lavish-review-comments pre{overflow:auto}#lavish-review-comments :target{outline:2px solid #b99a42;outline-offset:3px}</style><h2>Review comments</h2>' +
    threads +
    '<script type="application/json" id="' +
    DATA_ID +
    '">' +
    JSON.stringify(all).replace(/</g, "\\u003c") +
    "</script></section>";
  if (block?.sourceCodeLocation)
    edits.push({ start: block.sourceCodeLocation.startOffset, end: block.sourceCodeLocation.endOffset, text: content });
  else {
    const body = nodes.find((node) => node.tagName === "body");
    const offset = body?.sourceCodeLocation?.endTag?.startOffset ?? html.length;
    edits.push({ start: offset, end: offset, text: "\n" + content + "\n" });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
  return html;
}

export async function persistDocumentComments(file, entries) {
  const original = await readFile(file, "utf8");
  const next = updateDocumentComments(original, entries);
  if (next === original) return;
  const mode = (await stat(file)).mode;
  const temporary = file + ".lavish-" + crypto.randomUUID() + ".tmp";
  await writeFile(temporary, next, { mode });
  // Avoid overwriting an agent's simultaneous source edit. A failed write leaves a recoverable
  // temp file and refuses acknowledgement, so the reviewer's queued note remains available.
  if ((await readFile(file, "utf8")) !== original)
    throw new Error("Document changed while saving comments; retry the send");
  await rename(temporary, file);
}
