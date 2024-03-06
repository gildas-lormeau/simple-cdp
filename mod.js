/// <reference types="./mod.d.ts" />

const UNDEFINED_VALUE = undefined;
const MESSAGE_EVENT = "message";
const OPEN_EVENT = "open";
const CLOSE_EVENT = "close";
const ERROR_EVENT = "error";
const CONNECTION_REFUSED_ERROR_CODE = "ConnectionRefused";
const EVENT_LISTENERS = ["addEventListener", "removeEventListener"];
const DEFAULT_URL = "http://localhost:9222";
const DEFAULT_PATH = "json/version";
const DEFAULT_PATH_TARGETS = "json";
const PATH_NEW_TARGET = "json/new";
const PATH_ACTIVATE_TARGET = "json/activate";
const PATH_CLOSE_TARGET = "json/close";
const DEFAULT_CONNECTION_MAX_RETRY = 20;
const DEFAULT_CONNECTION_RETRY_DELAY = 500;
const DEFAULT_OPTIONS = {
    url: DEFAULT_URL,
    path: DEFAULT_PATH,
    pathTargets: DEFAULT_PATH_TARGETS,
    pathNewTarget: PATH_NEW_TARGET,
    pathActivateTarget: PATH_ACTIVATE_TARGET,
    pathCloseTarget: PATH_CLOSE_TARGET,
    connectionMaxRetry: DEFAULT_CONNECTION_MAX_RETRY,
    connectionRetryDelay: DEFAULT_CONNECTION_RETRY_DELAY
};

function getTargets() {
    return CDP.getTargets();
}

function createTarget(url) {
    return CDP.createTarget(url);
}

function activateTarget(targetId) {
    return CDP.activateTarget(targetId);
}

function closeTarget(targetId) {
    return CDP.closeTarget(targetId);
}

class CDP {
    connection;
    options = Object.assign({}, DEFAULT_OPTIONS);
    #pendingEventListenerCalls = [];

    constructor(options) {
        // deno-lint-ignore no-this-alias
        const cdp = this;
        const proxy = new Proxy(Object.create(null), {
            get(target, propertyName) {
                if (propertyName in cdp) {
                    return cdp[propertyName];
                } else {
                    if (propertyName in target) {
                        return target[propertyName];
                    } else {
                        return getDomain(target, propertyName);
                    }
                }
            }
        });
        cdp.options = Object.assign(cdp.options, options);
        return proxy;

        function getDomain(target, domainName) {
            target[domainName] = new Proxy(Object.create(null), {
                get(target, methodName) {
                    return getDomainMethod(target, methodName, domainName);
                }
            });
            return target[domainName];
        }

        function getDomainMethod(target, methodName, domainName) {
            if (EVENT_LISTENERS.includes(methodName)) {
                return (type, listener) => {
                    if (cdp.connection === UNDEFINED_VALUE) {
                        cdp.#pendingEventListenerCalls.push({ methodName, domainName, type, listener });
                    } else {
                        cdp.connection[methodName](`${domainName}.${type}`, listener);
                    }
                };
            } else {
                if (!(methodName in target)) {
                    target[methodName] = getDomainMethodFunction(methodName, domainName);
                }
                return target[methodName];
            }
        }

        function getDomainMethodFunction(methodName, domainName) {
            return async (params = {}, sessionId) => {
                await ready(cdp);
                if (cdp.#pendingEventListenerCalls.length > 0) {
                    for (const { methodName, domainName, type, listener } of cdp.#pendingEventListenerCalls) {
                        cdp.connection[methodName](`${domainName}.${type}`, listener);
                    }
                    cdp.#pendingEventListenerCalls.length = 0;
                }
                return cdp.connection.sendMessage(`${domainName}.${methodName}`, params, sessionId);
            };
        }

        async function ready(cdp) {
            if (cdp.connection === UNDEFINED_VALUE) {
                const connection = new Connection(cdp.options);
                await retry(() => connection.open(), cdp.options);
                cdp.connection = connection;
            }
        }
    }
    get options() {
        return cdp.options;
    }
    set options(value) {
        Object.assign(cdp.options, value);
    }
    reset() {
        if (cdp.connection !== UNDEFINED_VALUE) {
            cdp.connection.close();
            cdp.connection = UNDEFINED_VALUE;
            cdp.#pendingEventListenerCalls.length = 0;
        }
    }
    static getTargets() {
        const { pathTargets, url: baseUrl } = cdp.options;
        return fetchDataWithRetry(new URL(pathTargets, baseUrl), cdp.options);
    }
    static createTarget(url) {
        const { pathNewTarget, url: baseUrl } = cdp.options;
        const path = url ? `${pathNewTarget}?url=${url}` : pathNewTarget;
        return fetchDataWithRetry(new URL(path, baseUrl), cdp.options, "PUT");
    }
    static async activateTarget(targetId) {
        const { pathActivateTarget, url: baseUrl } = cdp.options;
        await fetchDataWithRetry(new URL(`${pathActivateTarget}/${targetId}`, baseUrl), cdp.options);
    }
    static async closeTarget(targetId) {
        const { pathCloseTarget, url: baseUrl } = cdp.options;
        await fetchDataWithRetry(new URL(`${pathCloseTarget}/${targetId}`, baseUrl)), cdp.options;
    }
}

const cdp = new CDP();
export { cdp, CDP, getTargets, createTarget, activateTarget, closeTarget };

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
            const response = await fetchData(new URL(this.#path, this.#url));
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

function fetchDataWithRetry(url, options, method) {
    return retry(async () => {
        const response = await fetchData(url, { method });
        if (response.status >= 400) {
            throw new Error(await response.text());
        } else {
            return response.json();
        }
    }, options);
}

async function fetchData(...args) {
    try {
        return await fetch(...args);
    } catch (error) {
        error.code = CONNECTION_REFUSED_ERROR_CODE;
        throw error;
    }
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