import { readFile, rename, stat, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import { parse } from "parse5";
import { renderChatMarkdown } from "./chat-messages.js";

const BLOCK_ID = "lavish-review-comments";
const DATA_ID = "lavish-review-data";

const COMMENT_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-3 3V11.5a9 9 0 0 1 18 0Z"/><path d="M7 10h8M7 14h5"/></svg>';
const CLOSE_ICON =
  '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8"/></svg>';
const COMMENT_STYLES = `
button[data-lavish-comment-ref] { all: unset; box-sizing: border-box; display: inline-flex; vertical-align: middle; align-items: center; justify-content: center; width: 25px; height: 25px; margin: 0 0 0 7px; border: 1px solid #dfe5dc; border-radius: 50%; background: #f2f6ef; color: #72846a; cursor: pointer; transition: background .15s, color .15s; }
button[data-lavish-comment-ref]:hover { background: #e7efdf; color: #425e38; }
button[data-lavish-comment-ref]:focus-visible { outline: 2px solid #9cac8f; outline-offset: 3px; }
#lavish-review-comments { display: contents; }
#lavish-review-comments .lavish-review-thread { box-sizing: border-box; position: fixed; inset: auto 20px 20px auto; margin: 0; width: min(380px, calc(100vw - 32px)); max-height: min(560px, calc(100dvh - 40px)); overflow: auto; padding: 18px; border: 1px solid #e0e3dc; border-radius: 18px; background: #fffefa; color: #30372e; box-shadow: 0 8px 36px #23301b18, 0 2px 6px #23301b08; font: 13px/1.5 system-ui; text-align: left; overflow-wrap: anywhere; }
#lavish-review-comments .lavish-review-thread::backdrop { background: transparent; }
#lavish-review-comments .lavish-review-thread * { box-sizing: border-box; min-width: 0; }
#lavish-review-comments .lavish-review-thread header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; font: 12px system-ui; color: #8a9185; }
#lavish-review-comments .lavish-review-thread header span { margin-right: auto; }
#lavish-review-comments a { color: #7b896f; font-size: 11px; text-decoration: none; }
#lavish-review-comments a:hover { text-decoration: underline; }
#lavish-review-comments .lavish-review-close { all: unset; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; color: #8a9185; }
#lavish-review-comments .lavish-review-close:hover { background: #f0f1eb; }
#lavish-review-comments .lavish-review-close:focus-visible { outline: 2px solid #9cac8f; }
#lavish-review-comments .lavish-review-person { display: flex; gap: 7px; align-items: center; margin: 12px 0 6px; color: #7b8276; font-size: 11px; }
#lavish-review-comments .lavish-review-avatar { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: #f4ead8; color: #a48b60; font: 10px system-ui; }
#lavish-review-comments .lavish-review-avatar.agent { background: #e8eee1; color: #728963; }
#lavish-review-comments .lavish-review-question { margin: 0 0 0 27px; padding: 10px 12px; border-radius: 4px 13px 13px 13px; background: #f8f2e8; color: #6b5d48; white-space: pre-wrap; font-weight: 400; }
#lavish-review-comments .lavish-review-answer { margin: 0 0 10px 27px; padding: 10px 12px; background: #eef3e8; border-radius: 4px 13px 13px 13px; color: #405037; }
#lavish-review-comments .lavish-review-answer p { margin: 0 0 8px; font: inherit; }
#lavish-review-comments .lavish-review-answer p:last-child { margin-bottom: 0; }
#lavish-review-comments .lavish-review-context { margin: 12px 0 0 27px; font-size: 11px; color: #8a9185; }
#lavish-review-comments .lavish-review-context summary { cursor: pointer; }
#lavish-review-comments blockquote { margin: 6px 0; padding: 4px 8px; border-left: 2px solid #dadfd3; color: #8a9185; white-space: pre-wrap; }
#lavish-review-comments .lavish-review-waiting { margin: 14px 0 0 27px; font-size: 11px; color: #92998a; }
#lavish-review-comments .lavish-review-visual { height: 220px; min-height: 160px; resize: vertical; overflow: hidden; border: 1px solid #e0e7d8; border-radius: 10px; margin-top: 10px; background: #fff; }
#lavish-review-comments iframe { display: block; width: 100%; height: 100%; border: 0; }
#lavish-review-comments pre { overflow: auto; }
#lavish-review-comments .lavish-review-dock { position: fixed; right: 18px; bottom: 18px; display: flex; align-items: center; gap: 6px; border: 1px solid #dfe5dc; border-radius: 20px; padding: 8px 11px; background: #fffefa; color: #72846a; font: 12px system-ui; cursor: pointer; }
#lavish-review-comments .lavish-review-index-item { display: block; width: 100%; padding: 10px; margin: 5px 0; text-align: left; font: inherit; color: inherit; background: #f3f5ee; border: 0; border-radius: 10px; cursor: pointer; }
@supports (top: anchor(bottom)) { #lavish-review-comments .lavish-review-thread[data-anchored] { inset: auto; position-area: bottom span-right; align-self: start; justify-self: start; max-height: min(560px, calc(100% - 24px)); margin: 10px 0 0; position-try-order: most-height; position-try-fallbacks: flip-inline, flip-block; } }
@media (max-width: 480px) { #lavish-review-comments .lavish-review-thread[data-anchored] { position-area: none; inset: auto 16px 16px; margin: 0; width: calc(100vw - 32px); max-height: calc(100dvh - 32px); } }
`;

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
  const blockNodes = new Set(block ? descendants(block) : []);
  for (const node of nodes) {
    if (attr(node, "data-lavish-comment-ref") && !blockNodes.has(node) && node.sourceCodeLocation) {
      edits.push({ start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset, text: "" });
    }
  }
  const reserved = new Set(nodes.map((node) => attr(node, "id")).filter(Boolean));
  const sourceIds = new Map();
  for (const question of questions) {
    const previousSourceId = question.source_id;
    delete question.has_bubble;
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
    if (
      target.sourceCodeLocation.endTag &&
      !["html", "body", "head", "script", "style", "table", "tr", "thead", "tbody", "svg"].includes(target.tagName) &&
      target.namespaceURI === "http://www.w3.org/1999/xhtml"
    ) {
      const interactive = ["a", "button", "summary", "label", "select", "textarea"].includes(target.tagName);
      const offset = interactive ? target.sourceCodeLocation.endOffset : target.sourceCodeLocation.endTag.startOffset;
      question.has_bubble = true;
      edits.push({
        start: offset,
        end: offset,
        text:
          '<button type="button" data-lavish-action="comment" data-lavish-comment-ref="' +
          escape(question.prompt_id) +
          '" popovertarget="lavish-comment-' +
          escape(question.prompt_id) +
          '" style="anchor-name:--lavish-comment-' +
          escape(question.prompt_id) +
          '" aria-label="Open comment: ' +
          escape(question.text) +
          '">' +
          COMMENT_ICON +
          "</button>",
      });
    }
  }
  const threads = questions
    .map((question) => {
      const id = "lavish-comment-" + question.prompt_id;
      const replies = all.filter((entry) => entry.role === "agent" && entry.reply_to === question.prompt_id);
      const context = question.source_text || question.anchor?.excerpt || "";
      const close =
        '<button class="lavish-review-close" type="button" data-lavish-action="comment" popovertarget="' +
        escape(id) +
        '" popovertargetaction="hide" aria-label="Close comment">' +
        CLOSE_ICON +
        "</button>";
      return (
        '<article class="lavish-review-thread" id="' +
        escape(id) +
        '" popover="auto"' +
        (question.has_bubble
          ? ' data-anchored style="position-anchor:--lavish-comment-' + escape(question.prompt_id) + '"'
          : "") +
        ' aria-label="Comment: ' +
        escape(question.text) +
        '"><header><span>Comment</span>' +
        (question.source_id ? '<a href="#' + escape(question.source_id) + '">Show passage</a>' : "") +
        close +
        '</header><div class="lavish-review-person"><span class="lavish-review-avatar">Y</span>You</div><p class="lavish-review-question">' +
        escape(question.text) +
        "</p>" +
        (context
          ? '<details class="lavish-review-context"><summary>On selected text</summary><blockquote>' +
            escape(context) +
            "</blockquote></details>"
          : "") +
        (replies.length
          ? replies
              .map(
                (reply) =>
                  '<div class="lavish-review-person"><span class="lavish-review-avatar agent">A</span>Agent</div><section class="lavish-review-answer">' +
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
  const unanchored = questions.some((question) => !question.has_bubble);
  const index = unanchored
    ? '<button class="lavish-review-dock" type="button" data-lavish-action="comment" popovertarget="lavish-comment-index" aria-label="Open document comments">' +
      COMMENT_ICON +
      "<span>" +
      questions.length +
      '</span></button><div class="lavish-review-thread" id="lavish-comment-index" popover="auto"><header><span>Comments</span><button class="lavish-review-close" type="button" data-lavish-action="comment" popovertarget="lavish-comment-index" popovertargetaction="hide" aria-label="Close comments">' +
      CLOSE_ICON +
      "</button></header>" +
      questions
        .map(
          (question) =>
            '<button class="lavish-review-index-item" type="button" data-lavish-action="comment" popovertarget="lavish-comment-' +
            escape(question.prompt_id) +
            '">' +
            escape(question.text) +
            "</button>",
        )
        .join("") +
      "</div>"
    : "";
  const content =
    '<section id="' +
    BLOCK_ID +
    '" aria-label="Review comments"><style>' +
    COMMENT_STYLES +
    "</style>" +
    threads +
    index +
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
