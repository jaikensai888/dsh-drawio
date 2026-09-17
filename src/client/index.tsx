import type { Context } from '@deepseek-ai/cordis'
import type {} from 'dsh-better-sidebar'
import type { FileViewerDescriptor, FileViewerProps } from 'dsh-better-sidebar/client/service'
import { DiagramViewer } from './DiagramViewer.js'

/**
 * Client-half plugin: register a `.drawio` file previewer on the
 * dsh-better-sidebar service. `inject` holds *cordis service names* — do not
 * confuse it with `dsh.client.inject` in package.json, which holds package
 * names and only controls client-bundle arrival order.
 */
export const inject = ['betterSidebar'] as const

/** Namespaced so it can never collide with a builtin viewer id. */
export const DIAGRAM_VIEWER_ID = 'dsh-drawio:diagram'

const VIEWER_TITLE = '图表编辑器'

/** The descriptor handed to `ctx.betterSidebar.registerFileViewer`. */
export function createDiagramViewerDescriptor(): FileViewerDescriptor {
  return {
    id: DIAGRAM_VIEWER_ID,
    title: VIEWER_TITLE,
    // `.drawio` is currently unclaimed and would otherwise fall through to the
    // catch-all `code` viewer (priority -100); priority 0 wins outright.
    exts: ['drawio', 'dio'],
    priority: 0,
    // P2 switches this to 'custom' and loads the file through /drawio/api/read;
    // the editor itself always talks to the host over the embed protocol.
    fetchStrategy: 'none',
    component: (props: FileViewerProps) => <DiagramViewer {...props} />,
  }
}

export function apply(ctx: Context): void {
  // registerFileViewer returns the disposer; ctx.effect wires it to fiber
  // disposal so HMR / unmount never leaves a duplicate registration behind
  // (a duplicate id throws).
  ctx.effect(() => ctx.betterSidebar.registerFileViewer(createDiagramViewerDescriptor()))
}
