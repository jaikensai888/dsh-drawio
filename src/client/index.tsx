import type { Context } from '@deepseek-ai/cordis'
import type {} from 'dsh-better-sidebar'
import type { FileViewerDescriptor, FileViewerProps, SessionScope } from 'dsh-better-sidebar/client/service'
import { DrawioApiError, readDiagram } from './api.js'
import { DiagramViewer, type DiagramLoadPayload } from './DiagramViewer.js'
import { FOOTER_ACTION_SLOT, NewDiagramButton } from './NewDiagramButton.js'

/**
 * Client-half plugin.
 *
 * `inject` holds *cordis service names* — do not confuse it with
 * `dsh.client.inject` in package.json, which holds package names and only
 * controls client-bundle arrival order. `slots` is the UI slot registry the
 * official sidebar declares `sidebar.footer.action` on.
 */
export const inject = ['betterSidebar', 'slots'] as const

/** Namespaced so it can never collide with a builtin viewer id. */
export const DIAGRAM_VIEWER_ID = 'dsh-drawio:diagram'

const VIEWER_TITLE = '图表编辑器'

/** The slice of the slot registry this plugin uses. */
interface SlotsService {
  register(options: Record<string, unknown>, component: unknown): () => void
  /** Runs the callback per declaration lifetime of the slot; a no-op while undeclared. */
  inject(key: string, callback: () => () => void): () => void
}

/**
 * Load a diagram through our own fenced host route.
 *
 * `fetchStrategy: 'custom'` means the sidebar calls this and renders the
 * component with the resolved value as `customData`; a rejection becomes the
 * sidebar's own error panel. A missing file is therefore NOT an error here —
 * it is a state the viewer turns into a "create it?" affordance.
 */
export async function loadDiagram(
  path: string,
  scope: SessionScope,
  signal?: AbortSignal,
): Promise<DiagramLoadPayload> {
  try {
    return { kind: 'ready', diagram: await readDiagram(scope, path, signal) }
  } catch (error) {
    if (error instanceof DrawioApiError && error.status === 404) {
      return { kind: 'missing', path }
    }
    throw error
  }
}

/** The descriptor handed to `ctx.betterSidebar.registerFileViewer`. */
export function createDiagramViewerDescriptor(): FileViewerDescriptor {
  return {
    id: DIAGRAM_VIEWER_ID,
    title: VIEWER_TITLE,
    // `.drawio` is currently unclaimed and would otherwise fall through to the
    // catch-all `code` viewer (priority -100); priority 0 wins outright.
    exts: ['drawio', 'dio'],
    priority: 0,
    // Bytes come from /drawio/api/read, not better-sidebar's fs.read: that one
    // truncates at 512KB, resolves relative paths against the git root and
    // applies no isWithin fence.
    fetchStrategy: 'custom',
    load: (path: string, scope: SessionScope, signal?: AbortSignal) => loadDiagram(path, scope, signal),
    component: (props: FileViewerProps) => <DiagramViewer {...props} />,
  }
}

export function apply(ctx: Context): void {
  // registerFileViewer returns the disposer; ctx.effect wires it to fiber
  // disposal so HMR / unmount never leaves a duplicate registration behind
  // (a duplicate id throws).
  ctx.effect(() => ctx.betterSidebar.registerFileViewer(createDiagramViewerDescriptor()))

  const slots = (ctx as Context & { slots?: SlotsService }).slots
  if (slots === undefined) return

  // `slots.inject` waits for the sidebar's declaration instead of racing it:
  // an undeclared slot throws at register() time, and a declaration that
  // collapses later disposes this entry and re-runs the callback.
  ctx.effect(() => slots.inject(FOOTER_ACTION_SLOT, () => slots.register({
    name: FOOTER_ACTION_SLOT,
    // `list`-kind slots key their entries by id.
    id: 'dsh-drawio:new-diagram',
    order: 100,
    registrant: 'dsh-drawio',
  }, () => <NewDiagramButton ctx={ctx} />)))
}
