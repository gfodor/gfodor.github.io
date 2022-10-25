// Manages the display for the initial loader, which shows up while react
// is downloading, etc.
const waitForEvent = function (eventName, eventObj) {
    return new Promise(resolve => {
        eventObj.addEventListener(eventName, resolve, { once: true });
    });
};

const waitForDOMContentLoaded = function () {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        return Promise.resolve(null);
    } else {
        return waitForEvent('DOMContentLoaded', window);
    }
};

waitForDOMContentLoaded().then(() => { 
    // Show loader after slight delay to avoid flicker on hot cache
    window._initialLoaderTimeout = setTimeout(() => {
        document.querySelector("#initial-loader")?.setAttribute("style", "visibility: visible");
        window._initialLoaderTimeout = null;
    }, 500);
})
