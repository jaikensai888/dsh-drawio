import type { UserConfig } from 'tsdown'

const PACKAGE_ID = 'dsh-drawio'

/**
 * Specifiers resolvable inside a DSH client bundle. This is exactly the
 * platform module table of `@deepseek-ai/dsh-client-modules` (plus the two
 * UI packages we may legitimately reach). Anything else must be bundled in.
 *
 * Deliberately NOT listed: bare `cordis` and
 * `@deepseek-ai/dsh-client-runtime/client` — neither resolves on this
 * machine, so requiring them would break the bundle at load time.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/**
 * Build the classic-script client bundle. The banner/intro/footer trio is the
 * whole magic: `lib/client.js` must be a `window.__ModuleLoader__.load({...})`
 * call whose factory only *registers* the module (all side effects, including
 * component code, run when the factory is materialised).
 */
function clientBundle(entryFile: string, moduleId: string): UserConfig {
  return {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    // Never clean: DSH Desktop holds lib/*.js open, so rm -rf lib fails with
    // EPERM on Windows, and in-place overwrite is what keeps dsh-client-hmr
    // (which polls lib/client.js) able to hot-swap the client half.
    clean: false,
    external: CLIENT_EXTERNALS,
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: entryFile,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(moduleId)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
  },
  clientBundle('client.js', PACKAGE_ID),
] satisfies UserConfig[]
