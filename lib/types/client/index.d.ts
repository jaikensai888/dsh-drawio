import type { Context } from '@deepseek-ai/cordis';
import type { FileViewerDescriptor, SessionScope } from 'dsh-better-sidebar/client/service';
import { type DiagramLoadPayload } from './DiagramViewer.js';
/**
 * Client-half plugin.
 *
 * `inject` holds *cordis service names* — do not confuse it with
 * `dsh.client.inject` in package.json, which holds package names and only
 * controls client-bundle arrival order. `slots` is the UI slot registry the
 * official sidebar declares `sidebar.footer.action` on.
 */
export declare const inject: readonly ["betterSidebar", "slots"];
/** Namespaced so it can never collide with a builtin viewer id. */
export declare const DIAGRAM_VIEWER_ID = "dsh-drawio:diagram";
/**
 * Load a diagram through our own fenced host route.
 *
 * `fetchStrategy: 'custom'` means the sidebar calls this and renders the
 * component with the resolved value as `customData`; a rejection becomes the
 * sidebar's own error panel. A missing file is therefore NOT an error here —
 * it is a state the viewer turns into a "create it?" affordance.
 */
export declare function loadDiagram(path: string, scope: SessionScope, signal?: AbortSignal): Promise<DiagramLoadPayload>;
/** The descriptor handed to `ctx.betterSidebar.registerFileViewer`. */
export declare function createDiagramViewerDescriptor(): FileViewerDescriptor;
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map