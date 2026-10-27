import { useRef } from "react";
import styles from "./IconPicker.module.css";

interface IconPickerProps {
  previewUrl: string | null;
  fileName: string | null;
  fallbackLetter: string;
  error?: string;
  /** "#RRGGBB" shown behind the artwork (the icon's negative space), or null for automatic. */
  background: string | null;
  onBackgroundChange: (color: string | null) => void;
  disabled?: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}

export function IconPicker({ previewUrl, fileName, fallbackLetter, error, background, onBackgroundChange, disabled, onPick, onClear }: IconPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={styles.picker}>
      <div className={styles.preview} aria-hidden="true" style={background && previewUrl ? { background } : undefined}>
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local blob: preview, nothing to optimise
          <img src={previewUrl} alt="" className={styles.image} />
        ) : (
          <span className={styles.letter}>{fallbackLetter}</span>
        )}
      </div>
      <div className={styles.body}>
        <p className={styles.title}>{fileName ?? "Default icon"}</p>
        <p className={styles.note} id="icon-note">
          {fileName
            ? "Scaled to every Android density on this machine. The background colour fills the space around your artwork on the launcher."
            : "A letter on a coloured square is generated from the app name. Upload a square PNG (192 px or larger) to use your own."}
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={disabled} onClick={() => inputRef.current?.click()}>
            {fileName ? "Replace PNG" : "Upload PNG"}
          </button>
          {fileName && (
            <button type="button" className={styles.link} disabled={disabled} onClick={onClear}>
              Remove
            </button>
          )}
        </div>
        {fileName && (
          <div className={styles.background}>
            <label htmlFor="iconBackground">Background colour</label>
            <input
              id="iconBackground"
              type="color"
              value={background ?? "#ffffff"}
              disabled={disabled}
              onChange={(event) => onBackgroundChange(event.target.value.toUpperCase())}
            />
            <button type="button" className={styles.link} disabled={disabled || background === null} onClick={() => onBackgroundChange(null)}>
              {background === null ? "Automatic" : "Use automatic"}
            </button>
          </div>
        )}
        <input
          ref={inputRef}
          id="icon"
          className={styles.file}
          type="file"
          accept="image/png"
          aria-describedby="icon-note"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = ""; // allow picking the same file again after an error
            if (file) onPick(file);
          }}
        />
      </div>
    </div>
  );
}
