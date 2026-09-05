/**
 * The WebMCP DOM surface, transcribed from the specification
 * (WebMCP, Draft Community Group Report, 4 September 2026 —
 * https://webmachinelearning.github.io/webmcp/, §"The ModelContext interface" and
 * §"Tool annotations"). TypeScript's DOM library does not know these yet.
 *
 * They are declared as plain interfaces rather than as a global augmentation of `Document`
 * on purpose: an augmentation would let any module write `document.modelContext.registerTool(...)`
 * without feature-detecting first, and the whole point of this level is that an unsupported
 * browser is completely unaffected. Everything goes through `getModelContext()`.
 *
 * IDL, verbatim from the spec:
 *   Promise<undefined>                registerTool(ModelContextTool tool,
 *                                                  optional ModelContextRegisterToolOptions options = {});
 *   Promise<sequence<RegisteredTool>> getTools(optional ModelContextGetToolOptions options = {});
 *   Promise<DOMString>                executeTool(RegisteredTool tool,
 *                                                  optional object inputObject = {},
 *                                                  optional ModelContextExecuteToolOptions options = {});
 *   callback ToolExecuteCallback = Promise<any> (object inputObject, ToolExecuteCallbackOptions options);
 *   dictionary ToolAnnotations { boolean readOnlyHint = false;
 *                                boolean untrustedContentHint = false;
 *                                boolean consequentialHint = false; };
 *
 * Note that `executeTool` resolves to a DOMString: whatever `execute` returns is stringified by
 * the user agent before an agent sees it. Our handlers therefore return a string themselves
 * (a JSON envelope) so the bytes the model reads are exactly the bytes we chose.
 */

/** The three hints the spec defines. There is no `destructiveHint`/`idempotentHint`/`openWorldHint` in WebMCP. */
export interface ToolAnnotationsInit {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
}

export interface ToolExecuteCallbackOptions {
  /** Aborted when the agent cancels the call or the tool is unregistered. */
  signal: AbortSignal;
}

export type ToolExecuteCallback = (input: Record<string, unknown>, options: ToolExecuteCallbackOptions) => Promise<unknown>;

export interface ModelContextTool {
  /** 1-128 chars of ASCII alphanumerics, `_`, `-`, `.` (spec §"register a tool"). */
  name: string;
  description: string;
  title?: string;
  /** A JSON Schema object. */
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotationsInit;
  execute: ToolExecuteCallback;
}

export interface ModelContextRegisterToolOptions {
  /** Unregisters the tool when aborted. Our only unregistration mechanism. */
  signal?: AbortSignal;
  /** Origins the tool is exposed to. Omitted: we expose to the agent driving this page only. */
  exposedTo?: string[];
}

export interface RegisteredTool {
  name: string;
  description?: string;
  title?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotationsInit;
}

export interface ModelContext extends EventTarget {
  registerTool(tool: ModelContextTool, options?: ModelContextRegisterToolOptions): Promise<void>;
  getTools?(options?: Record<string, unknown>): Promise<RegisteredTool[]>;
  executeTool?(tool: RegisteredTool, input?: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<string>;
}

export type WebMcpDocument = Document & { modelContext?: ModelContext };

/** The `toolchange` event the spec fires on the ModelContext when the registered set changes. */
export const TOOLCHANGE_EVENT = 'toolchange';

/**
 * Feature detection. `'modelContext' in document` is the check the spec and Chrome's docs use.
 * Everything else in this module is unreachable when it returns undefined, which is what keeps
 * an unsupported browser byte-for-byte unaffected.
 */
export function getModelContext(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): ModelContext | undefined {
  if (!doc || !('modelContext' in doc)) return undefined;
  const candidate = (doc as WebMcpDocument).modelContext;
  return candidate && typeof candidate.registerTool === 'function' ? candidate : undefined;
}
