declare interface API {
  /**
   * @property {Options} options - The options of the connection
   */
  options: Options;
  /**
   * @property {Connection} connection - The connection object
   */
  connection: Connection;
  /**
   * @property {Promise<void>} ready - A promise that resolves when the connection is ready
   */
  ready: Promise<void>;
  /**
   * @method {void} reset - Reset the connection
   */
  reset(): void;
}

declare interface Options {
  /**
   * @property {string} url - The URL of the connection
   */
  url: string;
  /**
   * @property {string} path - The path of the connection
   */
  path: string;
  /**
   * @property {string} connectionMaxRetry - The maximum number of retries
   */
  connectionMaxRetry: number;
  /**
   * @property {number} connectionRetryDelay - The delay between retries
   */
  connectionRetryDelay: number;
}

declare class Connection {
  /**
   * @param options - The options of the connection
   */
  constructor(options?: Options);
  /**
   * @method {Promise<void>} open - Open the connection
   */
  open(): Promise<void>;
  /**
   * @method {Promise<object>} sendMessage - Send a message to the connection
   * @param method - The method of the message
   * @param params - The parameters of the message
   * @param sesssionId - The session ID of the message
   */
  sendMessage(
    method: string,
    params: object,
    sesssionId?: string,
  ): Promise<object>;
  /**
   * @method {void} close - Close the connection
   */
  close(): void;
}

declare interface EventTarget {
  /**
   * @method {void} addEventListener - Add an event listener
   * @param type - The type of the event
   * @param listener - The listener of the event
   */
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void;
  /**
   * @method {void} removeEventListener - Remove an event listener
   * @param type - The type of the event
   * @param listener - The listener of the event
   */
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void;
}

declare const api:
  & API
  & {
    [Key in string as Capitalize<Key>]: EventTarget;
  };

export default api;
