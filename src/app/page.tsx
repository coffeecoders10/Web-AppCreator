import { GeneratorApp } from "@/components/GeneratorApp";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.mark} aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
            <rect x="6" y="1.5" width="14" height="23" rx="3.5" stroke="currentColor" strokeWidth="2" />
            <circle cx="13" cy="20" r="1.3" fill="currentColor" />
            <path d="M9.5 8.5h7M9.5 12h7M9.5 15.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <h1>Website to Android app</h1>
          <p>
            Paste an HTTPS URL, adjust a few settings and get an installable APK that shows your site in a restricted WebView. Everything is
            built on this machine: no accounts, no cloud, no external services.
          </p>
        </div>
      </header>
      <GeneratorApp />
    </main>
  );
}
