"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  DEFAULT_FORM_VALUES,
  formToConfigInput,
  parseHostList,
  startHost,
  suggestAppName,
  suggestApplicationId,
  validateConfig,
  type AppConfig,
  type FormValues,
} from "@/lib/config";
import { describePolicy, normalizeHostname } from "@/lib/navigation-policy";
import { Field, describedBy } from "../ui/Field";
import { Toggle } from "../ui/Toggle";
import { IconPicker } from "./IconPicker";
import styles from "./GeneratorForm.module.css";

export interface FormSubmission {
  config: AppConfig;
  icon: File | null;
}

interface GeneratorFormProps {
  /** A build is running or queued; editing stays possible but submitting does not. */
  busy: boolean;
  /** Why submitting is blocked right now (for example, the build tools are missing). */
  blockedReason: string | null;
  /** Field errors reported by the server (keyed like "app.startUrl" or "icon"). */
  serverErrors: Record<string, string>;
  onSubmit: (submission: FormSubmission) => void;
}

type FieldName = "startUrl" | "appName" | "applicationId" | "versionName" | "versionCode" | "extraHosts" | "allowSubdomains" | "icon";

const MAX_ICON_BYTES = 2 * 1024 * 1024;

function toFieldErrors(errors: Record<string, string>): Partial<Record<FieldName, string>> {
  const hostKey = Object.keys(errors).find((key) => key.startsWith("navigation.allowedHosts"));
  return {
    startUrl: errors["app.startUrl"],
    appName: errors["app.name"],
    applicationId: errors["app.applicationId"],
    versionName: errors["app.versionName"],
    versionCode: errors["app.versionCode"],
    extraHosts: hostKey ? errors[hostKey] : undefined,
    allowSubdomains: errors["navigation.allowSubdomains"],
    icon: errors["icon"],
  };
}

const ADVANCED_FIELDS: FieldName[] = ["versionName", "versionCode", "extraHosts", "allowSubdomains"];

/** "reader.example.com" -> "https://reader.example.com" so a bare host name just works. */
function withScheme(value: string): string {
  const trimmed = value.trim();
  return trimmed && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && /^[^\s/]+\.[^\s/]+/.test(trimmed) ? `https://${trimmed}` : value;
}

function readImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("not an image"));
    image.src = url;
  });
}

export function GeneratorForm({ busy, blockedReason, serverErrors, onSubmit }: GeneratorFormProps) {
  const [values, setValues] = useState<FormValues>(DEFAULT_FORM_VALUES);
  const [nameEdited, setNameEdited] = useState(false);
  const [idEdited, setIdEdited] = useState(false);
  const [touched, setTouched] = useState<Set<FieldName>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [icon, setIcon] = useState<{ file: File; url: string } | null>(null);
  const [iconError, setIconError] = useState<string | undefined>();
  const formRef = useRef<HTMLFormElement>(null);

  // Release the blob: URL of the icon preview when it is replaced or the form goes away.
  useEffect(() => () => (icon ? URL.revokeObjectURL(icon.url) : undefined), [icon]);

  // A bare host name such as "reader.example.com" is treated as https://reader.example.com.
  const result = useMemo(() => validateConfig(formToConfigInput({ ...values, startUrl: withScheme(values.startUrl) })), [values]);
  const clientErrors = useMemo(() => toFieldErrors(result.ok ? {} : result.errors), [result]);
  const serverFieldErrors = useMemo(() => toFieldErrors(serverErrors), [serverErrors]);

  const host = startHost(withScheme(values.startUrl));
  const policyText = useMemo(() => {
    const extra = parseHostList(values.extraHosts)
      .map(normalizeHostname)
      .filter((h): h is string => h !== null);
    return describePolicy({
      startUrl: values.startUrl,
      allowedHosts: host ? [host, ...extra] : [],
      allowSubdomains: values.allowSubdomains,
    });
  }, [host, values.extraHosts, values.allowSubdomains, values.startUrl]);

  const show = (field: FieldName) => submitted || touched.has(field);
  const errorFor = (field: FieldName): string | undefined =>
    (show(field) ? clientErrors[field] : undefined) ?? serverFieldErrors[field];
  const touch = (field: FieldName) => setTouched((prev) => new Set(prev).add(field));

  const update = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const onUrlChange = (value: string) => {
    setValues((prev) => {
      const next = { ...prev, startUrl: value };
      const parsedHost = startHost(withScheme(value));
      if (parsedHost) {
        if (!nameEdited) next.appName = suggestAppName(parsedHost);
        if (!idEdited) next.applicationId = suggestApplicationId(parsedHost);
      }
      return next;
    });
  };

  const onIconPick = async (file: File) => {
    setIconError(undefined);
    if (file.type !== "image/png") return setIconError("The icon must be a PNG image.");
    if (file.size > MAX_ICON_BYTES) return setIconError("The icon must be 2 MB or smaller.");
    const url = URL.createObjectURL(file);
    try {
      const { width, height } = await readImageSize(url);
      if (width !== height) throw new Error(`The icon must be square (yours is ${width}×${height}).`);
      if (width < 192) throw new Error("The icon must be at least 192×192 pixels.");
      setIcon({ file, url });
    } catch (error) {
      URL.revokeObjectURL(url);
      setIconError(error instanceof Error && error.message !== "not an image" ? error.message : "That file could not be read as an image.");
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!result.ok) {
      if (ADVANCED_FIELDS.some((field) => clientErrors[field])) setAdvancedOpen(true);
      // Wait for the advanced section to open before moving focus to the first problem.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    onSubmit({ config: result.config, icon: icon?.file ?? null });
  };

  const urlError = errorFor("startUrl");
  const nameError = errorFor("appName");
  const idError = errorFor("applicationId");
  const versionNameError = errorFor("versionName");
  const versionCodeError = errorFor("versionCode");
  const hostsError = errorFor("extraHosts");
  const hostHint = "One host per line, or comma-separated. The start host is always included.";

  return (
    <form ref={formRef} className={styles.form} onSubmit={handleSubmit} noValidate>
      <section className={styles.card} aria-labelledby="section-website">
        <header className={styles.cardHeader}>
          <span className={styles.step}>1</span>
          <div>
            <h2 id="section-website">Website</h2>
            <p>The live HTTPS site the app will show. Nothing is fetched from it while you fill this in.</p>
          </div>
        </header>

        <Field id="startUrl" label="Website URL" error={urlError}>
          <input
            id="startUrl"
            className={styles.input}
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="https://reader.example.com"
            value={values.startUrl}
            {...describedBy("startUrl", urlError)}
            onChange={(event) => onUrlChange(event.target.value)}
            onBlur={() => {
              const next = withScheme(values.startUrl);
              if (next !== values.startUrl) onUrlChange(next);
              touch("startUrl");
            }}
          />
        </Field>

        <div className={styles.policy} aria-live="polite">
          <div className={styles.policyHost}>
            <span>Parsed host</span>
            <strong>{host ?? "—"}</strong>
          </div>
          <p>{policyText}</p>
          <ul>
            <li>Other hosts, <code>http://</code> pages and subdomains (unless enabled) are blocked.</li>
            <li>Popups and new windows are always blocked.</li>
          </ul>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="section-app">
        <header className={styles.cardHeader}>
          <span className={styles.step}>2</span>
          <div>
            <h2 id="section-app">App details</h2>
            <p>Suggested from the host name. Edit anything you like.</p>
          </div>
        </header>

        <div className={styles.row}>
          <Field id="appName" label="App name" error={nameError} hint="Shown under the launcher icon.">
            <input
              id="appName"
              className={styles.input}
              type="text"
              maxLength={30}
              autoComplete="off"
              value={values.appName}
              {...describedBy("appName", nameError, "Shown under the launcher icon.")}
              onChange={(event) => {
                setNameEdited(true);
                update("appName", event.target.value);
              }}
              onBlur={() => touch("appName")}
            />
          </Field>
          <Field id="applicationId" label="Application ID" error={idError} hint="Unique package name, e.g. com.example.reader.">
            <input
              id="applicationId"
              className={`${styles.input} ${styles.mono}`}
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={values.applicationId}
              {...describedBy("applicationId", idError, "Unique package name")}
              onChange={(event) => {
                setIdEdited(true);
                update("applicationId", event.target.value);
              }}
              onBlur={() => touch("applicationId")}
            />
          </Field>
        </div>

        <Field id="icon" label="App icon" optional>
          <IconPicker
            previewUrl={icon?.url ?? null}
            fileName={icon?.file.name ?? null}
            fallbackLetter={([...values.appName.trim()].find((c) => /[\p{L}\p{N}]/u.test(c)) ?? "A").toUpperCase()}
            error={iconError ?? errorFor("icon")}
            onPick={onIconPick}
            onClear={() => {
              setIcon(null);
              setIconError(undefined);
            }}
          />
        </Field>
      </section>

      <details className={styles.advanced} open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
        <summary>
          <span>Advanced</span>
          <small>Versions, extra hosts, behaviour</small>
        </summary>

        <div className={styles.advancedBody}>
          <fieldset className={styles.group}>
            <legend>Version</legend>
            <div className={styles.row}>
              <Field id="versionName" label="Version name" error={versionNameError}>
                <input
                  id="versionName"
                  className={styles.input}
                  type="text"
                  autoComplete="off"
                  value={values.versionName}
                  {...describedBy("versionName", versionNameError)}
                  onChange={(event) => update("versionName", event.target.value)}
                  onBlur={() => touch("versionName")}
                />
              </Field>
              <Field id="versionCode" label="Version code" error={versionCodeError} hint="Whole number; raise it for every update you install over the old one.">
                <input
                  id="versionCode"
                  className={styles.input}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={values.versionCode}
                  {...describedBy("versionCode", versionCodeError, "Whole number")}
                  onChange={(event) => update("versionCode", event.target.value)}
                  onBlur={() => touch("versionCode")}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset className={styles.group}>
            <legend>Navigation rules</legend>
            <Field id="extraHosts" label="Additional allowed hosts" optional error={hostsError} hint={hostHint}>
              <textarea
                id="extraHosts"
                className={`${styles.input} ${styles.mono}`}
                rows={3}
                spellCheck={false}
                autoCapitalize="off"
                placeholder={"api.example.com\nauth.example.org"}
                value={values.extraHosts}
                {...describedBy("extraHosts", hostsError, hostHint)}
                onChange={(event) => update("extraHosts", event.target.value)}
                onBlur={() => touch("extraHosts")}
              />
            </Field>
            <Toggle
              id="allowSubdomains"
              label="Allow subdomains"
              description="Also allow any subdomain of every allowed host. Off by default."
              checked={values.allowSubdomains}
              error={errorFor("allowSubdomains")}
              onChange={(checked) => update("allowSubdomains", checked)}
            />
            <div role="radiogroup" aria-labelledby="external-links-label" className={styles.radios}>
              <span id="external-links-label" className={styles.radiosLabel}>Links to other sites</span>
              <label className={styles.radio}>
                <input type="radio" name="externalLinks" checked={values.externalLinks === "block"} onChange={() => update("externalLinks", "block")} />
                <span>
                  <strong>Block</strong>
                  <small>Nothing leaves the app. Recommended.</small>
                </span>
              </label>
              <label className={styles.radio}>
                <input type="radio" name="externalLinks" checked={values.externalLinks === "system-browser"} onChange={() => update("externalLinks", "system-browser")} />
                <span>
                  <strong>Open in the system browser</strong>
                  <small>Only plain http(s) links, and only when tapped.</small>
                </span>
              </label>
            </div>
          </fieldset>

          <fieldset className={styles.group}>
            <legend>Behaviour</legend>
            <Toggle id="backNavigation" label="Back button goes back" description="Uses the page history before leaving the app." checked={values.backNavigation} onChange={(v) => update("backNavigation", v)} />
            <Toggle id="loadingIndicator" label="Loading indicator" description="A thin progress bar while pages load." checked={values.loadingIndicator} onChange={(v) => update("loadingIndicator", v)} />
            <Toggle id="offlineScreen" label="Offline / error screen" description="A friendly message with a Retry button when a page can't load." checked={values.offlineScreen} onChange={(v) => update("offlineScreen", v)} />
            <Toggle id="autoRotate" label="Allow rotation" description="Follow the device orientation instead of staying in portrait." checked={values.autoRotate} onChange={(v) => update("autoRotate", v)} />
            <Toggle id="pullToRefresh" label="Pull to refresh" description="Swipe down at the top of a page to reload it." checked={values.pullToRefresh} onChange={(v) => update("pullToRefresh", v)} />
          </fieldset>
        </div>
      </details>

      <div className={styles.submitRow}>
        <button type="submit" className={styles.submit} disabled={busy || blockedReason !== null}>
          {busy ? "Building…" : "Generate APK"}
        </button>
        {blockedReason && !busy && <p className={styles.blocked}>{blockedReason}</p>}
        {!blockedReason && !busy && submitted && !result.ok && <p className={styles.blocked}>Fix the highlighted fields to continue.</p>}
      </div>
    </form>
  );
}
