import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  describePolicy,
  evaluateNavigation,
  isHostAllowed,
  normalizeHostname,
  type NavigationReason,
} from "@/lib/navigation-policy";

interface VectorSuite {
  name: string;
  rules: { startUrl: string; allowedHosts: string[]; allowSubdomains: boolean };
  cases: { url: string; reason: NavigationReason }[];
}

// The same file the Kotlin unit tests run, so both implementations stay in agreement.
const vectorsPath = path.join(
  __dirname,
  "../templates/android/app/src/test/resources/navigation-vectors.json",
);
const { suites } = JSON.parse(readFileSync(vectorsPath, "utf-8")) as { suites: VectorSuite[] };

describe("navigation vectors shared with the Android app", () => {
  for (const suite of suites) {
    describe(suite.name, () => {
      for (const { url, reason } of suite.cases) {
        it(`${JSON.stringify(url)} -> ${reason}`, () => {
          const decision = evaluateNavigation(url, suite.rules);
          expect(decision.reason).toBe(reason);
          expect(decision.allowed).toBe(reason === "allowed");
        });
      }
    });
  }
});

describe("normalizeHostname", () => {
  it("lower-cases, strips the trailing dot and converts to punycode", () => {
    expect(normalizeHostname("Reader.Example.COM.")).toBe("reader.example.com");
    expect(normalizeHostname("bücher.example")).toBe("xn--bcher-kva.example");
  });

  it("accepts IPv4 addresses but not out-of-range ones", () => {
    expect(normalizeHostname("192.168.1.10")).toBe("192.168.1.10");
    expect(normalizeHostname("999.1.1.1")).toBeNull();
  });

  it.each([
    "",
    "   ",
    "https://example.com",
    "example.com/path",
    "example.com:8443",
    "user@example.com",
    "exa mple.com",
    "-bad-.example.com",
    "[::1]",
    "example.com\\evil",
  ])("rejects %j", (input) => {
    expect(normalizeHostname(input)).toBeNull();
  });
});

describe("isHostAllowed", () => {
  it("never treats IP addresses as having subdomains", () => {
    expect(isHostAllowed("10.0.0.1", ["0.0.0.1"], true)).toBe(false);
    expect(isHostAllowed("1.10.0.0.1", ["10.0.0.1"], true)).toBe(false);
  });

  it("requires a dot boundary for subdomains", () => {
    expect(isHostAllowed("child.example.com", ["example.com"], true)).toBe(true);
    expect(isHostAllowed("fakeexample.com", ["example.com"], true)).toBe(false);
    expect(isHostAllowed("child.example.com", ["example.com"], false)).toBe(false);
  });
});

describe("describePolicy", () => {
  it("explains the default policy", () => {
    const text = describePolicy({
      startUrl: "https://reader.example.com",
      allowedHosts: ["reader.example.com"],
      allowSubdomains: false,
    });
    expect(text).toContain("reader.example.com");
    expect(text).toContain("HTTPS");
  });

  it("mentions subdomains when enabled", () => {
    const text = describePolicy({
      startUrl: "https://example.com",
      allowedHosts: ["example.com", "auth.example.org"],
      allowSubdomains: true,
    });
    expect(text).toContain("example.com and its subdomains");
    expect(text).toContain("auth.example.org and its subdomains");
  });
});
