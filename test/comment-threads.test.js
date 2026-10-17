import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionStore } from "../src/session-store.js";

test("individual replies retain their question and do not close unrelated notes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lavish-threads-"));
  try {
    const file = path.join(dir, "review.html");
    await writeFile(file, "<h1>Review</h1>");
    const state = path.join(dir, "state.json");
    const store = new SessionStore(state);
    const session = await store.upsertSession(file, "http://localhost/review");
    await store.queuePrompts(session.key, {
      prompts: [
        { prompt_id: "question-a", prompt: "Why?", tag: "text", text: "Cost fell 10%", selector: "p" },
        { prompt_id: "question-b", prompt: "How?", tag: "message" },
      ],
    });
    const delivery = await store.takeFeedback(session.key);
    assert.equal(delivery.prompts[0].prompt_id, "question-a");
    await store.addAgentReply(session.key, "Fewer calls.", { replyTo: "question-a" });
    const saved = await new SessionStore(state).findByKey(session.key);
    assert.ok(saved.chat[0].done_at);
    assert.equal(saved.chat[1].done_at, undefined);
    assert.equal(saved.chat[2].reply_to, "question-a");
    await store.addAgentReply(session.key, "Fewer calls.", { replyTo: "question-a" });
    assert.equal((await store.findByKey(session.key)).chat.length, 3, "retry does not duplicate an answer");
    assert.equal(saved.chat[2].question.text, "Why?");
    assert.equal(saved.chat[2].question.anchor.excerpt, "Cost fell 10%");
    await assert.rejects(store.addAgentReply(session.key, "Oops", { replyTo: "missing" }), /Unknown comment/);
    const history = await store.readConversation(session.key);
    assert.equal(history.filter((x) => x.role === "user").length, 2);
    assert.equal(history.at(-1).reply_to, "question-a");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("conversation history survives live transcript trimming and reopen", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lavish-history-"));
  try {
    const file = path.join(dir, "review.html");
    const state = path.join(dir, "state.json");
    await writeFile(file, "<p>Hi</p>");
    const store = new SessionStore(state);
    const session = await store.upsertSession(file, "http://localhost/review");
    await store.queuePrompts(session.key, { prompts: [{ prompt_id: "keep-me", prompt: "Keep this", tag: "message" }] });
    const data = await store.readState();
    data.sessions[session.key].chat = [];
    await store.writeState(data);
    const restarted = new SessionStore(state);
    await restarted.upsertSession(file, "http://localhost/review");
    assert.equal((await restarted.readConversation(session.key))[0].text, "Keep this");
    await restarted.addAgentReply(session.key, "Still here", { replyTo: "keep-me" });
    assert.equal((await restarted.readConversation(session.key)).at(-1).question.text, "Keep this");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("twelve annotations plus a composer message all survive sending and poll consumption inside the HTML", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lavish-batch-comments-"));
  try {
    const file = path.join(dir, "review.html");
    await writeFile(file, '<html><body><p id="passage">Selected passage</p></body></html>');
    const store = new SessionStore(path.join(dir, "state.json"));
    const session = await store.upsertSession(file, "http://localhost/review");
    const prompts = Array.from({ length: 12 }, (_, index) => ({
      prompt_id: `annotation-${index}`,
      prompt: `Question ${index}`,
      tag: "text",
      selector: "p#passage",
      text: "Selected passage",
    }));
    prompts.push({
      prompt_id: "composer-note",
      prompt: "Also explain the terms",
      tag: "message",
      selector: "",
      text: "",
    });
    await store.queuePrompts(session.key, { prompts });
    await store.takeFeedback(session.key);
    const html = await readFile(file, "utf8");
    for (const prompt of prompts) assert.ok(html.includes(`id="lavish-comment-${prompt.prompt_id}"`));
    assert.match(html, /Also explain the terms/);
    assert.equal((await store.findByKey(session.key)).pending_prompts, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
