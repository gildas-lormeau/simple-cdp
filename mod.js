/// <reference types="./mod.d.ts" />

const UNDEFINED_VALUE = undefined;
const MESSAGE_EVENT = "message";
const OPEN_EVENT = "open";
const CLOSE_EVENT = "close";
const ERROR_EVENT = "error";
const CONNECTION_REFUSED_ERROR_CODE = "ConnectionRefused";
const EVENT_LISTENERS = ["addEventListener", "removeEventListener"];
const MIN_INVALID_HTTP_STATUS_CODE = 400;
const DEFAULT_URL = "http://localhost:9222";
const DEFAULT_PATH = "json/version";
const DEFAULT_PATH_TARGETS = "json";
const DEFAULT_PATH_NEW_TARGET = "json/new";
const DEFAULT_PATH_ACTIVATE_TARGET = "json/activate";
const DEFAULT_PATH_CLOSE_TARGET = "json/close";
const DEFAULT_CONNECTION_MAX_RETRY = 20;
const DEFAULT_CONNECTION_RETRY_DELAY = 500;
const DEFAULT_OPTIONS = {
    apiUrl: DEFAULT_URL,
    apiPath: DEFAULT_PATH,
    apiPathTargets: DEFAULT_PATH_TARGETS,
    apiPathNewTarget: DEFAULT_PATH_NEW_TARGET,
    apiPathActivateTarget: DEFAULT_PATH_ACTIVATE_TARGET,
    apiPathCloseTarget: DEFAULT_PATH_CLOSE_TARGET,
    connectionMaxRetry: DEFAULT_CONNECTION_MAX_RETRY,
    connectionRetryDelay: DEFAULT_CONNECTION_RETRY_DELAY
};

class CDP {
    connection;
    options = Object.assign({}, options);
    #pendingEventListenerCalls = [];

    constructor(options) {
        // deno-lint-ignore no-this-alias
        const cdp = this;
        const proxy = new Proxy(Object.create(null), {
            get(target, propertyName) {
                if (propertyName in cdp) {
                    return cdp[propertyName];
                } else if (propertyName in target) {
                    return target[propertyName];
                } else {
                    return getDomain(target, propertyName);
                }
            }
        });
        Object.assign(cdp.options, options);
        return proxy;

        function getDomain(target, domainName) {
            target[domainName] = new Proxy(Object.create(null), {
                get(target, methodName) {
                    if (methodName in target) {
                        return target[methodName];
                    } else {
                        return getDomainMethod(target, methodName, domainName);
                    }
                }
            });
            return target[domainName];
        }

        function getDomainMethod(target, methodName, domainName) {
            if (EVENT_LISTENERS.includes(methodName)) {
                target[methodName] = getDomainListenerFunction(methodName, domainName);
            } else {
                target[methodName] = getDomainMethodFunction(methodName, domainName);
            }
            return target[methodName];
        }

        function getDomainListenerFunction(methodName, domainName) {
            return (type, listener) => {
                if (cdp.connection === UNDEFINED_VALUE) {
                    cdp.#pendingEventListenerCalls.push({ methodName, domainName, type, listener });
                } else {
                    cdp.connection[methodName](`${domainName}.${type}`, listener);
                }
            };
        }

        function getDomainMethodFunction(methodName, domainName) {
            return async (params = {}, sessionId) => {
                await ready();
                while (cdp.#pendingEventListenerCalls.length > 0) {
                    const { methodName, domainName, type, listener } = cdp.#pendingEventListenerCalls.shift();
                    cdp.connection[methodName](`${domainName}.${type}`, listener);
                }
                return cdp.connection.sendMessage(`${domainName}.${methodName}`, params, sessionId);
            };
        }

        async function ready() {
            if (cdp.connection === UNDEFINED_VALUE) {
                let webSocketDebuggerUrl = cdp.options.webSocketDebuggerUrl;
                if (webSocketDebuggerUrl === UNDEFINED_VALUE) {
                    const url = new URL(cdp.options.apiPath, cdp.options.apiUrl);
                    ({ webSocketDebuggerUrl } = await fetchData(url, cdp.options));
                }
                const connection = new Connection(webSocketDebuggerUrl);
                await connection.open();
                cdp.connection = connection;
            }
        }
    }
    get options() {
        return this.options;
    }
    set options(value) {
        Object.assign(this.options, value);
    }
    reset() {
        if (this.connection !== UNDEFINED_VALUE) {
            this.connection.close();
            this.connection = UNDEFINED_VALUE;
            this.#pendingEventListenerCalls.length = 0;
        }
    }
    static getTargets() {
        const { apiPathTargets, apiUrl } = options;
        return fetchData(new URL(apiPathTargets, apiUrl), options);
    }
    static createTarget(url) {
        const { apiPathNewTarget, apiUrl } = options;
        const path = url ? `${apiPathNewTarget}?${url}` : apiPathNewTarget;
        return fetchData(new URL(path, apiUrl), options, "PUT");
    }
    static async activateTarget(targetId) {
        const { apiPathActivateTarget, apiUrl } = options;
        await fetchData(new URL(`${apiPathActivateTarget}/${targetId}`, apiUrl), options);
    }
    static async closeTarget(targetId) {
        const { apiPathCloseTarget, apiUrl } = options;
        await fetchData(new URL(`${apiPathCloseTarget}/${targetId}`, apiUrl)), options;
    }
}

const options = Object.assign({}, DEFAULT_OPTIONS);
const cdp = new CDP(options);
const getTargets = CDP.getTargets;
const createTarget = CDP.createTarget;
const activateTarget = CDP.activateTarget;
const closeTarget = CDP.closeTarget;
export { cdp, CDP, options, getTargets, createTarget, activateTarget, closeTarget };

class Connection extends EventTarget {
    #webSocketDebuggerUrl;
    #webSocket;
    #pendingRequests = new Map();
    #nextRequestId = 0;

    constructor(webSocketDebuggerUrl) {
        super();
        this.#webSocketDebuggerUrl = webSocketDebuggerUrl;
    }
    open() {
        this.#webSocket = new WebSocket(this.#webSocketDebuggerUrl);
        this.#webSocket.addEventListener(MESSAGE_EVENT, (event) => this.#onMessage(JSON.parse(event.data)));
        return new Promise((resolve, reject) => {
            this.#webSocket.addEventListener(OPEN_EVENT, () => resolve());
            this.#webSocket.addEventListener(CLOSE_EVENT, (event) => reject(new Error(event.reason)));
            this.#webSocket.addEventListener(ERROR_EVENT, () => reject(new Error()));
        });
    }
    sendMessage(method, params = {}, sessionId) {
        const id = this.#nextRequestId++ % Number.MAX_SAFE_INTEGER;
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
                const errorEvent = new Error(error.message);
                errorEvent.code = error.code;
                pendingRequest.reject(errorEvent);
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

function fetchData(url, options, method) {
    return retry(async () => {
        let response;
        try {
            response = await fetch(url, { method });
        } catch (error) {
            error.code = CONNECTION_REFUSED_ERROR_CODE;
            throw error;
        }
        if (response.status >= MIN_INVALID_HTTP_STATUS_CODE) {
            throw new Error(await response.text());
        } else {
            return response.json();
        }
    }, options);
}

async function retry(fn, options, retryCount = 0) {
    const { connectionMaxRetry, connectionRetryDelay } = options;
    try {
        return await fn();
    } catch (error) {
        if (error.code == CONNECTION_REFUSED_ERROR_CODE && retryCount < connectionMaxRetry) {
            await new Promise((resolve) => setTimeout(resolve, connectionRetryDelay));
            return retry(fn, options, retryCount + 1);
        } else {
            throw error;
        }
    }
}