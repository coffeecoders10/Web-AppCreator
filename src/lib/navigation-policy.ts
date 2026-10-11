/**
 * Top-level navigation policy.
 *
 * This is the TypeScript twin of
 * templates/android/app/src/main/kotlin/.../NavigationPolicy.kt. Both are
 * exercised by the same vectors in
 * templates/android/app/src/test/resources/navigation-vectors.json, so the
 * generator (explanations, tests) and the Android app (enforcement) cannot
 * drift apart silently. The Android implementation is the authoritative one.
 *
 * Rules: parse properly, compare normalized hostnames (never string prefixes),
 * HTTPS only, exact host by default, dot-delimited suffix when subdomains are
 * enabled, no credentials in the URL, port must be 443 or the start URL's port.
 */

export interface NavigationRules {
  /** The first page opened in the app. Must be an HTTPS URL. */
  startUrl: string;
  /** Hostnames (already normalized or not) that may be navigated to. */
  allowedHosts: readonly string[];
  allowSubdomains: boolean;
}

export type NavigationReason =
  | "allowed"
  | "invalid-url"
  | "unsupported-scheme"
  | "not-https"
  | "credentials-in-url"
  | "port-not-allowed"
  | "host-not-allowed";

export interface NavigationDecision {
  allowed: boolean;
  reason: NavigationReason;
}

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
// Whitespace, control characters and backslashes make URL parsers disagree
// with each other, so they are rejected outright instead of "fixed up".
const UNSAFE_URL_CHARS = /[\u0000- \u007f-\u009f\\]/;

/**
 * Normalizes a bare hostname: lower-case, punycode, no trailing dot.
 * Returns null when the input is not a plain DNS name or IPv4 address
 * (schemes, ports, paths, credentials, IPv6 literals are all rejected).
 */
export function normalizeHostname(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || UNSAFE_URL_CHARS.test(trimmed) || /[/?#@:[\]]/.test(trimmed)) return null;

  let host: string;
  try {
    host = new URL(`https://${trimmed}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253) return null;
  if (IPV4.test(host)) return host.split(".").every((p) => Number(p) <= 255) ? host : null;
  return host.split(".").every((label) => LABEL.test(label)) ? host : null;
}

export function isHostAllowed(
  host: string,
  allowedHosts: readonly string[],
  allowSubdomains: boolean,
): boolean {
  const candidate = normalizeHostname(host);
  if (!candidate) return false;
  for (const entry of allowedHosts) {
    const allowed = normalizeHostname(entry);
    if (!allowed) continue;
    if (candidate === allowed) return true;
    // Dot-delimited suffix only: "child.example.com" matches "example.com",
    // "fakeexample.com" does not. IP addresses never have subdomains.
    if (allowSubdomains && !IPV4.test(allowed) && candidate.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

export function evaluateNavigation(url: string, rules: NavigationRules): NavigationDecision {
  const deny = (reason: NavigationReason): NavigationDecision => ({ allowed: false, reason });

  if (UNSAFE_URL_CHARS.test(url)) return deny("invalid-url");

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return deny("invalid-url");
  }

  if (target.protocol === "http:") return deny("not-https");
  if (target.protocol !== "https:") return deny("unsupported-scheme");
  // WHATWG would accept "https:example.com" and "https:/example.com"; stricter parsers do not.
  if (!/^https:\/\/[^/]/i.test(url)) return deny("invalid-url");
  // Any "@" in the authority means user info, even an empty one.
  const authority = url.slice("https://".length).split(/[/?#]/, 1)[0];
  if (target.username || target.password || authority.includes("@")) return deny("credentials-in-url");

  let startPort = "";
  try {
    startPort = new URL(rules.startUrl).port;
  } catch {
    return deny("invalid-url");
  }
  // WHATWG URL reports the default port (443) as "".
  if (target.port !== "" && target.port !== startPort) return deny("port-not-allowed");

  if (!isHostAllowed(target.hostname, rules.allowedHosts, rules.allowSubdomains)) {
    return deny("host-not-allowed");
  }
  return { allowed: true, reason: "allowed" };
}

/** Human-readable summary of the policy, shown in the UI. */
export function describePolicy(rules: NavigationRules): string {
  const hosts = rules.allowedHosts.filter(Boolean);
  if (hosts.length === 0) return "Enter a valid HTTPS URL to see which pages the app will allow.";
  const list = hosts.map((h) => (rules.allowSubdomains ? `${h} and its subdomains` : h));
  return `Only HTTPS pages on ${joinList(list)} open inside the app. Everything else is blocked.`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
