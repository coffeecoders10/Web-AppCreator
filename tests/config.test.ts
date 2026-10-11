import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORM_VALUES,
  formToConfigInput,
  parseHostList,
  suggestAppName,
  suggestApplicationId,
  validateConfig,
  type FormValues,
} from "@/lib/config";

const valid: FormValues = {
  ...DEFAULT_FORM_VALUES,
  startUrl: "https://reader.example.com",
  appName: "My Reader",
  applicationId: "com.example.myreader",
};

function check(overrides: Partial<FormValues>) {
  return validateConfig(formToConfigInput({ ...valid, ...overrides }));
}

describe("validateConfig", () => {
  it("accepts the default form and produces the canonical contract", () => {
    const result = check({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toEqual({
      schemaVersion: 1,
      platform: "android",
      app: {
        name: "My Reader",
        applicationId: "com.example.myreader",
        versionName: "1.0.0",
        versionCode: 1,
        startUrl: "https://reader.example.com/",
      },
      navigation: { allowedHosts: ["reader.example.com"], allowSubdomains: false, externalLinks: "block" },
      appearance: { orientation: "portrait" },
      features: { backNavigation: true, loadingIndicator: true, offlineScreen: true, pullToRefresh: false },
    });
  });

  it("always includes the start host and de-duplicates extra hosts", () => {
    const result = check({ extraHosts: "API.example.com, reader.example.com\nauth.example.org" });
    expect(result.ok && result.config.navigation.allowedHosts).toEqual([
      "reader.example.com",
      "api.example.com",
      "auth.example.org",
    ]);
  });

  it.each([
    ["", "app.startUrl"],
    ["reader.example.com", "app.startUrl"],
    ["http://reader.example.com", "app.startUrl"],
    ["ftp://reader.example.com", "app.startUrl"],
    ["https://user:pw@reader.example.com", "app.startUrl"],
    ["https://reader example.com", "app.startUrl"],
    ["javascript:alert(1)", "app.startUrl"],
  ])("rejects start URL %j", (startUrl, field) => {
    const result = check({ startUrl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[field]).toBeTruthy();
  });

  it.each(["com", "com.", "1com.example", "com..example", "com.example-", "my app.example", ""])(
    "rejects application ID %j",
    (applicationId) => {
      const result = check({ applicationId });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors["app.applicationId"]).toBeTruthy();
    },
  );

  it.each(["", "   ", "x".repeat(31), "bad\u0000name"])("rejects app name %j", (appName) => {
    const result = check({ appName });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["app.name"]).toBeTruthy();
  });

  it.each(["0", "-1", "1.5", "abc", "", "2100000001"])("rejects version code %j", (versionCode) => {
    const result = check({ versionCode });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["app.versionCode"]).toBeTruthy();
  });

  it("rejects malformed extra hosts", () => {
    const result = check({ extraHosts: "good.example.com https://bad.example.com" });
    expect(result.ok).toBe(false);
    // The start host is prepended to the list, so the bad entry is index 2.
    if (!result.ok) expect(result.errors["navigation.allowedHosts.2"]).toContain("not a valid host");
  });

  it("refuses subdomain matching on a single-label host", () => {
    const result = check({ extraHosts: "com", allowSubdomains: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["navigation.allowSubdomains"]).toBeTruthy();
  });

  it("rejects unknown keys and the wrong platform or schema version", () => {
    const base = formToConfigInput(valid) as Record<string, unknown>;
    expect(validateConfig({ ...base, extra: 1 }).ok).toBe(false);
    expect(validateConfig({ ...base, platform: "ios" }).ok).toBe(false);
    expect(validateConfig({ ...base, schemaVersion: 2 }).ok).toBe(false);
  });

  it("does not leak local paths or secrets into the contract", () => {
    const result = check({});
    expect(JSON.stringify(result)).not.toMatch(/[A-Za-z]:\\|\/Users\/|password|secret|keystore/i);
  });
});

describe("suggestions", () => {
  it("suggests an app name from the host", () => {
    expect(suggestAppName("reader.example.com")).toBe("Reader");
    expect(suggestAppName("www.my-site.org")).toBe("My Site");
    expect(suggestAppName("example.com")).toBe("Example");
    expect(suggestAppName("shop.example.co.uk")).toBe("Shop");
    expect(suggestAppName("")).toBe("");
  });

  it("suggests a valid application ID from the host", () => {
    expect(suggestApplicationId("reader.example.com")).toBe("com.example.reader");
    expect(suggestApplicationId("www.my-site.org")).toBe("org.my_site");
    expect(suggestApplicationId("192.168.1.10")).toBe("com.example.app");
    expect(suggestApplicationId("123.example.com")).toBe("com.example.a123");
    for (const host of ["reader.example.com", "www.my-site.org", "123.example.com"]) {
      expect(check({ applicationId: suggestApplicationId(host) }).ok).toBe(true);
    }
  });
});

describe("parseHostList", () => {
  it("splits on commas, whitespace and newlines", () => {
    expect(parseHostList("a.com, b.com\nc.com  d.com;e.com")).toEqual(["a.com", "b.com", "c.com", "d.com", "e.com"]);
    expect(parseHostList("   ")).toEqual([]);
  });
});
