/* config.js — resolve mpr-ui configuration URL based on current origin */
(function () {
  "use strict";
  const configPath = "/config.yaml";
  const el = document.createElement("link");
  el.rel = "mpr-ui-config";
  el.href = window.location.origin + configPath;
  document.head.appendChild(el);
})();
