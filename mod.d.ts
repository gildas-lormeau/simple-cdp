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
   * The path to activate a ‡target
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
 * Value of a plain object
 */
declare type CDPObjectValue =
  | string
  | number
  | boolean
  | CDPObject
  | CDPObjectValue[];

/**
 * Plain object
 */
declare interface CDPObject {
  [key: string]: CDPObjectValue;
}

/**
 * Connection
 */
declare interface CDPConnection {
  /**
   * Open the connection
   *
   * @returns A promise that resolves when the connection is opened
   */
  open(): Promise<void>;
  /**
   * Send a message to the connection
   *
   * @param method The method of the message
   * @param params The parameters of the message
   * @param sesssionId The session ID of the message
   * @returns The response
   */
  sendMessage(
    method: string,
    params: CDPObject,
    sesssionId?: string,
  ): Promise<CDPObject>;
  /**
   * Close the connection
   *
   * @returns A promise that resolves when the connection is closed
   */
  close(): void;
}

/**
 * Event of domain event listeners
 */
declare interface CDPEvent {
  /**
   * The event type
   */
  type: string;
  /**
   * The parameters
   */
  params: CDPObject;
  /**
   * The session ID
   */
  sessionId?: string;
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
   */
  addEventListener(
    type: string,
    listener: CDPEventListener,
  ): void;
  /**
   * Remove an event listener
   *
   * @param type The type of the event
   * @param listener The listener of the event
   */
  removeEventListener(
    type: string,
    listener: CDPEventListener,
  ): void;
}

/**
 * Domain methods (e.g. "enable", "disable"...)
 */
declare type CDPDomainMethods = {
  /**
   * Method of the domain
   *
   * @param args The arguments
   * @param sessionId The session ID
   * @returns The result
   */
  [Key in Exclude<string, keyof CDPDomainListeners> as Uncapitalize<Key>]: (
    args?: CDPObject | null,
    sessionId?: string,
  ) => Promise<CDPObject>;
};

/**
 * Domain of the API (e.g. "Page", "Target", "Runtime"...)
 */
declare type CDPDomain = CDPDomainListeners & CDPDomainMethods;

/**
 * Members of the API
 */
declare class CDPMembers {
  /**
   * The options
   */
  options: CDPOptions;
  /**
   * The connection object
   */
  connection: CDPConnection;
  /**
   * Reset the connection
   */
  reset(): void;
}

/**
 * Property key of a domain
 */
declare type CDPDomainPropertyKey = Capitalize<
  Exclude<string, keyof CDPMembers>
>;

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
   * The target URL
   */
  url: string;
  /**
   * The target WebSocket URL
   */
  webSocketDebuggerUrl: string;
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

export { activateTarget, CDP, cdp, closeTarget, createTarget, getTargets };
