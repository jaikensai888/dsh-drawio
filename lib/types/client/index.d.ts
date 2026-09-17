import type { Context } from '@deepseek-ai/cordis';
import type { FileViewerDescriptor } from 'dsh-better-sidebar/client/service';
/**
 * Client-half plugin: register a `.drawio` file previewer on the
 * dsh-better-sidebar service. `inject` holds *cordis service names* — do not
 * confuse it with `dsh.client.inject` in package.json, which holds package
 * names and only controls client-bundle arrival order.
 */
export declare const inject: readonly ["betterSidebar"];
/** Namespaced so it can never collide with a builtin viewer id. */
export declare const DIAGRAM_VIEWER_ID = "dsh-drawio:diagram";
/** The descriptor handed to `ctx.betterSidebar.registerFileViewer`. */
export declare function createDiagramViewerDescriptor(): FileViewerDescriptor;
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map