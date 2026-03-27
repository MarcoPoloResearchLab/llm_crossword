/* config.js — set tauth-url on mpr-header based on environment config */
(function () {
  "use strict";

  var _fetch = window.fetch.bind(window);

  var header = document.getElementById("app-header");
  if (!header) return;

  // Default: tauth is proxied through the same origin via ghttp.
  var tauthUrl = window.location.origin;

  // Fetch config.yaml to check for environment-specific overrides.
  _fetch(window.location.origin + "/config.yaml")
    .then(function (resp) { return resp.text(); })
    .then(function (text) {
      var match = matchEnvironment(text, window.location.origin);
      if (match) {
        tauthUrl = match;
      }
      header.setAttribute("tauth-url", tauthUrl);
    })
    .catch(function () {
      // Fallback: use same origin (ghttp proxies /auth/* to tauth).
      header.setAttribute("tauth-url", tauthUrl);
    });

  // Set immediately so mpr-ui has a value even before fetch completes.
  header.setAttribute("tauth-url", tauthUrl);

  function matchEnvironment(yamlText, origin) {
    // Minimal parser: find the environment block matching the current origin
    // and extract the tauthUrl value.
    var environments = [];
    var current = null;
    var lines = yamlText.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s+-\s+description:/.test(line)) {
        if (current) environments.push(current);
        current = { origins: [], tauthUrl: "" };
      }
      if (!current) continue;
      var originMatch = line.match(/^\s+-\s+"([^"]+)"/);
      if (originMatch && line.indexOf("description") < 0) {
        current.origins.push(originMatch[1]);
      }
      var tauthMatch = line.match(/^\s+tauthUrl:\s+"([^"]*)"/);
      if (tauthMatch) {
        current.tauthUrl = tauthMatch[1];
      }
    }
    if (current) environments.push(current);

    for (var j = 0; j < environments.length; j++) {
      if (environments[j].origins.indexOf(origin) >= 0 && environments[j].tauthUrl) {
        return environments[j].tauthUrl;
      }
    }
    return null;
  }
})();
