import type { Context } from '@deepseek-ai/cordis';
/**
 * Cold start entry (A): a 「新建图纸」 button in the **official** left sidebar's
 * footer slot.
 *
 * Without this a fresh workspace has no way in at all — the `.drawio` file
 * viewer only appears once a `.drawio` exists. `sidebar.footer.action` is a
 * `list`-kind slot declared by `@deepseek-ai/dsh-client-ui-sidebar`, and it is
 * the only additive seat the official sidebar offers.
 *
 * The active session comes from the sidebar service snapshot rather than from
 * slot props: the slot is `scope: 'root'`, so its owner props carry no session,
 * and `getSnapshot().sessionId` is exactly what better-sidebar itself uses.
 */
/** The slot this button occupies. */
export declare const FOOTER_ACTION_SLOT = "sidebar.footer.action";
export declare function NewDiagramButton({ ctx, wide }: {
    ctx: Context;
    wide?: boolean;
}): JSX.Element;
//# sourceMappingURL=NewDiagramButton.d.ts.map