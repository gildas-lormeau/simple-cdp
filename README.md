# Introduction

simple-cdp is a JavaScript library to interact with the [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/).

The implementation uses [Proxy](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Proxy) objects to expose APIs. This makes it very light (around [400 lines of code](https://github.com/gildas-lormeau/simple-cdp/blob/main/mod.js)) and independent of protocol evolutions.

# Install

You can install the library:

- from JSR:

```sh
deno add @simple-cdp/simple-cdp
```

- from NPM:

```sh
npm install simple-cdp
```

# Start the browser

Start a Chromium-based browser with the switches `--remote-debugging-port` and `--user-data-dir`.

```sh
chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-cdp
```

Since Chrome 136, `--remote-debugging-port` is ignored when the browser runs on the default profile, so `--user-data-dir` must point to another directory. Without it, the browser starts but nothing listens on the port.

# Usage example

Run the script below.
```js
// import the module (replace with "simple-cdp" if using NPM)
import { createTarget, CDP } from "@simple-cdp/simple-cdp";

// navigate to https://example.com
const url = "https://example.com";
const targetInfo = await createTarget(url);

// create a CDP instance for the target
const cdp = new CDP(targetInfo);

// enable "Runtime" domain
await cdp.Runtime.enable();

// evaluate JavaScript expression
const expression = "41 + 1";
const { result } = await cdp.Runtime.evaluate({ expression });

// display result in the console (i.e. 42)
console.log(result.value);
```

# Driving several targets

The `cdp` instance is connected to the browser itself. Attach to a target to get
a session ID, and pass it as the last argument of the methods to address that
target. One connection then drives as many targets as needed.

```js
// import the module (replace with "simple-cdp" if using NPM)
import { cdp } from "@simple-cdp/simple-cdp";

// create a target and attach to it
const url = "https://example.com";
const { targetId } = await cdp.Target.createTarget({ url });
const { sessionId } = await cdp.Target.attachToTarget({
  targetId,
  flatten: true
});

// enable "Runtime" domain for that target
await cdp.Runtime.enable(null, sessionId);

// evaluate JavaScript expression in that target
const expression = "41 + 1";
const { result } = await cdp.Runtime.evaluate({ expression }, sessionId);

// display result in the console (i.e. 42)
console.log(result.value);

// close the target
await cdp.Target.closeTarget({ targetId });
```

# Waiting for an event

The methods resolve when the browser answers the command, which is not the same
as the browser finishing the work. Wait for the matching event instead, with the
`once` option of the listener.

```js
// register the listener before triggering the navigation
const loaded = new Promise((resolve) =>
  cdp.Page.addEventListener("loadEventFired", resolve, { once: true }));

await cdp.Page.enable(null, sessionId);
await cdp.Page.navigate({ url }, sessionId);

// wait for the page to be loaded
await loaded;
```

The listeners accept the options of
[EventTarget](https://developer.mozilla.org/docs/Web/API/EventTarget/addEventListener),
so `signal` can be used to remove them.

# Attaching to targets automatically

When targets are created by the page rather than by the script, for example when
it opens a window, their IDs are unknown. Auto-attach reports a session for each
target as it appears.

```js
// import the module (replace with "simple-cdp" if using NPM)
import { cdp } from "@simple-cdp/simple-cdp";

// add event listener triggered when a session is attached to a target
cdp.Target.addEventListener("attachedToTarget", onAttachedToTarget);

// attach to the targets as they are created
await cdp.Target.setAutoAttach({
  autoAttach: true,
  flatten: true,
  waitForDebuggerOnStart: false
});

async function onAttachedToTarget({ params }) {
  // get session ID
  const { sessionId, targetInfo } = params;

  // check if the target is a page
  if (targetInfo.type === "page") {
    // enable "Runtime" domain
    await cdp.Runtime.enable(null, sessionId);

    // evaluate JavaScript expression
    const expression = "41 + 1";
    const { result } = await cdp.Runtime.evaluate(
      { expression }, sessionId);

    // display result in the console (i.e. 42)
    console.log(result.value);
  }
}
```

Set `waitForDebuggerOnStart` to `true` to pause each target until
`Runtime.runIfWaitingForDebugger` is called, in order to set it up before it
runs any script.

# Options

The `options` object holds the settings shared by the `cdp` instance and by the target functions. Set them before the first call.

```js
// import the module (replace with "simple-cdp" if using NPM)
import { options } from "@simple-cdp/simple-cdp";

// connect to a browser listening on another port
options.apiUrl = "http://localhost:9223";
```

| Option | Default | Description |
| - | - | - |
| `apiUrl` | `"http://localhost:9222"` | Base URL of the browser |
| `webSocketDebuggerUrl` | | WebSocket URL, set it to skip the discovery request |
| `apiPath` | `"json/version"` | Path used to discover the WebSocket URL |
| `apiPathTargets` | `"json"` | Path used by `getTargets()` |
| `apiPathNewTarget` | `"json/new"` | Path used by `createTarget()` |
| `apiPathActivateTarget` | `"json/activate"` | Path used by `activateTarget()` |
| `apiPathCloseTarget` | `"json/close"` | Path used by `closeTarget()` |
| `connectionMaxRetry` | `20` | Number of attempts when the browser cannot be reached |
| `connectionRetryDelay` | `500` | Delay between attempts, in milliseconds |

A `CDP` instance created with an argument gets its own options, merging the shared ones with those passed to the constructor. Changing them does not affect the `cdp` instance.

```js
const cdp = new CDP({ apiUrl: "http://localhost:9223" });
```

# Connection and errors

The connection opens on the first call and stays open. If it is lost, the next call opens a new one and the event listeners are registered again. Calling `reset()` closes the connection and removes the event listeners.

Rejected calls carry a `code` property. Protocol errors use the code returned by the browser (e.g. `-32601` when the method does not exist), and connection errors use one of the exported codes.

| Code | Description |
| - | - |
| `CONNECTION_REFUSED_ERROR_CODE` | The browser could not be reached after `connectionMaxRetry` attempts |
| `CONNECTION_ERROR_CODE` | The browser returned an HTTP error, whose status is set on `status` |
| `CONNECTION_CLOSED_ERROR_CODE` | The connection closed before the response was received |
