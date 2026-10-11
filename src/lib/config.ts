/**
 * The single typed configuration contract shared by the web form, the build
 * orchestrator and the Android app (written to assets/app-config.json).
 * Pure TypeScript with no Node APIs, so the browser can validate with it too.
 */
import { z } from "zod";
import { normalizeHostname } from "./navigation-policy";

export const CONFIG_SCHEMA_VERSION = 1;

const APPLICATION_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i;
const VERSION_NAME = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

export const MAX_ALLOWED_HOSTS = 20;

const httpsUrl = z
  .string()
  .trim()
  .min(1, "Enter the website URL.")
  .max(2048, "The URL is too long.")
  .superRefine((value, ctx) => {
    if (/[\s\\]/.test(value)) {
      ctx.addIssue({ code: "custom", message: "The URL contains spaces or backslashes." });
      return;
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a full URL such as https://reader.example.com." });
      return;
    }
    if (url.protocol !== "https:") {
      ctx.addIssue({ code: "custom", message: "Only HTTPS websites are supported." });
    } else if (url.username || url.password) {
      ctx.addIssue({ code: "custom", message: "The URL must not contain a username or password." });
    } else if (!normalizeHostname(url.hostname)) {
      ctx.addIssue({ code: "custom", message: "The host name is not valid." });
    }
  });

const hostEntry = z.string().superRefine((value, ctx) => {
  if (!normalizeHostname(value)) {
    ctx.addIssue({
      code: "custom",
      message: `"${value}" is not a valid host name. Use a bare host such as api.example.com.`,
    });
  }
});

export const appConfigSchema = z
  .strictObject({
    schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
    platform: z.literal("android"),
    app: z.strictObject({
      name: z
        .string()
        .trim()
        .min(1, "Enter an app name.")
        .max(30, "The app name must be 30 characters or fewer.")
        .refine((v) => !CONTROL_CHARS.test(v), "The app name contains invalid characters."),
      applicationId: z
        .string()
        .trim()
        .max(255)
        .regex(
          APPLICATION_ID,
          "Use a package-style ID such as com.example.reader (letters, digits, underscores; each part starts with a letter).",
        ),
      versionName: z
        .string()
        .trim()
        .regex(VERSION_NAME, "Use letters, digits, dots, dashes or underscores (max 32 characters)."),
      versionCode: z
        .number()
        .int("The version code must be a whole number.")
        .min(1, "The version code must be at least 1.")
        .max(2_100_000_000, "The version code is too large."),
      startUrl: httpsUrl,
    }),
    navigation: z.strictObject({
      allowedHosts: z.array(hostEntry).max(MAX_ALLOWED_HOSTS, `At most ${MAX_ALLOWED_HOSTS} hosts are allowed.`),
      allowSubdomains: z.boolean(),
      externalLinks: z.enum(["block", "system-browser"]),
    }),
    appearance: z.strictObject({
      orientation: z.enum(["portrait", "auto"]),
    }),
    features: z.strictObject({
      backNavigation: z.boolean(),
      loadingIndicator: z.boolean(),
      offlineScreen: z.boolean(),
      pullToRefresh: z.boolean(),
    }),
  })
  .superRefine((config, ctx) => {
    if (!config.navigation.allowSubdomains) return;
    // "com" with subdomains enabled would allow every .com site.
    const hosts = [startHost(config.app.startUrl), ...config.navigation.allowedHosts];
    hosts.forEach((host) => {
      const normalized = host ? normalizeHostname(host) : null;
      if (normalized && !normalized.includes(".")) {
        ctx.addIssue({
          code: "custom",
          path: ["navigation", "allowSubdomains"],
          message: `Subdomains cannot be allowed for "${normalized}" because it has no registrable domain.`,
        });
      }
    });
  })
  .transform((config) => {
    // Canonical form: the start host is always allowed; hosts are normalized and unique.
    const hosts = new Set<string>();
    const start = startHost(config.app.startUrl);
    if (start) hosts.add(start);
    for (const host of config.navigation.allowedHosts) {
      const normalized = normalizeHostname(host);
      if (normalized) hosts.add(normalized);
    }
    return {
      ...config,
      app: { ...config.app, startUrl: new URL(config.app.startUrl).href },
      navigation: { ...config.navigation, allowedHosts: [...hosts] },
    };
  });

export type AppConfig = z.output<typeof appConfigSchema>;

/** What the form collects, before it is assembled into the contract. */
export interface FormValues {
  startUrl: string;
  appName: string;
  applicationId: string;
  versionName: string;
  versionCode: string;
  extraHosts: string;
  allowSubdomains: boolean;
  externalLinks: "block" | "system-browser";
  autoRotate: boolean;
  backNavigation: boolean;
  loadingIndicator: boolean;
  offlineScreen: boolean;
  pullToRefresh: boolean;
}

export const DEFAULT_FORM_VALUES: FormValues = {
  startUrl: "",
  appName: "",
  applicationId: "",
  versionName: "1.0.0",
  versionCode: "1",
  extraHosts: "",
  allowSubdomains: false,
  externalLinks: "block",
  autoRotate: false,
  backNavigation: true,
  loadingIndicator: true,
  offlineScreen: true,
  pullToRefresh: false,
};

/** Splits a free-text host list on commas, whitespace and newlines. */
export function parseHostList(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((h) => h.trim())
    .filter(Boolean);
}

/** Assembles unvalidated form values into the (still unvalidated) contract shape. */
export function formToConfigInput(form: FormValues): unknown {
  const start = startHost(form.startUrl.trim());
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    platform: "android",
    app: {
      name: form.appName,
      applicationId: form.applicationId,
      versionName: form.versionName,
      versionCode: /^\d+$/.test(form.versionCode.trim()) ? Number(form.versionCode.trim()) : Number.NaN,
      startUrl: form.startUrl,
    },
    navigation: {
      allowedHosts: [...(start ? [start] : []), ...parseHostList(form.extraHosts)],
      allowSubdomains: form.allowSubdomains,
      externalLinks: form.externalLinks,
    },
    appearance: { orientation: form.autoRotate ? "auto" : "portrait" },
    features: {
      backNavigation: form.backNavigation,
      loadingIndicator: form.loadingIndicator,
      offlineScreen: form.offlineScreen,
      pullToRefresh: form.pullToRefresh,
    },
  };
}

export type ConfigResult =
  | { ok: true; config: AppConfig }
  | { ok: false; errors: Record<string, string> };

/** Validates unknown input; errors are keyed by dotted path (e.g. "app.startUrl"). */
export function validateConfig(input: unknown): ConfigResult {
  const parsed = appConfigSchema.safeParse(input);
  if (parsed.success) return { ok: true, config: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.map(String).join(".") || "config";
    // Keep the first message per field; later ones are usually follow-ups.
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

export function startHost(url: string): string | null {
  try {
    return normalizeHostname(new URL(url).hostname);
  } catch {
    return null;
  }
}

/** "reader.example.com" -> "Reader"; "www.my-site.org" -> "My Site". */
export function suggestAppName(host: string): string {
  const labels = host.replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length === 0) return "";
  const secondLevelTlds = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);
  const tldLength = labels.length > 2 && secondLevelTlds.has(labels[labels.length - 2]) && labels[labels.length - 1].length === 2 ? 2 : 1;
  const significant = labels.slice(0, Math.max(labels.length - tldLength, 1));
  const label = significant[0] ?? labels[0];
  const words = label.split(/[-_]+/).filter(Boolean);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").slice(0, 30);
}

/** "reader.example.com" -> "com.example.reader". */
export function suggestApplicationId(host: string): string {
  const labels = host
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean)
    .reverse()
    .map((label) => {
      const cleaned = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      return /^[a-z]/.test(cleaned) ? cleaned : `a${cleaned}`;
    })
    .filter((label) => label.length > 0);
  if (labels.length < 2 || /^\d+$/.test(host.replace(/\./g, ""))) return "com.example.app";
  return labels.join(".");
}
