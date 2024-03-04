/**
 * The API members
 */
declare interface CDPMembers {
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
declare interface CDPConnection {
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
 * Event of domain listeners
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
 * Function of domain listeners
 */
declare type CDPEventListener = (evt: CDPEvent) => void | Promise<void>;

/**
 * Domain listeners
 */
declare interface CDPDomainListeners {
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
declare type CDPDomainMembers = {
  /**
   * Method of the event target
   *
   * @param args The arguments
   * @param sessionId The session ID
   * @returns The result
   */
  [Key in Exclude<string, keyof CDPDomainListeners> as Uncapitalize<Key>]: (
    args: object,
    sessionId?: string,
  ) => Promise<object>;
};

/**
 * Domain of the API (e.g. "Page", "Target", "Runtime"...)
 */
declare type CDPDomain = CDPDomainListeners & CDPDomainMembers;

/**
 * The API domains
 */
declare type CDPDomains = {
  /**
   * Domain
   */
  [Key in string as Capitalize<Key>]: CDPDomain;
};

/**
 * The API
 */
declare type CDP = CDPMembers & CDPDomains;

/**
 * The API object
 */
declare const api: CDP;

export default api;
