/**
 * Options of the connection
 */
declare interface CDPOptions {
  /**
   * The URL of the connection
   *
   * @defaultValue "http://localhost:9222"
   */
  apiUrl?: string;
  /**
   * The path of the connection
   *
   * @defaultValue "json/version"
   */
  apiPath?: string;
  /**
   * The WebSocket URL of the connection
   */
  webSocketDebuggerUrl?: string;
  /**
   * The path to get all targets
   *
   * @defaultValue "json"
   */
  apiPathTargets?: string;
  /**
   * The path to create new target
   *
   * @defaultValue "json/new"
   */
  apiPathNewTarget?: string;
  /**
   * The path to activate a target
   *
   * @defaultValue "json/activate"
   */
  apiPathActivateTarget?: string;
  /**
   * The path to close a target
   *
   * @defaultValue "json/close"
   */
  apiPathCloseTarget?: string;
  /**
   * The maximum number of retries
   *
   * @defaultValue 20
   */
  connectionMaxRetry?: number;
  /**
   * The delay between retries
   *
   * @defaultValue 500
   */
  connectionRetryDelay?: number;
}

/**
 * Value of a {@link CDPObject}
 */
declare type CDPValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | CDPValue[]
  | { [key: string]: CDPValue };

/**
 * Object type used in the {@link CDP} API
 */
declare interface CDPObject {
  [key: string]: CDPValue;
}

/**
 * Connection
 */
declare interface CDPConnection extends EventTarget {
  /**
   * Indicates whether the connection is closed
   */
  readonly closed: boolean;
  /**
   * Open the connection
   *
   * @returns A promise that resolves when the connection is opened
   */
  open(): Promise<void>;
  /**
   * Send a message
   *
   * @param method The method of the message
   * @param params The parameters of the message
   * @param sessionId The session ID of the message
   * @returns The response
   */
  sendMessage(
    method: string,
    params?: CDPObject,
    sessionId?: string,
    // deno-lint-ignore no-explicit-any
  ): Promise<any>;
  /**
   * Close the connection
   *
   * @returns A promise that resolves when the connection is closed
   */
  close(): void;
}

/**
 * Event of domain event listeners
 *
 * The data is read-only, as in the events of the platform, so that a listener
 * cannot alter what the next ones receive.
 */
declare interface CDPEvent extends Event {
  /**
   * The parameters
   */
  // deno-lint-ignore no-explicit-any
  readonly params: any;
  /**
   * The session ID
   */
  readonly sessionId?: string;
}

/**
 * Function of domain event listeners
 *
 * @param event The event
 * @returns The result
 */
declare type CDPEventListener = (event: CDPEvent) => void | Promise<void>;

/**
 * Domain event listener registration methods
 */
declare class CDPDomainListeners {
  /**
   * Add an event listener
   *
   * @param type The type of the event
   * @param listener The listener of the event
   * @param options The options of the listener, as in
   * {@link EventTarget.addEventListener}
   */
  addEventListener(
    type: string,
    listener: CDPEventListener,
    options?: AddEventListenerOptions | boolean,
  ): void;
  /**
   * Remove an event listener
   *
   * @param type The type of the event
   * @param listener The listener of the event
   * @param options The options of the listener, as in
   * {@link EventTarget.removeEventListener}
   */
  removeEventListener(
    type: string,
    listener: CDPEventListener,
    options?: EventListenerOptions | boolean,
  ): void;
}

/**
 * Domain methods (e.g. `enable()`, `disable()`...)
 */
declare type CDPDomainMethods = {
  /**
   * Method of the domain
   *
   * @param args The arguments
   * @param sessionId The session ID
   * @returns The result
   */
  [Key in string as Uncapitalize<Key>]: (
    args?: CDPObject | null,
    sessionId?: string,
    // deno-lint-ignore no-explicit-any
  ) => Promise<any>;
};

/**
 * Domain of the API (e.g. `Page`, `Target`, `Runtime`...)
 */
declare type CDPDomain = CDPDomainListeners & CDPDomainMethods;

/**
 * Members of the API
 *
 * The instance dispatches an `open` event whenever a connection is established,
 * including the ones replacing a connection that was lost, and a
 * {@link CloseEvent} named `close` whenever it is closed.
 */
declare class CDPMembers extends EventTarget {
  /**
   * The options
   */
  options: CDPOptions;
  /**
   * The connection object
   */
  readonly connection: CDPConnection;
  /**
   * Reset the connection
   */
  reset(): void;
  /**
   * Reset the connection when the instance goes out of scope, so that it can be
   * declared with `using`
   */
  [Symbol.dispose](): void;
}

/**
 * Property key of a domain (e.g. "Page", "Target", "Runtime"...)
 *
 * Only capitalized keys are domains, which is what keeps them apart from the
 * members of {@link CDPMembers}
 */
declare type CDPDomainPropertyKey = Capitalize<string>;

/**
 * Target info
 */
declare interface CDPTargetInfo {
  /**
   * The target ID
   */
  id: string;
  /**
   * The target type
   */
  type: string;
  /**
   * The target title
   */
  title: string;
  /**
   * The target description
   */
  description: string;
  /**
   * The target URL
   */
  url: string;
  /**
   * The target WebSocket URL
   */
  webSocketDebuggerUrl: string;
  /**
   * The URL of the DevTools front-end for the target
   */
  devtoolsFrontendUrl: string;
  /**
   * The ID of the parent target, when the target has one
   */
  parentId?: string;
}

/**
 * API
 */
declare class CDP extends CDPMembers {
  /**
   * Create a new instance
   *
   * @param options The options
   */
  constructor(options?: CDPOptions);
  /**
   * The domains (e.g. "Page", "Target", "Runtime"...)
   */
  [key: CDPDomainPropertyKey]: CDPDomain;
  /**
   * Get the targets
   *
   * @returns The targets
   */
  static getTargets(): Promise<CDPTargetInfo[]>;
  /**
   * Create a target
   *
   * @param url The URL of the target
   *
   * @returns The target info
   */
  static createTarget(url?: string): Promise<CDPTargetInfo>;
  /**
   * Activate a target
   *
   * @param targetId The ID of the target
   * @returns A promise that resolves when the target is activated
   */
  static activateTarget(targetId: string): Promise<void>;
  /**
   * Close a target
   *
   * @param targetId The ID of the target
   * @returns A promise that resolves when the target is closed
   */
  static closeTarget(targetId: string): Promise<void>;
}

/**
 * API object
 */
declare const cdp: CDP;

/**
 * Options of the connection
 */
declare const options: CDPOptions;

/**
 * Get the targets
 */
declare const getTargets: typeof CDP.getTargets;
/**
 * Create a target
 */
declare const createTarget: typeof CDP.createTarget;
/**
 * Activate a target
 */
declare const activateTarget: typeof CDP.activateTarget;
/**
 * Close a target
 */
declare const closeTarget: typeof CDP.closeTarget;
/**
 * Error code of the connection refused error
 */
declare const CONNECTION_REFUSED_ERROR_CODE: string;
/**
 * Error code when encountering a connection error
 */
declare const CONNECTION_ERROR_CODE: string;
/**
 * Error code when the connection is closed before the response is received
 */
declare const CONNECTION_CLOSED_ERROR_CODE: string;

export {
  activateTarget,
  CDP,
  cdp,
  closeTarget,
  createTarget,
  getTargets,
  options,
  CONNECTION_REFUSED_ERROR_CODE,
  CONNECTION_ERROR_CODE,
  CONNECTION_CLOSED_ERROR_CODE,
};

export type {
  CDPConnection,
  CDPDomain,
  CDPEvent,
  CDPEventListener,
  CDPObject,
  CDPOptions,
  CDPTargetInfo,
  CDPValue,
};