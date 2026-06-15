"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8765);
loadEnv(path.join(ROOT, ".env"));

const API_KEY = process.env.GROQ_API_KEY;
const CHAT_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const SPEECH_MODEL = process.env.GROQ_SPEECH_MODEL || "whisper-large-v3-turbo";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

async function readJson(req, maxBytes = 28 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function requireKey(res) {
  if (API_KEY) return true;
  json(res, 503, {
    error: "AI evaluation is not configured. Add a new GROQ_API_KEY to the local .env file and restart the server."
  });
  return false;
}

function rubricPrompt(skill, target) {
  const common = `Act as a careful independent English language examiner. This is practice for a multilevel General SELT-style test, not an official LANGUAGECERT assessment. Evaluate at target level ${target}. Return valid JSON only. Use integer scores from 0 to 100. Do not inflate scores.`;
  if (skill === "writing") {
    return `${common}
Assess task achievement, organisation/cohesion, grammar accuracy/range, vocabulary accuracy/range, and register/mechanics. Return:
{"overall":0,"estimatedLevel":"A2|B1|B2|C1","criteria":{"taskAchievement":0,"organisation":0,"grammar":0,"vocabulary":0,"registerAndMechanics":0},"strengths":[""],"improvements":[""],"corrections":[{"original":"","improved":"","reason":""}],"summary":""}`;
  }
  return `${common}
Assess only evidence available in the transcript: task fulfilment, fluency/coherence, grammar, vocabulary, and interactive communication. Pronunciation cannot be reliably scored from a transcript, so set pronunciation to null and state that limitation. Return:
{"overall":0,"estimatedLevel":"A2|B1|B2|C1","criteria":{"taskFulfilment":0,"fluencyAndCoherence":0,"grammar":0,"vocabulary":0,"interactiveCommunication":0,"pronunciation":null},"strengths":[""],"improvements":[""],"usefulPhrases":[""],"summary":"","pronunciationNote":""}`;
}

async function groqChat(system, user) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });
  const payload = await response.json();
  console.log("MIME:", mime);
console.log("FILE SIZE:", bytes.length);
console.log("GROQ RESPONSE:", JSON.stringify(payload));
if (!response.ok) {
  console.error("GROQ ERROR:", payload);
  throw new Error(
    payload?.error?.message ||
    JSON.stringify(payload) ||
    "Groq transcription request failed."
  );
}
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned an empty evaluation.");
  return JSON.parse(content);
}

function clampScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
}

function normaliseEvaluation(raw) {
  const criteria = {};
  for (const [key, value] of Object.entries(raw.criteria || {})) {
    criteria[key] = value === null ? null : clampScore(value);
  }
  return {
    overall: clampScore(raw.overall),
    estimatedLevel: String(raw.estimatedLevel || "Not estimated"),
    criteria,
    strengths: Array.isArray(raw.strengths) ? raw.strengths.slice(0, 5).map(String) : [],
    improvements: Array.isArray(raw.improvements) ? raw.improvements.slice(0, 5).map(String) : [],
    corrections: Array.isArray(raw.corrections) ? raw.corrections.slice(0, 5) : [],
    usefulPhrases: Array.isArray(raw.usefulPhrases) ? raw.usefulPhrases.slice(0, 5).map(String) : [],
    summary: String(raw.summary || ""),
    pronunciationNote: String(raw.pronunciationNote || "")
  };
}

async function evaluateWriting(req, res) {
  if (!requireKey(res)) return;
  const body = await readJson(req);
  const response = String(body.response || "").trim();
  if (response.length < 40) return json(res, 400, { error: "Write a longer response before requesting AI evaluation." });
  const result = await groqChat(
    rubricPrompt("writing", body.target || "B2"),
    `TASK:\n${body.prompt}\n\nCANDIDATE RESPONSE (${body.wordCount || 0} words):\n${response}`
  );
  json(res, 200, { evaluation: normaliseEvaluation(result), model: CHAT_MODEL });
}

async function transcribeSpeaking(req, res) {
  if (!requireKey(res)) return;
  const body = await readJson(req);
  const base64 = String(body.audio || "").replace(/^data:[^;]+;base64,/, "");
  if (!base64) return json(res, 400, { error: "No recording was provided." });
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > 25 * 1024 * 1024) return json(res, 413, { error: "Recording is larger than 25 MB." });

  const mime = String(body.mimeType || "audio/webm").split(";")[0];
  const extension = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), `speaking.${extension}`);
  form.append("model", SPEECH_MODEL);
  form.append("language", "en");
  form.append("response_format", "json");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${API_KEY}` },
    body: form
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Groq transcription request failed.");
  const transcript = String(payload.text || "").trim();
  if (!transcript) return json(res, 422, { error: "No clear speech was detected in the recording." });
  json(res, 200, { transcript, model: SPEECH_MODEL });
}

async function evaluateSpeaking(req, res) {
  if (!requireKey(res)) return;
  const body = await readJson(req);
  const transcript = String(body.transcript || "").trim();
  if (transcript.length < 20) return json(res, 400, { error: "The transcript is too short for useful evaluation." });
  const result = await groqChat(
    rubricPrompt("speaking", body.target || "B2"),
    `SPEAKING TASK:\n${body.prompt}\n\nTRANSCRIPT:\n${transcript}\n\nApproximate recorded duration: ${body.duration || 0} seconds.`
  );
  json(res, 200, { evaluation: normaliseEvaluation(result), model: CHAT_MODEL });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const requested = url.pathname === "/" ? "selt-practice-platform.html" : decodeURIComponent(url.pathname.slice(1));
  if (requested !== "selt-practice-platform.html") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  const file = path.resolve(ROOT, requested);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control":"no-store" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/health") {
      return json(res, 200, { ok: true, aiConfigured: Boolean(API_KEY), chatModel: CHAT_MODEL, speechModel: SPEECH_MODEL });
    }
    if (req.method === "POST" && req.url === "/api/evaluate-writing") return await evaluateWriting(req, res);
    if (req.method === "POST" && req.url === "/api/transcribe-speaking") return await transcribeSpeaking(req, res);
    if (req.method === "POST" && req.url === "/api/evaluate-speaking") return await evaluateSpeaking(req, res);
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
    json(res, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: error.message || "Unexpected server error." });
  }
});

server.listen(PORT, () => {
  console.log(`SELT Mastery running on port ${PORT}`);
  console.log(API_KEY ? "Groq AI evaluation is configured." : "Add GROQ_API_KEY to enable AI evaluation.");
});
