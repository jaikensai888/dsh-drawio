import z from 'schemastery';
/**
 * Deployment configuration, validated by the Loader and passed to `apply` as
 * its second argument.
 *
 * Note there is a SECOND line of defence: schemastery is non-strict, so unknown
 * keys from `cordis.patch.yml` are merged into the resolved object and would
 * otherwise reach the plugin (GROUND-TRUTH pitfall #9). {@link resolveDrawioConfig}
 * re-derives every field from scratch, which is also what makes it usable as
 * the settings `base` layer in P3's user-settings surface.
 */
/** drawio's `ui` parameter. `kennedy` is the full editor; `min` strips panels. */
export declare const DRAWIO_UI_THEMES: readonly ["kennedy", "min", "atlas", "dark", "sketch", "simple"];
export type DrawioUiTheme = typeof DRAWIO_UI_THEMES[number];
/** Where new diagrams are created when the workspace does not override it. */
export declare const DEFAULT_DIAGRAMS_DIR = "docs/diagrams";
export interface DrawioConfig {
    /** Pinned drawio release tag. */
    drawioVersion: string;
    /** sha256 of that release's `draw.war`. */
    drawioSha256: string;
    /** Escape hatch: a non-empty URL bypasses the self-hosted editor entirely. */
    editorUrl: string;
    /** Directory for new diagrams, relative to the workspace. */
    diagramsDir: string;
    /** Passed to drawio as its debounce before it posts `autosave`. */
    autosaveDelayMs: number;
    /** Our own idle delay before a pending payload reaches disk. */
    writeDebounceMs: number;
    /** drawio `ui` parameter. */
    uiTheme: DrawioUiTheme;
    /** drawio UI language. */
    language: string;
    /** Allow read/write outside the session workspace. Off by default. */
    allowOutsideWorkspace: boolean;
}
export declare const DEFAULT_DRAWIO_CONFIG: DrawioConfig;
/** The schema the Loader validates a `cordis.patch.yml` config against. */
export declare const Config: z<Schemastery.ObjectS<{
    drawioVersion: z<string, string>;
    drawioSha256: z<string, string>;
    editorUrl: z<string, string>;
    diagramsDir: z<string, string>;
    autosaveDelayMs: z<number, number>;
    writeDebounceMs: z<number, number>;
    uiTheme: z<string, string>;
    language: z<string, string>;
    allowOutsideWorkspace: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    drawioVersion: z<string, string>;
    drawioSha256: z<string, string>;
    editorUrl: z<string, string>;
    diagramsDir: z<string, string>;
    autosaveDelayMs: z<number, number>;
    writeDebounceMs: z<number, number>;
    uiTheme: z<string, string>;
    language: z<string, string>;
    allowOutsideWorkspace: z<boolean, boolean>;
}>>;
/**
 * Keep `diagramsDir` a plain relative path inside the workspace.
 *
 * This is a deployment knob that ends up in `join(cwd, …)`, so `../` or an
 * absolute path would let a config value redirect every new diagram out of the
 * workspace. Junk falls back to the default rather than failing the boot.
 */
export declare function normalizeDiagramsDir(value: unknown): string;
/**
 * Re-derive a complete, safe config from anything the composition layer handed
 * us. Never throws: a bad deployment value degrades to its default so a typo in
 * yaml cannot take the plugin tree down.
 */
export declare function resolveDrawioConfig(value?: unknown): DrawioConfig;
/** The subset of config the browser needs; the host stays authoritative for the rest. */
export interface DrawioClientConfig {
    editorUrl: string;
    diagramsDir: string;
    autosaveDelayMs: number;
    writeDebounceMs: number;
    uiTheme: DrawioUiTheme;
    language: string;
    allowOutsideWorkspace: boolean;
    webappVersion: string;
}
export declare function clientConfigOf(config: DrawioConfig): DrawioClientConfig;
//# sourceMappingURL=config.d.ts.map