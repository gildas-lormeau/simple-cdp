/// <reference types="./mod.d.ts" />

const UNDEFINED_VALUE = undefined;
const MESSAGE_EVENT = "message";
const OPEN_EVENT = "open";
const CLOSE_EVENT = "close";
const ERROR_EVENT = "error";
const CONNECTION_REFUSED_ERROR_CODE = "ConnectionRefused";
const CONNECTION_ERROR_CODE = "ConnectionError";
const CONNECTION_CLOSED_ERROR_CODE = "ConnectionClosed";
const CONNECTION_TIMEOUT_ERROR_CODE = "ConnectionTimeout";
const COMMAND_TIMEOUT_ERROR_CODE = "CommandTimeout";
const ADD_EVENT_LISTENER_METHOD = "addEventListener";
const REMOVE_EVENT_LISTENER_METHOD = "removeEventListener";
const THEN_PROPERTY = "then";
const TO_STRING_METHOD = "toString";
const VALUE_OF_METHOD = "valueOf";
const TO_JSON_METHOD = "toJSON";
const DOMAIN_TAG = "CDPDomain";
const ABORT_EVENT = "abort";
const ONCE_OPTION = { once: true };
const MIN_INVALID_HTTP_STATUS_CODE = 400;
const GET_METHOD = "GET";
const PUT_METHOD = "PUT";
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

class CDP extends EventTarget {
    #connection;
    #connectionPromise;
    #options;
    #eventListeners = [];

    constructor(instanceOptions) {
        super();
        // deno-lint-ignore no-this-alias
        const cdp = this;
        cdp.#options = instanceOptions === UNDEFINED_VALUE ? options : Object.assign({}, options, instanceOptions);
        const proxy = new Proxy(Object.create(null), {
            get(target, propertyName) {
                if (propertyName in cdp) {
                    const member = cdp[propertyName];
                    return typeof member === "function" ? member.bind(cdp) : member;
                } else if (propertyName in target) {
                    return target[propertyName];
                } else {
                    return getDomain(target, propertyName);
                }
            },
            set(target, propertyName, value) {
                if (propertyName in cdp) {
                    cdp[propertyName] = value;
                } else {
                    target[propertyName] = value;
                }
                return true;
            }
        });
        return proxy;

        function getDomain(target, domainName) {
            // a domain resolves any name to a method, so the members kept out of
            // the proxy handler are the ones that must never become a command:
            // the listener methods, and the names JavaScript looks up implicitly
            // when a value is awaited, stringified or serialized
            const members = Object.assign(Object.create(null), {
                [ADD_EVENT_LISTENER_METHOD]: getDomainListenerFunction(ADD_EVENT_LISTENER_METHOD, domainName),
                [REMOVE_EVENT_LISTENER_METHOD]: getDomainListenerFunction(REMOVE_EVENT_LISTENER_METHOD, domainName),
                [TO_STRING_METHOD]: () => `[${DOMAIN_TAG} ${domainName}]`,
                [THEN_PROPERTY]: UNDEFINED_VALUE,
                [VALUE_OF_METHOD]: UNDEFINED_VALUE,
                [TO_JSON_METHOD]: UNDEFINED_VALUE
            });
            target[domainName] = new Proxy(Object.create(null), {
                get(target, methodName) {
                    if (typeof methodName !== "string" || methodName in members) {
                        return members[methodName];
                    } else if (methodName in target) {
                        return target[methodName];
                    } else {
                        return getDomainMethodFunction(target, methodName, domainName);
                    }
                }
            });
            return target[domainName];
        }

        function getDomainMethodFunction(target, methodName, domainName) {
            target[methodName] = async (params = {}, sessionId) => {
                await ready();
                return cdp.#connection.sendMessage(`${domainName}.${methodName}`, params, sessionId);
            };
            return target[methodName];
        }

        function getDomainListenerFunction(methodName, domainName) {
            return (type, listener, options) => {
                const eventType = `${domainName}.${type}`;
                if (methodName === ADD_EVENT_LISTENER_METHOD) {
                    const eventListener = { eventType, listener, options };
                    cdp.#eventListeners.push(eventListener);
                    const signal = getListenerSignal(options);
                    if (signal !== UNDEFINED_VALUE) {
                        signal.addEventListener(ABORT_EVENT, () => forgetEventListener(eventListener), ONCE_OPTION);
                    }
                    if (cdp.#connection !== UNDEFINED_VALUE) {
                        addEventListener(cdp.#connection, eventListener);
                    }
                } else {
                    // a listener is identified by its type, its callback and the
                    // capture flag, as in the DOM
                    const capture = getListenerCapture(options);
                    const index = cdp.#eventListeners.findIndex((eventListener) =>
                        eventListener.eventType === eventType &&
                        eventListener.listener === listener &&
                        getListenerCapture(eventListener.options) === capture);
                    if (index !== -1) {
                        cdp.#eventListeners.splice(index, 1);
                    }
                    if (cdp.#connection !== UNDEFINED_VALUE) {
                        cdp.#connection.removeEventListener(eventType, listener, options);
                    }
                }
            };
        }

        function addEventListener(connection, eventListener) {
            const { eventType, listener, options } = eventListener;
            connection.addEventListener(eventType, listener, options);
            if (getListenerOnce(options)) {
                // the connection drops the listener once it has run, so it must
                // not be registered again on the connection replacing it
                connection.addEventListener(eventType, () => forgetEventListener(eventListener), {
                    once: true,
                    capture: getListenerCapture(options)
                });
            }
        }

        function forgetEventListener(eventListener) {
            const index = cdp.#eventListeners.indexOf(eventListener);
            if (index !== -1) {
                cdp.#eventListeners.splice(index, 1);
            }
        }

        function ready() {
            if (cdp.#connection !== UNDEFINED_VALUE && !cdp.#connection.closed) {
                return Promise.resolve();
            }
            // a single connection is shared by the calls awaiting it, so that a
            // burst of concurrent calls does not open one socket each
            if (cdp.#connectionPromise === UNDEFINED_VALUE) {
                cdp.#connectionPromise = connect().finally(() => (cdp.#connectionPromise = UNDEFINED_VALUE));
            }
            return cdp.#connectionPromise;
        }

        async function connect() {
            let webSocketDebuggerUrl = cdp.#options.webSocketDebuggerUrl;
            if (webSocketDebuggerUrl === UNDEFINED_VALUE) {
                const url = new URL(cdp.#options.apiPath, cdp.#options.apiUrl);
                ({ webSocketDebuggerUrl } = await fetchData(url, cdp.#options));
            }
            const connection = new Connection(webSocketDebuggerUrl, cdp.#options);
            await connection.open();
            // the connection is replaced when it closes, so the events are
            // relayed by the instance, which outlives it
            connection.addEventListener(
                CLOSE_EVENT,
                ({ reason }) => cdp.dispatchEvent(new CloseEvent(CLOSE_EVENT, { reason })),
                ONCE_OPTION
            );
            // the listeners are registered against the connection, so they are
            // reapplied whenever a new one replaces a closed one
            for (const eventListener of [...cdp.#eventListeners]) {
                addEventListener(connection, eventListener);
            }
            cdp.#connection = connection;
            cdp.dispatchEvent(new Event(OPEN_EVENT));
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
        }
        // an explicit reset starts from a clean state, unlike the reconnection
        // following a connection lost on its own
        this.#eventListeners.length = 0;
    }
    [Symbol.dispose]() {
        // the reset is synchronous, so the instance is disposable with `using`
        this.reset();
    }
    static getTargets(requestOptions) {
        const { apiPathTargets, apiUrl } = options;
        return fetchData(new URL(apiPathTargets, apiUrl), getRequestOptions(requestOptions));
    }
    static createTarget(url, requestOptions) {
        const { apiPathNewTarget, apiUrl } = options;
        const path = url ? `${apiPathNewTarget}?${encodeURIComponent(url)}` : apiPathNewTarget;
        return fetchData(new URL(path, apiUrl), getRequestOptions(requestOptions), PUT_METHOD);
    }
    static async activateTarget(targetId, requestOptions) {
        const { apiPathActivateTarget, apiUrl } = options;
        const url = new URL(`${apiPathActivateTarget}/${targetId}`, apiUrl);
        await fetchData(url, getRequestOptions(requestOptions), GET_METHOD, false);
    }
    static async closeTarget(targetId, requestOptions) {
        const { apiPathCloseTarget, apiUrl } = options;
        const url = new URL(`${apiPathCloseTarget}/${targetId}`, apiUrl);
        await fetchData(url, getRequestOptions(requestOptions), GET_METHOD, false);
    }
}

const options = Object.assign({}, DEFAULT_OPTIONS);
const cdp = new CDP();
const getTargets = CDP.getTargets;
const createTarget = CDP.createTarget;
const activateTarget = CDP.activateTarget;
const closeTarget = CDP.closeTarget;
export { cdp, CDP, options, getTargets, createTarget, activateTarget, closeTarget, CONNECTION_REFUSED_ERROR_CODE, CONNECTION_ERROR_CODE, CONNECTION_CLOSED_ERROR_CODE, CONNECTION_TIMEOUT_ERROR_CODE, COMMAND_TIMEOUT_ERROR_CODE };

class Connection extends EventTarget {
    #webSocketDebuggerUrl;
    #webSocket;
    #options;
    #pendingRequests = new Map();
    #nextRequestId = 0;
    #closed = false;

    constructor(webSocketDebuggerUrl, options = DEFAULT_OPTIONS) {
        super();
        this.#webSocketDebuggerUrl = webSocketDebuggerUrl;
        this.#options = options;
    }
    get closed() {
        return this.#closed;
    }
    open() {
        this.#webSocket = new WebSocket(this.#webSocketDebuggerUrl);
        this.#webSocket.addEventListener(MESSAGE_EVENT, (event) => this.#onMessage(JSON.parse(event.data)));
        this.#webSocket.addEventListener(CLOSE_EVENT, (event) => this.#onClose(event.reason));
        this.#webSocket.addEventListener(ERROR_EVENT, () => this.#onClose());
        return new Promise((resolve, reject) => {
            const { connectionMaxTime } = this.#options;
            let timeoutId;
            if (connectionMaxTime !== UNDEFINED_VALUE) {
                // a handshake left hanging by an unresponsive browser would
                // otherwise keep the caller waiting forever
                timeoutId = setTimeout(() => {
                    reject(getConnectionTimeoutError(connectionMaxTime));
                    this.close();
                }, connectionMaxTime);
            }
            this.#webSocket.addEventListener(OPEN_EVENT, () => {
                clearTimeout(timeoutId);
                resolve();
            });
            this.#webSocket.addEventListener(CLOSE_EVENT, (event) => {
                clearTimeout(timeoutId);
                reject(new Error(event.reason));
            });
            this.#webSocket.addEventListener(ERROR_EVENT, () => {
                clearTimeout(timeoutId);
                reject(new Error());
            });
        });
    }
    sendMessage(method, params = {}, sessionId) {
        if (this.#closed) {
            return Promise.reject(getConnectionClosedError(method, params, sessionId));
        }
        const id = this.#nextRequestId;
        const message = JSON.stringify({ id, method, params, sessionId });
        this.#nextRequestId = (this.#nextRequestId + 1) % Number.MAX_SAFE_INTEGER;
        this.#webSocket.send(message);
        let pendingRequest;
        const promise = new Promise((resolve, reject) => (pendingRequest = { resolve, reject, method, params, sessionId }));
        this.#pendingRequests.set(id, pendingRequest);
        const { commandMaxTime } = this.#options;
        if (commandMaxTime !== UNDEFINED_VALUE) {
            // a command whose response never arrives would otherwise be left
            // pending forever, the connection itself stays usable
            pendingRequest.timeoutId = setTimeout(() => {
                this.#pendingRequests.delete(id);
                pendingRequest.reject(getCommandTimeoutError(method, params, sessionId, commandMaxTime));
            }, commandMaxTime);
        }
        return promise;
    }
    close() {
        this.#onClose();
        this.#webSocket.close();
    }
    #onClose(reason) {
        if (!this.#closed) {
            this.#closed = true;
            // the responses will never arrive, so the calls awaiting them are
            // rejected instead of being left pending forever
            for (const [id, { reject, method, params, sessionId, timeoutId }] of this.#pendingRequests) {
                clearTimeout(timeoutId);
                this.#pendingRequests.delete(id);
                reject(getConnectionClosedError(method, params, sessionId, reason));
            }
            // the pending calls are settled first, so that the listeners observe
            // a connection that is done rather than one still draining
            this.dispatchEvent(new CloseEvent(CLOSE_EVENT, { reason }));
        }
    }
    #onMessage({ id, method, result, error, params, sessionId }) {
        if (id !== UNDEFINED_VALUE) {
            const pendingRequest = this.#pendingRequests.get(id);
            // a response can arrive for a request that is no longer pending
            if (pendingRequest !== UNDEFINED_VALUE) {
                const { resolve, reject, method, params, sessionId, timeoutId } = pendingRequest;
                clearTimeout(timeoutId);
                this.#pendingRequests.delete(id);
                if (error === UNDEFINED_VALUE) {
                    resolve(result);
                } else {
                    const errorEvent = new Error(
                        `${error.message} when calling ${getCallDescription(method, params, sessionId)}`
                    );
                    errorEvent.code = error.code;
                    reject(errorEvent);
                }
            }
        }
        if (method !== UNDEFINED_VALUE) {
            this.dispatchEvent(new CDPEvent(method, { params, sessionId }));
        }
    }
}

/**
 * The event dispatched to the domain event listeners
 *
 * The data is exposed through getters, as in the events of the platform, so
 * that a listener cannot alter what the next ones receive.
 */
class CDPEvent extends Event {
    #params;
    #sessionId;

    constructor(type, eventInit = {}) {
        super(type, eventInit);
        this.#params = eventInit.params;
        this.#sessionId = eventInit.sessionId;
    }
    get params() {
        return this.#params;
    }
    get sessionId() {
        return this.#sessionId;
    }
}

function getListenerCapture(options) {
    return typeof options === "boolean" ? options : Boolean(options && options.capture);
}

function getListenerOnce(options) {
    return Boolean(options && typeof options === "object" && options.once);
}

function getListenerSignal(options) {
    return options && typeof options === "object" ? options.signal : UNDEFINED_VALUE;
}

function getCallDescription(method, params, sessionId) {
    const call = `${method}(${JSON.stringify(params)})`;
    return sessionId === UNDEFINED_VALUE ? call : `${call} (sessionId ${JSON.stringify(sessionId)})`;
}

function getConnectionTimeoutError(connectionMaxTime) {
    const error = new Error(`connection not opened after ${connectionMaxTime} ms`);
    error.code = CONNECTION_TIMEOUT_ERROR_CODE;
    return error;
}

function getCommandTimeoutError(method, params, sessionId, commandMaxTime) {
    const description = getCallDescription(method, params, sessionId);
    const error = new Error(`response not received after ${commandMaxTime} ms when calling ${description}`);
    error.code = COMMAND_TIMEOUT_ERROR_CODE;
    return error;
}

function getConnectionClosedError(method, params, sessionId, reason) {
    const description = getCallDescription(method, params, sessionId);
    const error = new Error(
        `connection closed${reason ? ` (${reason})` : ""} when calling ${description}`
    );
    error.code = CONNECTION_CLOSED_ERROR_CODE;
    return error;
}

function getRequestOptions(requestOptions) {
    return requestOptions === UNDEFINED_VALUE ? options : Object.assign({}, options, requestOptions);
}

function fetchData(url, options, method = GET_METHOD, parseJSON = true) {
    const { signal } = options;
    return retryConnection(async () => {
        let response;
        try {
            response = await fetch(url, { method, signal });
        } catch (error) {
            // an aborted request is not a browser that cannot be reached, so it
            // must not be retried
            if (signal !== UNDEFINED_VALUE && signal.aborted) {
                throw signal.reason;
            }
            error.code = CONNECTION_REFUSED_ERROR_CODE;
            throw error;
        }
        if (response.status >= MIN_INVALID_HTTP_STATUS_CODE) {
            const error = new Error(response.statusText || `HTTP Error ${response.status}`);
            error.status = response.status;
            error.code = CONNECTION_ERROR_CODE;
            throw error;
        } else {
            if (parseJSON) {
                return response.json();
            } else {
                return response.text();
            }
        }
    }, options);
}

async function retryConnection(fn, options, retryCount = 0) {
    const { connectionMaxRetry, connectionRetryDelay, signal } = options;
    try {
        return await fn();
    } catch (error) {
        if (error.code == CONNECTION_REFUSED_ERROR_CODE && retryCount < connectionMaxRetry) {
            // waiting is what the signal cancels, so the delay is interrupted
            // rather than run to completion before giving up
            await delay(connectionRetryDelay, signal);
            return retryConnection(fn, options, retryCount + 1);
        } else {
            throw error;
        }
    }
}

function delay(timeout, signal) {
    return new Promise((resolve, reject) => {
        if (signal !== UNDEFINED_VALUE) {
            if (signal.aborted) {
                reject(signal.reason);
                return;
            }
            const onAbort = () => {
                clearTimeout(timeoutId);
                reject(signal.reason);
            };
            const timeoutId = setTimeout(() => {
                signal.removeEventListener(ABORT_EVENT, onAbort);
                resolve();
            }, timeout);
            signal.addEventListener(ABORT_EVENT, onAbort, ONCE_OPTION);
        } else {
            setTimeout(resolve, timeout);
        }
    });
}