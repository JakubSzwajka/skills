#!/usr/bin/env node

/**
 * Extract and filter Claude Code session data for analysis.
 * Scans JSONL files directly (sessions-index.json can be stale).
 *
 * Usage: node extract-sessions.js [options]
 *   --scope=project|user     (default: project)
 *   --project-path=/path     (required if scope=project, uses cwd if omitted)
 *   --days=7                 (default: 7)
 *   --max-sessions=20        (default: 20)
 *   --min-messages=4         (default: 4)
 *   --max-chars-per-session=8000  (default: 8000)
 */

const fs = require("fs");
const path = require("path");

const CLAUDE_DIR = path.join(require("os").homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

function parseArgs() {
  const args = {
    scope: "project",
    projectPath: process.cwd(),
    days: 7,
    maxSessions: 20,
    minMessages: 4,
    maxCharsPerSession: 8000,
  };

  for (const arg of process.argv.slice(2)) {
    const [key, val] = arg.replace(/^--/, "").split("=");
    switch (key) {
      case "scope": args.scope = val; break;
      case "project-path": args.projectPath = val; break;
      case "days": args.days = parseInt(val, 10); break;
      case "max-sessions": args.maxSessions = parseInt(val, 10); break;
      case "min-messages": args.minMessages = parseInt(val, 10); break;
      case "max-chars-per-session": args.maxCharsPerSession = parseInt(val, 10); break;
    }
  }
  return args;
}

function encodeProjectPath(projectPath) {
  return projectPath.replace(/[\/\.]/g, "-");
}

function findProjectDirs(scope, projectPath) {
  if (scope === "project") {
    const encoded = encodeProjectPath(projectPath);
    const dir = path.join(PROJECTS_DIR, encoded);
    if (fs.existsSync(dir)) return [{ dir, projectPath }];
    return [];
  }

  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs.readdirSync(PROJECTS_DIR)
    .filter((d) => {
      const full = path.join(PROJECTS_DIR, d);
      return fs.statSync(full).isDirectory();
    })
    .map((d) => ({
      dir: path.join(PROJECTS_DIR, d),
      projectPath: d.replace(/^-/, "/").replace(/-/g, "/"),
    }));
}

function findSessionFiles(projectDir, cutoffMs) {
  const files = [];
  try {
    for (const entry of fs.readdirSync(projectDir)) {
      if (!entry.endsWith(".jsonl")) continue;
      if (entry === "sessions-index.json") continue;

      const fullPath = path.join(projectDir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoffMs) continue;

      files.push({
        path: fullPath,
        sessionId: entry.replace(".jsonl", ""),
        mtime: stat.mtimeMs,
      });
    }
  } catch {
    // directory read error
  }
  return files;
}

function parseSessionFile(filePath, maxChars, minMessages) {
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);

  let sessionId = null;
  let gitBranch = "unknown";
  let isSidechain = false;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let firstUserMessage = null;
  const messages = [];
  let totalChars = 0;
  let totalMsgCount = 0;

  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    // Skip non-message records
    if (record.type !== "user" && record.type !== "assistant") continue;
    if (!record.message) continue;

    totalMsgCount++;

    // Extract metadata from first message
    if (!sessionId && record.sessionId) sessionId = record.sessionId;
    if (record.gitBranch) gitBranch = record.gitBranch;
    if (record.isSidechain) isSidechain = true;

    // Track timestamps
    if (record.timestamp) {
      if (!firstTimestamp) firstTimestamp = record.timestamp;
      lastTimestamp = record.timestamp;
    }

    // Extract text content
    const content = record.message.content;
    let text = "";

    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    }

    if (!text.trim()) continue;

    // Track first user message for summary
    if (!firstUserMessage && record.message.role === "user") {
      firstUserMessage = text.slice(0, 200);
    }

    // Skip if we've hit the char budget
    if (totalChars >= maxChars) continue;

    // Truncate long messages
    const maxMsgLen = 2000;
    if (text.length > maxMsgLen) {
      text = text.slice(0, maxMsgLen) + "\n... [truncated]";
    }

    // Strip system reminders
    text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "[system-reminder]");

    const msg = {
      role: record.message.role,
      text: text.trim(),
      timestamp: record.timestamp,
    };

    if (record.type === "assistant" && record.message.model) {
      msg.model = record.message.model;
    }

    totalChars += msg.text.length;
    messages.push(msg);
  }

  // Filter: skip sidechains and low-message sessions
  if (isSidechain) return null;
  if (totalMsgCount < minMessages) return null;

  return {
    sessionId: sessionId || path.basename(filePath, ".jsonl"),
    gitBranch,
    firstPrompt: firstUserMessage || "",
    created: firstTimestamp,
    modified: lastTimestamp,
    messageCount: totalMsgCount,
    messages,
  };
}

function main() {
  const args = parseArgs();
  const cutoffMs = Date.now() - args.days * 24 * 60 * 60 * 1000;
  const projectDirs = findProjectDirs(args.scope, args.projectPath);

  if (projectDirs.length === 0) {
    console.error(JSON.stringify({ error: "No project directories found", args }));
    process.exit(1);
  }

  const allSessions = [];

  for (const { dir, projectPath } of projectDirs) {
    const sessionFiles = findSessionFiles(dir, cutoffMs);

    for (const sf of sessionFiles) {
      try {
        const session = parseSessionFile(sf.path, args.maxCharsPerSession, args.minMessages);
        if (!session) continue;
        session.projectPath = projectPath;
        allSessions.push(session);
      } catch {
        // skip unreadable files
      }
    }
  }

  // Sort by most recent first, apply limit
  allSessions.sort((a, b) => {
    const aTime = new Date(b.modified || 0).getTime();
    const bTime = new Date(a.modified || 0).getTime();
    return aTime - bTime;
  });
  const finalSessions = allSessions.slice(0, args.maxSessions);

  const output = {
    scope: args.scope,
    days: args.days,
    totalSessionsFound: allSessions.length,
    sessionsIncluded: finalSessions.length,
    sessions: finalSessions,
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
