// Runs in the e-GP page itself ("world": "MAIN"), so it can see the responses
// the page's own code receives. It is a listener, nothing more:
//
//   - it never sends a request of its own, and never repeats one;
//   - it never reads or forwards the X-Announcement-Token, the Turnstile pass
//     a person earned by opening the page;
//   - it only looks at e-GP's announcement search (and its CSV export), the
//     results the person asked for, and hands their text to panel.js.
//
// Getting past Cloudflare is the person's doing, in their own browser; this
// file only saves them retyping what they can already see.

(function () {
  const SEARCH = /\/pb\/a-egp-allt-project\/announcement(\/csv)?(\?|$)/;

  function forward(url, text) {
    if (!SEARCH.test(String(url)) || typeof text !== "string" || !text) return;
    window.postMessage({ source: "bkt-capture", url: String(url), text }, window.location.origin);
  }

  // XMLHttpRequest — what Angular's HttpClient uses.
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__bktUrl = url;
    return open.call(this, method, url, ...rest);
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      const url = this.responseURL || this.__bktUrl;
      if (!SEARCH.test(String(url))) return;
      try {
        if (this.responseType === "" || this.responseType === "text") forward(url, this.responseText);
        else if (this.responseType === "json") forward(url, JSON.stringify(this.response));
        else if (this.response instanceof Blob) this.response.text().then((t) => forward(url, t));
      } catch {
        // A response we cannot read is simply not captured.
      }
    });
    return send.apply(this, args);
  };

  // fetch — in case a later e-GP build switches.
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = response.url || String(args[0]?.url ?? args[0]);
      if (SEARCH.test(url)) response.clone().text().then((t) => forward(url, t), () => {});
    } catch {
      // Never let capture break the page.
    }
    return response;
  };
})();
