/// <reference types="./mod.d.ts" />

const UNDEFINED_VALUE = undefined;
const MESSAGE_EVENT = "message";
const OPEN_EVENT = "open";
const CLOSE_EVENT = "close";
const ERROR_EVENT = "error";
const CONNECTION_REFUSED_ERROR_CODE = "ConnectionRefused";
const CONNECTION_ERROR_CODE = "ConnectionError";
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
    #connection;
    #options = Object.assign({}, options);
    #pendingEventListenerCalls = new Map();

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
        Object.assign(cdp.#options, options);
        return proxy;

        function getDomain(target, domainName) {
            target[domainName] = new Proxy(Object.create(null), {
                get(target, methodName) {
                    if (methodName in this) {
                        return this[methodName];
                    } else if (methodName in target) {
                        return target[methodName];
                    } else {
                        return getDomainMethodFunction(target, methodName, domainName);
                    }
                },
                addEventListener: getDomainListenerFunction("addEventListener", domainName),
                removeEventListener: getDomainListenerFunction("removeEventListener", domainName)
            });
            return target[domainName];
        }

        function getDomainMethodFunction(target, methodName, domainName) {
            target[methodName] = async (params = {}, sessionId) => {
                await ready();
                const pendingEventListenerCalls = cdp.#pendingEventListenerCalls.get(domainName);
                if (pendingEventListenerCalls !== UNDEFINED_VALUE) {
                    while (pendingEventListenerCalls.length > 0) {
                        const { methodName, domainName, type, listener } = pendingEventListenerCalls.shift();
                        cdp.#connection[methodName](`${domainName}.${type}`, listener);
                    }
                    cdp.#pendingEventListenerCalls.delete(domainName);
                }
                return cdp.#connection.sendMessage(`${domainName}.${methodName}`, params, sessionId);
            };
            return target[methodName];
        }

        function getDomainListenerFunction(methodName, domainName) {
            return (type, listener) => {
                if (cdp.#connection === UNDEFINED_VALUE) {
                    let pendingEventListenerCalls = cdp.#pendingEventListenerCalls.get(domainName);
                    if (pendingEventListenerCalls === UNDEFINED_VALUE) {
                        pendingEventListenerCalls = [];
                        cdp.#pendingEventListenerCalls.set(domainName, pendingEventListenerCalls);
                    }
                    pendingEventListenerCalls.push({ methodName, domainName, type, listener });
                } else {
                    cdp.#connection[methodName](`${domainName}.${type}`, listener);
                }
            };
        }

        async function ready() {
            if (cdp.#connection === UNDEFINED_VALUE) {
                let webSocketDebuggerUrl = cdp.#options.webSocketDebuggerUrl;
                if (webSocketDebuggerUrl === UNDEFINED_VALUE) {
                    const url = new URL(cdp.#options.apiPath, cdp.#options.apiUrl);
                    ({ webSocketDebuggerUrl } = await fetchData(url, cdp.#options));
                }
                const connection = new Connection(webSocketDebuggerUrl);
                await connection.open();
                cdp.#connection = connection;
            }
        }
    }
    get options() {
        return this.#options;
    }
    set options(value) {
        Object.assign(this.#options, value);
    }
    get connection() {
        return this.#connection;
    }
    reset() {
        if (this.#connection !== UNDEFINED_VALUE) {
            this.#connection.close();
            this.#connection = UNDEFINED_VALUE;
            this.#pendingEventListenerCalls.clear();
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
        await fetchData(new URL(`${apiPathCloseTarget}/${targetId}`, apiUrl), options);
    }
}

const options = Object.assign({}, DEFAULT_OPTIONS);
const cdp = new CDP(options);
const getTargets = CDP.getTargets;
const createTarget = CDP.createTarget;
const activateTarget = CDP.activateTarget;
const closeTarget = CDP.closeTarget;
export { cdp, CDP, options, getTargets, createTarget, activateTarget, closeTarget, CONNECTION_REFUSED_ERROR_CODE, CONNECTION_ERROR_CODE };

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
        const id = this.#nextRequestId;
        const message = JSON.stringify({ id, method, params, sessionId });
        this.#nextRequestId = (this.#nextRequestId + 1) % Number.MAX_SAFE_INTEGER;
        this.#webSocket.send(message);
        let pendingRequest;
        const promise = new Promise((resolve, reject) => (pendingRequest = { resolve, reject, method, params, sessionId }));
        this.#pendingRequests.set(id, pendingRequest);
        return promise;
    }
    close() {
        this.#webSocket.close();
    }
    #onMessage({ id, method, result, error, params, sessionId }) {
        if (id !== UNDEFINED_VALUE) {
            const { resolve, reject, method, params, sessionId } = this.#pendingRequests.get(id);
            if (error === UNDEFINED_VALUE) {
                resolve(result);
            } else {
                const message = error.message + " when calling " + `${method}(${JSON.stringify(params)})` + `
                    ${sessionId === UNDEFINED_VALUE ? "" : ` (sessionId ${JSON.stringify(sessionId)})`}`;
                const errorEvent = new Error(message);
                errorEvent.code = error.code;
                reject(errorEvent);
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
    return retryConnection(async () => {
        let response;
        try {
            response = await fetch(url, { method });
        } catch (error) {
            error.code = CONNECTION_REFUSED_ERROR_CODE;
            throw error;
        }
        if (response.status >= MIN_INVALID_HTTP_STATUS_CODE) {
            const error = new Error(response.statusText || `HTTP Error ${response.status}`);
            error.status = response.status;
            error.code = CONNECTION_ERROR_CODE;
            throw new Error(error);
        } else {
            return response.json();
        }
    }, options);
}

async function retryConnection(fn, options, retryCount = 0) {
    const { connectionMaxRetry, connectionRetryDelay } = options;
    try {
        return await fn();
    } catch (error) {
        if (error.code == CONNECTION_REFUSED_ERROR_CODE && retryCount < connectionMaxRetry) {
            await new Promise((resolve) => setTimeout(resolve, connectionRetryDelay));
            return retryConnection(fn, options, retryCount + 1);
        } else {
            throw error;
        }
    }
}