import { collapseWhitespace, shortenPath } from "./row.ts";

/** Split on `&&`, `||` and `;` that sit outside quotes, so inline scripts stay intact. */
export function splitCommands(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: string | undefined;

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    if (quote) {
      current += char;
      if (char === quote && command[i - 1] !== "\\") quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    const pair = command.slice(i, i + 2);
    if (pair === "&&" || pair === "||") {
      segments.push(current);
      current = "";
      i++;
      continue;
    }
    if (char === ";") {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments.map((segment) => segment.trim()).filter(Boolean);
}

/**
 * Show the command that carries the intent. A leading `cd` is working-directory
 * bookkeeping, and the rest of a chain is counted rather than printed.
 */
export function condenseCommand(command: string, cwd?: string): string {
  const segments = splitCommands(collapseWhitespace(command));
  if (segments.length === 0) return "";

  const meaningful = segments.filter((segment, index) => !(index === 0 && /^cd\s/.test(segment)));
  const head = meaningful[0] ?? segments[0]!;
  const rest = meaningful.length - 1;

  const shortened = head.replace(/(^|\s)(\/[^\s'"]+)/g, (match, lead: string, path: string) => {
    const short = shortenPath(path, cwd);
    return short === path ? match : `${lead}${short}`;
  });

  return rest > 0 ? `${shortened} + ${rest} more` : shortened;
}
