// fengari-web ships no types. Only the two entry points the bridge uses are
// declared here, so a wrong call is a compile error rather than a runtime one in
// a 2018-era VM. The package is CommonJS, hence the default export.
declare module 'fengari-web' {
  export interface Fengari {
    /** Compile a Lua chunk and return a callable that runs it. */
    load(source: string, chunkname?: string): () => unknown;
    /** Lua string -> JS string. */
    to_jsstring(value: unknown): string;
  }
  const fengari: Fengari;
  export default fengari;
}
