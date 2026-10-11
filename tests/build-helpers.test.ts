import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { explainFailure } from "@/lib/android-builder";
import { parseJavaMajor } from "@/lib/environment";
import {
  assertInside,
  escapeAndroidString,
  escapePropertiesValue,
  isValidJobId,
  jobDir,
  newJobId,
  slugify,
} from "@/lib/file-utils";

describe("job ids and paths", () => {
  it("generates unpredictable 128-bit hex ids", () => {
    const a = newJobId();
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(newJobId()).not.toBe(a);
  });

  it("rejects ids that could traverse the file system", () => {
    for (const bad of ["", "..", "../x", "a/b", "a\\b", "A".repeat(32), "g".repeat(32), "0".repeat(31)]) {
      expect(isValidJobId(bad)).toBe(false);
      expect(() => jobDir(os.tmpdir(), bad)).toThrow();
    }
  });

  it("keeps job directories inside the root", () => {
    const root = path.join(os.tmpdir(), "builds");
    const id = newJobId();
    expect(jobDir(root, id)).toBe(path.join(root, id));
    expect(() => assertInside(root, path.join(root, "..", "elsewhere"))).toThrow();
    expect(() => assertInside(root, root)).toThrow();
  });
});

describe("slugify", () => {
  it("makes safe ASCII file name parts", () => {
    expect(slugify("My Reader!")).toBe("my-reader");
    expect(slugify("Café Münster")).toBe("cafe-munster");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("日本語", "fallback")).toBe("fallback");
  });
});

describe("escaping", () => {
  it("escapes Android string resources", () => {
    expect(escapeAndroidString(`Tom's "Café" & <Co>`)).toBe(`Tom\\'s \\"Café\\" &amp; &lt;Co&gt;`);
    expect(escapeAndroidString("@home")).toBe("\\@home");
    expect(escapeAndroidString("?what")).toBe("\\?what");
    expect(escapeAndroidString("back\\slash")).toBe("back\\\\slash");
  });

  it("escapes Java properties values", () => {
    expect(escapePropertiesValue("C:\\Users\\me\\Sdk")).toBe("C\\:\\\\Users\\\\me\\\\Sdk");
    expect(escapePropertiesValue("1.0.0-beta+1")).toBe("1.0.0-beta+1");
    expect(escapePropertiesValue("é")).toBe("\\u00e9");
    expect(escapePropertiesValue("a=b\nc")).toBe("a\\=b\\u000ac");
  });
});

describe("explainFailure", () => {
  it.each([
    ["You have not accepted the license agreements of the following SDK components", /sdkmanager --licenses/],
    ["SDK location not found. Define a valid SDK location", /ANDROID_HOME/],
    ["Could not resolve com.android.tools.build:gradle:8.13.2 UnknownHostException", /internet/],
    ["java.lang.OutOfMemoryError: Java heap space", /memory/],
    ["Unsupported class file major version 69", /JDK/],
    ["e: Some Kotlin compile error", /build log/],
  ])("recognises %j", (output, hint) => {
    const error = explainFailure(1, output);
    expect(error.message).toContain("exit code 1");
    expect(error.hint).toMatch(hint);
  });
});

describe("parseJavaMajor", () => {
  it("reads modern and legacy version strings", () => {
    expect(parseJavaMajor('openjdk version "17.0.20" 2026-04-21')).toBe(17);
    expect(parseJavaMajor('openjdk version "21" 2023-09-19')).toBe(21);
    expect(parseJavaMajor('java version "1.8.0_352"')).toBe(8);
    expect(parseJavaMajor("command not found")).toBeNull();
  });
});
