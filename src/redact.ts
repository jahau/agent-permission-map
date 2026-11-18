/**
 * Secret handling. The tool never reports env or header values. Arguments,
 * URLs and command strings can still carry credentials, so they pass through
 * these helpers before they reach a report.
 */

export const REDACTED = "[REDACTED]";

const SECRET_NAME = /(api[_-]?key|apikey|token|secret|passw(or)?d|passwd|pwd|credential|auth|cookie|session|bearer|private[_-]?key|access[_-]?key|client[_-]?secret)/i;

const TOKEN_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/, // OpenAI / Anthropic style keys
  /\bsk-ant-[A-Za-z0-9_-]{10,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{16,}/, // GitLab
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{30,}/, // Google API key
  /\bnpm_[A-Za-z0-9]{30,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/** `${VAR}`, `${VAR:-x}`, `${env:VAR}`, `${input:id}`, `$VAR`, `%VAR%` — references, not literal values. */
const REFERENCE_ONLY = /^\s*(?:Bearer\s+|Token\s+|Basic\s+)?(?:\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%)\s*$/;

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

export function looksLikeToken(value: string): boolean {
  return TOKEN_PATTERNS.some((p) => p.test(value));
}

export function isReferenceOnly(value: string): boolean {
  return REFERENCE_ONLY.test(value);
}

/**
 * True when a key/value pair from env, headers or similar looks like an inline
 * credential: the value matches a known token shape, or the key names a secret
 * and the value is a non-empty literal rather than a variable reference.
 */
export function isInlineSecret(name: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v === "" || isReferenceOnly(v)) return false;
  if (looksLikeToken(v)) return true;
  if (!isSecretName(name)) return false;
  // Placeholders people leave in examples are not secrets.
  if (/^(<.*>|x+|\*+|changeme|your[-_ ].*|todo|none|null|false|true)$/i.test(v)) return false;
  return v.length >= 6;
}

/** Replace only well-known token shapes. Used as a last pass over every string in a report. */
export function redactTokens(text: string): string {
  let out = text;
  for (const p of TOKEN_PATTERNS) {
    if (p.test(out)) out = out.replace(new RegExp(p.source, p.flags + "g"), REDACTED);
  }
  return out;
}

/** Deep-copy a JSON-like value, applying redactTokens to every string (keys included). */
export function redactTokensDeep<T>(value: T): T {
  if (typeof value === "string") return redactTokens(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactTokensDeep(v)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // defineProperty, so a "__proto__" key stays an ordinary property
      Object.defineProperty(out, redactTokens(k), { value: redactTokensDeep(v), enumerable: true, writable: true, configurable: true });
    }
    return out as T;
  }
  return value;
}

/** Replace token-shaped substrings in free text (hook commands, helper commands). */
export function redactText(text: string): string {
  let out = text;
  for (const p of TOKEN_PATTERNS) {
    out = out.replace(new RegExp(p.source, p.flags.includes("g") ? p.flags : p.flags + "g"), REDACTED);
  }
  // --token=abc, --api-key abc, -p abc style flags with literal values
  out = out.replace(/(--?[A-Za-z0-9_-]*(?:token|key|secret|password|passwd|pwd|auth)[A-Za-z0-9_-]*)(=|\s+)(?!\$|\[REDACTED\])("[^"]*"|'[^']*'|\S+)/gi, `$1$2${REDACTED}`);
  // Authorization: Bearer abc
  out = out.replace(/(Bearer\s+)(?!\$|\[REDACTED\])[A-Za-z0-9._~+/=-]{8,}/g, `$1${REDACTED}`);
  return out;
}

export interface RedactedArgs {
  args: string[];
  redacted: number;
}

/** Redact argv values that look like credentials, including the value after a secret-named flag. */
export function redactArgs(args: readonly unknown[]): RedactedArgs {
  const out: string[] = [];
  let redacted = 0;
  let redactNext = false;
  for (const raw of args) {
    const arg = typeof raw === "string" ? raw : JSON.stringify(raw) ?? String(raw);
    if (redactNext) {
      redactNext = false;
      if (!isReferenceOnly(arg)) {
        out.push(REDACTED);
        redacted++;
        continue;
      }
    }
    const eq = /^(--?[^=\s]+)=(.*)$/s.exec(arg);
    if (eq && eq[1] && eq[2] !== undefined) {
      if (isInlineSecret(eq[1], eq[2])) {
        out.push(`${eq[1]}=${REDACTED}`);
        redacted++;
        continue;
      }
    } else if (/^--?[A-Za-z]/.test(arg) && isSecretName(arg) && !/^--?(no-)?auth$/i.test(arg)) {
      redactNext = true;
    }
    const envStyle = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(arg);
    if (envStyle && envStyle[1] && envStyle[2] !== undefined && isInlineSecret(envStyle[1], envStyle[2])) {
      out.push(`${envStyle[1]}=${REDACTED}`);
      redacted++;
      continue;
    }
    // Connection strings: postgresql://user:password@host/db
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s]*@/.test(arg)) {
      const ru = redactUrl(arg);
      if (ru.hadCredentials) {
        out.push(ru.url);
        redacted++;
        continue;
      }
    }
    const text = redactText(arg);
    if (text !== arg) redacted++;
    out.push(text);
  }
  return { args: out, redacted };
}

export interface RedactedUrl {
  url: string;
  hadCredentials: boolean;
}

/** Remove userinfo and query-string values from a URL. Unparseable URLs are passed through redactText. */
export function redactUrl(raw: string): RedactedUrl {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    const text = redactText(raw);
    return { url: text, hadCredentials: text !== raw };
  }
  let hadCredentials = false;
  let userinfo = "";
  if (parsed.username || parsed.password) {
    hadCredentials = true;
    userinfo = `${REDACTED}@`;
  }
  const keys = [...new Set([...parsed.searchParams.keys()])];
  for (const key of keys) {
    const values = parsed.searchParams.getAll(key);
    if (values.some((v) => isInlineSecret(key, v))) hadCredentials = true;
  }
  let url = `${parsed.protocol}//${userinfo}${parsed.host}${parsed.pathname}`;
  if (keys.length > 0) url += "?" + keys.map((k) => `${encodeURIComponent(k)}=${REDACTED}`).join("&");
  return { url, hadCredentials };
}
