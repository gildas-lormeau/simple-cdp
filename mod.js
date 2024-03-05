/// <reference types="./mod.d.ts" />

const UNDEFINED_VALUE = undefined;
const MESSAGE_EVENT = "message";
const OPEN_EVENT = "open";
const CLOSE_EVENT = "close";
const ERROR_EVENT = "error";
const EVENT_LISTENERS = ["addEventListener", "removeEventListener"];
const OPTIONS_PROPERTY = "options";
const CONNECTION_PROPERTY = "connection";
const GET_TARGETS_PROPERTY = "getTargets";
const RESET_PROPERTY = "reset";
const DEFAULT_URL = "http://localhost:9222";
const DEFAULT_PATH = "json/version";
const DEFAULT_PATH_TARGETS = "json";
const DEFAULT_CONNECTION_MAX_RETRY = 20;
const DEFAULT_CONNECTION_RETRY_DELAY = 500;

let connection;
const options = {
    url: DEFAULT_URL,
    path: DEFAULT_PATH,
    pathTargets: DEFAULT_PATH_TARGETS,
    connectionMaxRetry: DEFAULT_CONNECTION_MAX_RETRY,
    connectionRetryDelay: DEFAULT_CONNECTION_RETRY_DELAY
};
const pendingEventListenerCalls = [];
const api = new Proxy(Object.create(null), {
    get(target, domainName) {
        if (!(domainName in target)) {
            target[domainName] = new Proxy(Object.create(null), {
                get(_, methodName) {
                    if (EVENT_LISTENERS.includes(methodName)) {
                        return (type, listener) => {
                            if (connection === UNDEFINED_VALUE) {
                                pendingEventListenerCalls.push({ methodName, type, listener });
                            } else {
                                connection[methodName](`${domainName}.${type}`, listener);
                            }
                        };
                    } else {
                        return async (params = {}, sessionId) => {
                            await ready();
                            if (pendingEventListenerCalls.length > 0) {
                                for (const { methodName, type, listener } of pendingEventListenerCalls) {
                                    connection[methodName](`${domainName}.${type}`, listener);
                                }
                                pendingEventListenerCalls.length = 0;
                            }
                            return connection.sendMessage(`${domainName}.${methodName}`, params, sessionId);
                        };
                    }
                }
            });
        }
        return target[domainName];
    }
});
Object.defineProperty(api, OPTIONS_PROPERTY, {
    get: () => options,
    set: (value) => Object.assign(options, value)
});
Object.defineProperty(api, CONNECTION_PROPERTY, { get: () => connection });
Object.defineProperty(api, GET_TARGETS_PROPERTY, { value: getTargets });
Object.defineProperty(api, RESET_PROPERTY, { value: reset });
export default api;

async function ready() {
    if (connection === UNDEFINED_VALUE) {
        connection = await retry(async () => {
            const connection = new Connection(options);
            await connection.open();
            return connection;
        }, options.connectionMaxRetry, options.connectionRetryDelay);
    }
}

function getTargets() {
    return retry(async () => {
        const response = await fetch(new URL(options.pathTargets, options.url));
        return response.json();
    }, options.connectionMaxRetry, options.connectionRetryDelay);
}

async function reset() {
    if (connection !== UNDEFINED_VALUE) {
        connection.close();
        await ready();
    }
}

class Connection extends EventTarget {
    #webSocket;
    #url;
    #path;
    #webSocketDebuggerUrl;
    #pendingRequests = new Map();
    #nextRequestId = 0;

    constructor(options = {}) {
        super();
        if (options.webSocketDebuggerUrl === UNDEFINED_VALUE) {
            this.#url = options.url;
            this.#path = options.path;
        } else {
            this.#webSocketDebuggerUrl = options.webSocketDebuggerUrl;
        }
    }

    async open() {
        let webSocketDebuggerUrl;
        if (this.#webSocketDebuggerUrl === UNDEFINED_VALUE) {
            const response = await fetch(new URL(this.#path, this.#url));
            ({ webSocketDebuggerUrl } = await response.json());
        } else {
            webSocketDebuggerUrl = this.#webSocketDebuggerUrl;
        }
        this.#webSocket = new WebSocket(webSocketDebuggerUrl);
        this.#webSocket.addEventListener(MESSAGE_EVENT, (event) => this.#onMessage(JSON.parse(event.data)));
        return new Promise((resolve, reject) => {
            this.#webSocket.addEventListener(OPEN_EVENT, () => resolve());
            this.#webSocket.addEventListener(CLOSE_EVENT, (event) => reject(new Error(event.reason)));
            this.#webSocket.addEventListener(ERROR_EVENT, () => reject(new Error()));
        });
    }

    sendMessage(method, params = {}, sessionId) {
        const id = this.#nextRequestId++;
        const message = JSON.stringify({ id, method, params, sessionId });
        this.#webSocket.send(message);
        let pendingRequest;
        const promise = new Promise((resolve, reject) => (pendingRequest = { resolve, reject }));
        this.#pendingRequests.set(id, pendingRequest);
        return promise;
    }

    close() {
        this.#webSocket.close();
    }

    #onMessage({ id, method, result, error, params, sessionId }) {
        if (id !== UNDEFINED_VALUE) {
            const pendingRequest = this.#pendingRequests.get(id);
            if (error === UNDEFINED_VALUE) {
                pendingRequest.resolve(result);
            } else {
                const exception = new Error(error.message);
                exception.code = error.code;
                pendingRequest.reject(exception);
            }
            this.#pendingRequests.delete(id);
        }
        if (method !== UNDEFINED_VALUE) {
            const event = new Event(method);
            Object.assign(event, { params, sessionId });
            this.dispatchEvent(event);
        }
    }
}

async function retry(fn, maxRetry = 20, retryDelay = 500, retryCount = 0) {
    try {
        return await fn();
    } catch (error) {
        if (retryCount < maxRetry) {
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
            return retry(fn, maxRetry, retryDelay, retryCount + 1);
        } else {
            throw error;
        }
    }
}