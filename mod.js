/// <reference types="./mod.d.ts" />

const EMPTY_OBJECT = Object.create(null);
const UNDEFINED_VALUE = undefined;
const MESSAGE_EVENT = "message";
const OPEN_EVENT = "open";
const CLOSE_EVENT = "close";
const ERROR_EVENT = "error";
const EVENT_LISTENERS = ["addEventListener", "removeEventListener"];
const READY_PROPERTY = "ready";
const DEFAULT_URL = "http://localhost:9222";
const DEFAULT_PATH = "json/version";
const DEFAULT_CONNECTION_MAX_RETRY = 20;
const DEFAULT_CONNECTION_RETRY_DELAY = 500;

let connection;
const options = {
    url: DEFAULT_URL,
    path: DEFAULT_PATH,
    connectionMaxRetry: DEFAULT_CONNECTION_MAX_RETRY,
    connectionRetryDelay: DEFAULT_CONNECTION_RETRY_DELAY
};
const apiProxy = new Proxy(EMPTY_OBJECT, {
    get(target, domainName) {
        if (!(domainName in target)) {
            target[domainName] = new Proxy(EMPTY_OBJECT, {
                get(_, methodName) {
                    if (EVENT_LISTENERS.includes(methodName)) {
                        return (type, listener) => connection[methodName](`${domainName}.${type}`, listener);
                    } else {
                        return async (params = {}, sessionId) => {
                            await ready();
                            return connection.sendMessage(`${domainName}.${methodName}`, params, sessionId);
                        };
                    }
                }
            });
        }
        return target[domainName];
    }
});
const api = Object.assign(apiProxy, { options, connection, reset });
Object.defineProperty(api, READY_PROPERTY, { get: ready });
export default api;

async function ready() {
    if (connection === UNDEFINED_VALUE) {
        connection = await createConnection(options);
    }
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
    #pendingRequests = new Map();
    #nextRequestId = 0;

    constructor(options = {}) {
        super();
        this.#url = options.url;
        this.#path = options.path;
    }

    async open() {
        const response = await fetch(new URL(this.#path, this.#url));
        const { webSocketDebuggerUrl } = await response.json();
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

async function createConnection(options, attemptCount = 0) {
    const connection = new Connection(options);
    try {
        await connection.open();
        return connection;
    } catch (error) {
        if (attemptCount < options.connectionMaxRetry) {
            await new Promise((resolve) => setTimeout(resolve, options.connectionRetryDelay));
            return createConnection(options, attemptCount + 1);
        } else {
            throw error;
        }
    }
}