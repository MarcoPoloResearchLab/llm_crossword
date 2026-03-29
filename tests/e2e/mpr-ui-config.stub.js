// @ts-check

(function () {
  "use strict";

  function applyStyles(element, cssText) {
    element.style.cssText = cssText;
  }

  function readFooterLabel(host) {
    var linksCollection = host.getAttribute("links-collection");
    if (typeof linksCollection === "string" && linksCollection.trim().length > 0) {
      try {
        var parsed = JSON.parse(linksCollection);
        if (parsed && typeof parsed.text === "string" && parsed.text.trim().length > 0) {
          return parsed.text.trim();
        }
      } catch (error) {}
    }
    return "Built by Marco Polo Research Lab";
  }

  if (!customElements.get("mpr-header")) {
    customElements.define("mpr-header", class extends HTMLElement {
      connectedCallback() {
        this.style.display = "block";
        this.style.width = "100%";

        if (this.querySelector("header.mpr-header")) {
          return;
        }

        var preservedChildren = Array.from(this.children);
        var header = document.createElement("header");
        var brandLink = document.createElement("a");
        var actions = document.createElement("div");
        var signInArea = document.createElement("div");

        header.className = "mpr-header";
        applyStyles(
          header,
          "display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:56px;padding:0 16px;background:rgb(15,23,42);color:rgb(248,250,252);box-sizing:border-box;"
        );

        brandLink.href = this.getAttribute("brand-href") || "/";
        brandLink.textContent = this.getAttribute("brand-label") || "LLM Crossword";
        applyStyles(
          brandLink,
          "color:inherit;text-decoration:none;font-size:1rem;font-weight:700;line-height:1.2;"
        );

        actions.className = "mpr-header__actions";
        applyStyles(actions, "display:flex;align-items:center;gap:12px;position:relative;");

        signInArea.setAttribute("data-mpr-header", "google-signin");
        signInArea.setAttribute("aria-label", "Google sign in");
        signInArea.textContent = "Google sign in";
        applyStyles(
          signInArea,
          "display:flex;align-items:center;justify-content:center;min-width:120px;min-height:40px;padding:0 12px;border-radius:999px;background:rgb(255,255,255);color:rgb(15,23,42);font-size:0.875rem;font-weight:600;"
        );

        actions.appendChild(signInArea);
        preservedChildren.forEach(function appendPreservedChild(child) {
          actions.appendChild(child);
        });

        header.appendChild(brandLink);
        header.appendChild(actions);
        this.appendChild(header);
      }
    });
  }

  if (!customElements.get("mpr-footer")) {
    customElements.define("mpr-footer", class extends HTMLElement {
      connectedCallback() {
        this.style.display = "block";
        this.style.width = "100%";

        if (this.querySelector("footer.mpr-footer")) {
          return;
        }

        var footer = document.createElement("footer");
        var privacyLink = document.createElement("a");
        var themeToggle = document.createElement("button");
        var builtByButton = document.createElement("button");

        footer.className = "mpr-footer";
        applyStyles(
          footer,
          "display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;min-height:40px;padding:8px 16px;background:rgb(15,23,42);color:rgb(226,232,240);box-sizing:border-box;"
        );

        privacyLink.href = this.getAttribute("privacy-link-href") || "#privacy";
        privacyLink.textContent = this.getAttribute("privacy-link-label") || "Privacy";
        applyStyles(privacyLink, "color:inherit;text-decoration:none;");

        themeToggle.type = "button";
        themeToggle.setAttribute("data-mpr-footer", "theme-toggle");
        themeToggle.textContent = "Theme";
        applyStyles(
          themeToggle,
          "padding:6px 12px;border:1px solid rgba(255,255,255,0.35);border-radius:999px;background:transparent;color:inherit;"
        );

        builtByButton.type = "button";
        builtByButton.textContent = readFooterLabel(this);
        applyStyles(
          builtByButton,
          "padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;"
        );

        footer.appendChild(privacyLink);
        footer.appendChild(themeToggle);
        footer.appendChild(builtByButton);
        this.appendChild(footer);
      }
    });
  }

  if (!customElements.get("mpr-user")) {
    customElements.define("mpr-user", class extends HTMLElement {
      static get observedAttributes() {
        return ["menu-items", "logout-url", "logout-label"];
      }

      connectedCallback() {
        this._render();
      }

      attributeChangedCallback() {
        this._render();
      }

      _render() {
        var logoutLabel = this.getAttribute("logout-label") || "Log out";
        var logoutUrl = this.getAttribute("logout-url") || "/";
        var items = [];

        try {
          items = JSON.parse(this.getAttribute("menu-items") || "[]");
        } catch (error) {}

        this.innerHTML = '<div class="mpr-user__layout">' +
          '<button type="button" class="mpr-user__trigger" data-mpr-user="trigger" aria-haspopup="true" aria-expanded="false">U</button>' +
          '<div class="mpr-user__menu" data-mpr-user="menu" role="menu" style="display:none;position:absolute;right:0;top:100%;min-width:160px;padding:8px;background:#1e293b;border:1px solid rgba(148,163,184,0.25);border-radius:12px;z-index:999">' +
          items.map(function renderItem(item, index) {
            return '<button type="button" class="mpr-user__menu-item" role="menuitem" data-mpr-user="menu-item" data-mpr-user-action="' + (item.action || "") + '" data-mpr-user-index="' + index + '">' + (item.label || "") + "</button>";
          }).join("") +
          '<a class="mpr-user__menu-item" role="menuitem" href="' + logoutUrl + '" data-mpr-user="logout">' + logoutLabel + "</a>" +
          "</div></div>";

        var trigger = this.querySelector('[data-mpr-user="trigger"]');
        var menu = this.querySelector('[data-mpr-user="menu"]');

        if (trigger && menu) {
          trigger.addEventListener("click", function toggleMenu() {
            var isOpen = menu.style.display !== "none";
            menu.style.display = isOpen ? "none" : "block";
            trigger.setAttribute("aria-expanded", isOpen ? "false" : "true");
          });
        }

        var self = this;
        this.querySelectorAll('[data-mpr-user="menu-item"]').forEach(function bindMenuItem(button) {
          button.addEventListener("click", function handleMenuItemClick() {
            var action = button.getAttribute("data-mpr-user-action");
            var index = parseInt(button.getAttribute("data-mpr-user-index"), 10);

            self.dispatchEvent(new CustomEvent("mpr-user:menu-item", {
              bubbles: true,
              detail: { action: action, index: index, label: button.textContent },
            }));

            if (menu && trigger) {
              menu.style.display = "none";
              trigger.setAttribute("aria-expanded", "false");
            }
          });
        });
      }
    });
  }

  if (!customElements.get("mpr-detail-drawer")) {
    customElements.define("mpr-detail-drawer", class extends HTMLElement {
      static get observedAttributes() {
        return ["open", "heading", "subheading"];
      }

      connectedCallback() {
        this._init();
        this._sync();
      }

      attributeChangedCallback() {
        if (this._panel) {
          this._sync();
        }
      }

      _init() {
        if (this._panel) {
          return;
        }

        var heading = this.getAttribute("heading") || "Details";
        var slottedBody = this.querySelector('[slot="body"]');
        var backdrop = document.createElement("div");
        var panel = document.createElement("aside");
        var body;
        var self = this;

        backdrop.className = "mpr-detail-drawer__backdrop";
        panel.className = "mpr-detail-drawer__panel";
        panel.innerHTML = '<div class="mpr-detail-drawer__header" style="display:flex;justify-content:space-between;align-items:center">' +
          '<h2 class="mpr-detail-drawer__heading">' + heading + "</h2>" +
          '<button class="mpr-detail-drawer__close" data-mpr-detail-drawer="close">Close</button></div>' +
          '<div class="mpr-detail-drawer__body"></div>';

        body = panel.querySelector(".mpr-detail-drawer__body");

        if (slottedBody) {
          while (slottedBody.firstChild) {
            body.appendChild(slottedBody.firstChild);
          }
          slottedBody.remove();
        }

        this.appendChild(backdrop);
        this.appendChild(panel);
        this._backdrop = backdrop;
        this._panel = panel;

        panel.querySelector('[data-mpr-detail-drawer="close"]').addEventListener("click", function handleCloseClick() {
          self.removeAttribute("open");
          self.dispatchEvent(new CustomEvent("mpr-ui:detail-drawer:close", { bubbles: true }));
        });

        backdrop.addEventListener("click", function handleBackdropClick() {
          self.removeAttribute("open");
          self.dispatchEvent(new CustomEvent("mpr-ui:detail-drawer:close", { bubbles: true }));
        });
      }

      _sync() {
        var isOpen = this.hasAttribute("open");

        applyStyles(
          this,
          "position:fixed;inset:0;z-index:80;display:block;" + (isOpen ? "" : "pointer-events:none;")
        );
        applyStyles(
          this._backdrop,
          "position:absolute;inset:0;background:rgba(15,23,42,0.65);opacity:" + (isOpen ? "1" : "0") + ";pointer-events:" + (isOpen ? "auto" : "none") + ";"
        );
        applyStyles(
          this._panel,
          "position:absolute;top:0;bottom:0;right:0;width:min(38rem,100vw);padding:1.25rem;background:rgba(15,23,42,0.98);border-left:1px solid rgba(148,163,184,0.25);display:flex;flex-direction:column;gap:1rem;overflow:auto;pointer-events:auto;transform:translateX(" + (isOpen ? "0" : "100%") + ");"
        );
      }
    });
  }
})();
