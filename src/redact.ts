const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(authorization\s*[:=]\s*)(bearer\s+)?[^\s"',}]+/gi, "$1[REDACTED]"],
  [/(cookie\s*[:=]\s*)[^"',}]+/gi, "$1[REDACTED]"],
  [/(api[_-]?key\s*[:=]\s*)[^\s"',}]+/gi, "$1[REDACTED]"],
  [/(token\s*[:=]\s*)[^\s"',}]+/gi, "$1[REDACTED]"],
  [/(password\s*[:=]\s*)[^\s"',}]+/gi, "$1[REDACTED]"],
  [/(secret\s*[:=]\s*)[^\s"',}]+/gi, "$1[REDACTED]"],
];

export function redactText(value: unknown): string {
  let text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function preview(value: unknown, max = 240): string {
  const text = redactText(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

export function isSensitiveModelInput(role?: string, text?: string): boolean {
  if (role === "developer") return true;
  const source = text ?? "";
  return /<permissions instructions>|<skills_instructions>|## Memory|<developer|system>/i.test(source);
}
