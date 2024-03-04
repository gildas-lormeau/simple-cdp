/**
 * The API of the connection
 */
declare interface CDPAPI {
  /**
   * The options of the connection
   */
  options: CDPOptions;
  /**
   * The connection object
   */
  connection: CDPConnection;
  /**
   * A promise that resolves when the connection is ready
   */
  ready: Promise<void>;
  /**
   * Reset the connection
   */
  reset(): void;
}

/**
 * The options of the connection
 */
declare interface CDPOptions {
  /**
   * The URL of the connection
   *
   * @defaultValue "http://localhost:9222"
   */
  url: string;
  /**
   * The path of the connection
   *
   * @defaultValue "json/version"
   */
  path: string;
  /**
   * The maximum number of retries
   *
   * @defaultValue 20
   */
  connectionMaxRetry: number;
  /**
   * The delay between retries
   *
   * @defaultValue 500
   */
  connectionRetryDelay: number;
}

/**
 * The connection class
 */
declare class CDPConnection {
  /**
   * The constructor of the connection
   *
   * @param options The options of the connection
   */
  constructor(options?: CDPOptions);
  /**
   * Open the connection
   */
  open(): Promise<void>;
  /**
   *  Send a message to the connection
   *
   * @param method The method of the message
   * @param params The parameters of the message
   * @param sesssionId The session ID of the message
   */
  sendMessage(
    method: string,
    params: object,
    sesssionId?: string,
  ): Promise<object>;
  /**
   * Close the connection
   */
  close(): void;
}

/**
 * Event of the Chrome DevTools Protocol
 */
declare interface CDPEvent {
  /**
   * Event type
   */
  type: string;
  /**
   * parameters
   */
  params: object;
  /**
   * session ID
   */
  sessionId?: string;
}

/**
 * Listener of the Chrome DevTools Protocol
 */
declare type CDPEventListener = (evt: CDPEvent) => void | Promise<void>;

/**
 * Event target of the Chrome DevTools Protocol
 */
declare interface CDPEventTargetListeners {
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
 * Methods of the event target
 */
declare type CDPEventTargetMethods = {
  [Key in Exclude<string, keyof CDPEventTargetListeners> as Uncapitalize<Key>]:
    (
      args: object,
      sessionId?: string,
    ) => Promise<object>;
};

declare type CDPEventTarget = CDPEventTargetListeners & CDPEventTargetMethods;

/**
 * The API objects
 */
declare type CDPAPIObjects = {
  [Key in string as Capitalize<Key>]: CDPEventTarget;
};

declare const api: CDPAPI & CDPAPIObjects;

export default api;
