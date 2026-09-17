import type { FileViewerProps } from 'dsh-better-sidebar/client/service';
/**
 * `.drawio` previewer backed by the self-hosted draw.io webapp.
 *
 * The editor runs in a plain same-origin iframe created by THIS component.
 *
 * ★ Do not add a `sandbox` attribute. drawio dies silently inside any sandbox
 * without `allow-same-origin` (its `localStorage` access throws on an opaque
 * origin and initialisation aborts without ever posting `init`). For the same
 * reason this viewer must never be hosted inside better-sidebar's browser/HTML
 * preview tabs, which are sandboxed frames.
 */
export declare function DiagramViewer({ path, title }: FileViewerProps): JSX.Element;
//# sourceMappingURL=DiagramViewer.d.ts.map