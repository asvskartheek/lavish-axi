import assert from "node:assert/strict";
import test from "node:test";
import { updateDocumentComments } from "../src/document-comments.js";

test("questions and separate visual answers are retained in the actual HTML", () => {
  const original = '<!doctype html><html><body><h1>Report</h1><p id="cost">Cost fell 10%.</p></body></html>';
  const question = {
    role: "user",
    prompt_id: "cost-q",
    text: "Why?",
    anchor: { excerpt: "Cost fell 10%.", selector: "p#cost" },
  };
  const queued = updateDocumentComments(original, [question]);
  assert.match(queued, /Why\?/);
  assert.match(queued, /Awaiting answer/);
  const reply = {
    role: "agent",
    message_id: "answer-1",
    reply_to: "cost-q",
    text: "Try the slider",
    visual_html: '<label>Calls <input type="range"></label><script>document.body.dataset.ready="yes"</script>',
  };
  const answered = updateDocumentComments(queued, [reply]);
  assert.match(answered, /sandbox="allow-scripts"/);
  assert.match(answered, /srcdoc=/);
  assert.match(answered, /Try the slider/);
  assert.match(answered, /href="#cost"/);
  assert.equal((answered.match(/id="lavish-review-comments"/g) || []).length, 1);
  assert.match(answered, /<p id="cost">Cost fell 10%\.<button/);
  const later = updateDocumentComments(answered, [{ role: "user", prompt_id: "second-q", text: "How?" }]);
  assert.match(later, /Why\?/);
  assert.match(later, /How\?/);
  assert.match(later, /Try the slider/);
  assert.equal(updateDocumentComments(later, [reply]), later, "retry is idempotent");
});

test("reviewer text is escaped and cannot break the embedded data or page", () => {
  const html = updateDocumentComments("<body><h1>Original</h1></body>", [
    {
      role: "user",
      prompt_id: "safe-q",
      text: "</script><script>alert(1)</script>",
      anchor: { excerpt: "<img src=x onerror=alert(1)>" },
    },
  ]);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Original/);
});

test("source links remain on the same element as comment references are inserted", () => {
  const source = '<body><nav><a href="/one">One</a><a href="/two">Two</a></nav></body>';
  const questions = [
    {
      role: "user",
      prompt_id: "one",
      text: "First link?",
      anchor: { selector: "nav > a:nth-of-type(1)", excerpt: "One" },
    },
    {
      role: "user",
      prompt_id: "two",
      text: "Second link?",
      anchor: { selector: "nav > a:nth-of-type(2)", excerpt: "Two" },
    },
  ];
  const saved = updateDocumentComments(source, questions);
  const answered = updateDocumentComments(saved, [
    ...questions,
    { role: "agent", message_id: "reply", reply_to: "two", text: "Second" },
  ]);
  assert.match(answered, /href="\/two" id="lavish-source-two">Two/);
  assert.match(answered, /href="#lavish-source-two"/);
  assert.equal((answered.match(/data-lavish-comment-ref="two"/g) || []).length, 1);
});

test("comments stay tucked into small inline bubbles and open only on request", () => {
  const html = updateDocumentComments('<body><p id="cost">Cost fell.</p></body>', [
    { role: "user", prompt_id: "quiet", text: "Why?", anchor: { selector: "p#cost", excerpt: "Cost fell." } },
  ]);
  assert.match(html, /popovertarget="lavish-comment-quiet"/);
  assert.match(html, /id="lavish-comment-quiet" popover="auto"/);
  assert.match(html, /popovertargetaction="hide"/);
  assert.doesNotMatch(html, />Review comment<|<h2>Review comments<\/h2>/);
  assert.match(html, /Cost fell\.<button/);
});
