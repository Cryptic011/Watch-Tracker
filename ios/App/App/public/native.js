(() => {
  // node_modules/@capacitor/core/dist/index.js
  var ExceptionCode;
  (function(ExceptionCode2) {
    ExceptionCode2["Unimplemented"] = "UNIMPLEMENTED";
    ExceptionCode2["Unavailable"] = "UNAVAILABLE";
  })(ExceptionCode || (ExceptionCode = {}));
  var CapacitorException = class extends Error {
    constructor(message, code, data) {
      super(message);
      this.message = message;
      this.code = code;
      this.data = data;
    }
  };
  var getPlatformId = (win) => {
    var _a, _b;
    if (win === null || win === void 0 ? void 0 : win.androidBridge) {
      return "android";
    } else if ((_b = (_a = win === null || win === void 0 ? void 0 : win.webkit) === null || _a === void 0 ? void 0 : _a.messageHandlers) === null || _b === void 0 ? void 0 : _b.bridge) {
      return "ios";
    } else {
      return "web";
    }
  };
  var createCapacitor = (win) => {
    const capCustomPlatform = win.CapacitorCustomPlatform || null;
    const cap = win.Capacitor || {};
    const Plugins = cap.Plugins = cap.Plugins || {};
    const getPlatform = () => {
      return capCustomPlatform !== null ? capCustomPlatform.name : getPlatformId(win);
    };
    const isNativePlatform = () => getPlatform() !== "web";
    const isPluginAvailable = (pluginName) => {
      const plugin = registeredPlugins.get(pluginName);
      if (plugin === null || plugin === void 0 ? void 0 : plugin.platforms.has(getPlatform())) {
        return true;
      }
      if (getPluginHeader(pluginName)) {
        return true;
      }
      return false;
    };
    const getPluginHeader = (pluginName) => {
      var _a;
      return (_a = cap.PluginHeaders) === null || _a === void 0 ? void 0 : _a.find((h) => h.name === pluginName);
    };
    const handleError = (err) => win.console.error(err);
    const registeredPlugins = /* @__PURE__ */ new Map();
    const registerPlugin2 = (pluginName, jsImplementations = {}) => {
      const registeredPlugin = registeredPlugins.get(pluginName);
      if (registeredPlugin) {
        console.warn(`Capacitor plugin "${pluginName}" already registered. Cannot register plugins twice.`);
        return registeredPlugin.proxy;
      }
      const platform = getPlatform();
      const pluginHeader = getPluginHeader(pluginName);
      let jsImplementation;
      const loadPluginImplementation = async () => {
        if (!jsImplementation && platform in jsImplementations) {
          jsImplementation = typeof jsImplementations[platform] === "function" ? jsImplementation = await jsImplementations[platform]() : jsImplementation = jsImplementations[platform];
        } else if (capCustomPlatform !== null && !jsImplementation && "web" in jsImplementations) {
          jsImplementation = typeof jsImplementations["web"] === "function" ? jsImplementation = await jsImplementations["web"]() : jsImplementation = jsImplementations["web"];
        }
        return jsImplementation;
      };
      const createPluginMethod = (impl, prop) => {
        var _a, _b;
        if (pluginHeader) {
          const methodHeader = pluginHeader === null || pluginHeader === void 0 ? void 0 : pluginHeader.methods.find((m) => prop === m.name);
          if (methodHeader) {
            if (methodHeader.rtype === "promise") {
              return (options) => cap.nativePromise(pluginName, prop.toString(), options);
            } else {
              return (options, callback) => cap.nativeCallback(pluginName, prop.toString(), options, callback);
            }
          } else if (impl) {
            return (_a = impl[prop]) === null || _a === void 0 ? void 0 : _a.bind(impl);
          }
        } else if (impl) {
          return (_b = impl[prop]) === null || _b === void 0 ? void 0 : _b.bind(impl);
        } else {
          throw new CapacitorException(`"${pluginName}" plugin is not implemented on ${platform}`, ExceptionCode.Unimplemented);
        }
      };
      const createPluginMethodWrapper = (prop) => {
        let remove;
        const wrapper = (...args) => {
          const p = loadPluginImplementation().then((impl) => {
            const fn = createPluginMethod(impl, prop);
            if (fn) {
              const p2 = fn(...args);
              remove = p2 === null || p2 === void 0 ? void 0 : p2.remove;
              return p2;
            } else {
              throw new CapacitorException(`"${pluginName}.${prop}()" is not implemented on ${platform}`, ExceptionCode.Unimplemented);
            }
          });
          if (prop === "addListener") {
            p.remove = async () => remove();
          }
          return p;
        };
        wrapper.toString = () => `${prop.toString()}() { [capacitor code] }`;
        Object.defineProperty(wrapper, "name", {
          value: prop,
          writable: false,
          configurable: false
        });
        return wrapper;
      };
      const addListener = createPluginMethodWrapper("addListener");
      const removeListener = createPluginMethodWrapper("removeListener");
      const addListenerNative = (eventName, callback) => {
        const call = addListener({ eventName }, callback);
        const remove = async () => {
          const callbackId = await call;
          removeListener({
            eventName,
            callbackId
          }, callback);
        };
        const p = new Promise((resolve) => call.then(() => resolve({ remove })));
        p.remove = async () => {
          console.warn(`Using addListener() without 'await' is deprecated.`);
          await remove();
        };
        return p;
      };
      const proxy = new Proxy({}, {
        get(_, prop) {
          switch (prop) {
            // https://github.com/facebook/react/issues/20030
            case "$$typeof":
              return void 0;
            case "toJSON":
              return () => ({});
            case "addListener":
              return pluginHeader ? addListenerNative : addListener;
            case "removeListener":
              return removeListener;
            default:
              return createPluginMethodWrapper(prop);
          }
        }
      });
      Plugins[pluginName] = proxy;
      registeredPlugins.set(pluginName, {
        name: pluginName,
        proxy,
        platforms: /* @__PURE__ */ new Set([...Object.keys(jsImplementations), ...pluginHeader ? [platform] : []])
      });
      return proxy;
    };
    if (!cap.convertFileSrc) {
      cap.convertFileSrc = (filePath) => filePath;
    }
    cap.getPlatform = getPlatform;
    cap.handleError = handleError;
    cap.isNativePlatform = isNativePlatform;
    cap.isPluginAvailable = isPluginAvailable;
    cap.registerPlugin = registerPlugin2;
    cap.Exception = CapacitorException;
    cap.DEBUG = !!cap.DEBUG;
    cap.isLoggingEnabled = !!cap.isLoggingEnabled;
    return cap;
  };
  var initCapacitorGlobal = (win) => win.Capacitor = createCapacitor(win);
  var Capacitor = /* @__PURE__ */ initCapacitorGlobal(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
  var registerPlugin = Capacitor.registerPlugin;
  var WebPlugin = class {
    constructor() {
      this.listeners = {};
      this.retainedEventArguments = {};
      this.windowListeners = {};
    }
    addListener(eventName, listenerFunc) {
      let firstListener = false;
      const listeners = this.listeners[eventName];
      if (!listeners) {
        this.listeners[eventName] = [];
        firstListener = true;
      }
      this.listeners[eventName].push(listenerFunc);
      const windowListener = this.windowListeners[eventName];
      if (windowListener && !windowListener.registered) {
        this.addWindowListener(windowListener);
      }
      if (firstListener) {
        this.sendRetainedArgumentsForEvent(eventName);
      }
      const remove = async () => this.removeListener(eventName, listenerFunc);
      const p = Promise.resolve({ remove });
      return p;
    }
    async removeAllListeners() {
      this.listeners = {};
      for (const listener in this.windowListeners) {
        this.removeWindowListener(this.windowListeners[listener]);
      }
      this.windowListeners = {};
    }
    notifyListeners(eventName, data, retainUntilConsumed) {
      const listeners = this.listeners[eventName];
      if (!listeners) {
        if (retainUntilConsumed) {
          let args = this.retainedEventArguments[eventName];
          if (!args) {
            args = [];
          }
          args.push(data);
          this.retainedEventArguments[eventName] = args;
        }
        return;
      }
      listeners.forEach((listener) => listener(data));
    }
    hasListeners(eventName) {
      var _a;
      return !!((_a = this.listeners[eventName]) === null || _a === void 0 ? void 0 : _a.length);
    }
    registerWindowListener(windowEventName, pluginEventName) {
      this.windowListeners[pluginEventName] = {
        registered: false,
        windowEventName,
        pluginEventName,
        handler: (event) => {
          this.notifyListeners(pluginEventName, event);
        }
      };
    }
    unimplemented(msg = "not implemented") {
      return new Capacitor.Exception(msg, ExceptionCode.Unimplemented);
    }
    unavailable(msg = "not available") {
      return new Capacitor.Exception(msg, ExceptionCode.Unavailable);
    }
    async removeListener(eventName, listenerFunc) {
      const listeners = this.listeners[eventName];
      if (!listeners) {
        return;
      }
      const index = listeners.indexOf(listenerFunc);
      if (index !== -1) {
        this.listeners[eventName].splice(index, 1);
      }
      if (!this.listeners[eventName].length) {
        this.removeWindowListener(this.windowListeners[eventName]);
      }
    }
    addWindowListener(handle) {
      window.addEventListener(handle.windowEventName, handle.handler);
      handle.registered = true;
    }
    removeWindowListener(handle) {
      if (!handle) {
        return;
      }
      window.removeEventListener(handle.windowEventName, handle.handler);
      handle.registered = false;
    }
    sendRetainedArgumentsForEvent(eventName) {
      const args = this.retainedEventArguments[eventName];
      if (!args) {
        return;
      }
      delete this.retainedEventArguments[eventName];
      args.forEach((arg) => {
        this.notifyListeners(eventName, arg);
      });
    }
  };
  var encode = (str) => encodeURIComponent(str).replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent).replace(/[()]/g, escape);
  var decode = (str) => str.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent);
  var CapacitorCookiesPluginWeb = class extends WebPlugin {
    async getCookies() {
      const cookies = document.cookie;
      const cookieMap = {};
      cookies.split(";").forEach((cookie) => {
        if (cookie.length <= 0)
          return;
        let [key, value] = cookie.replace(/=/, "CAP_COOKIE").split("CAP_COOKIE");
        key = decode(key).trim();
        value = decode(value).trim();
        cookieMap[key] = value;
      });
      return cookieMap;
    }
    async setCookie(options) {
      try {
        const encodedKey = encode(options.key);
        const encodedValue = encode(options.value);
        const expires = options.expires ? `; expires=${options.expires.replace("expires=", "")}` : "";
        const path = (options.path || "/").replace("path=", "");
        const domain = options.url != null && options.url.length > 0 ? `domain=${options.url}` : "";
        document.cookie = `${encodedKey}=${encodedValue || ""}${expires}; path=${path}; ${domain};`;
      } catch (error) {
        return Promise.reject(error);
      }
    }
    async deleteCookie(options) {
      try {
        document.cookie = `${options.key}=; Max-Age=0`;
      } catch (error) {
        return Promise.reject(error);
      }
    }
    async clearCookies() {
      try {
        const cookies = document.cookie.split(";") || [];
        for (const cookie of cookies) {
          document.cookie = cookie.replace(/^ +/, "").replace(/=.*/, `=;expires=${(/* @__PURE__ */ new Date()).toUTCString()};path=/`);
        }
      } catch (error) {
        return Promise.reject(error);
      }
    }
    async clearAllCookies() {
      try {
        await this.clearCookies();
      } catch (error) {
        return Promise.reject(error);
      }
    }
  };
  var CapacitorCookies = registerPlugin("CapacitorCookies", {
    web: () => new CapacitorCookiesPluginWeb()
  });
  var readBlobAsBase64 = async (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64String = reader.result;
      resolve(base64String.indexOf(",") >= 0 ? base64String.split(",")[1] : base64String);
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(blob);
  });
  var normalizeHttpHeaders = (headers = {}) => {
    const originalKeys = Object.keys(headers);
    const loweredKeys = Object.keys(headers).map((k) => k.toLocaleLowerCase());
    const normalized = loweredKeys.reduce((acc, key, index) => {
      acc[key] = headers[originalKeys[index]];
      return acc;
    }, {});
    return normalized;
  };
  var buildUrlParams = (params, shouldEncode = true) => {
    if (!params)
      return null;
    const output = Object.entries(params).reduce((accumulator, entry) => {
      const [key, value] = entry;
      let encodedValue;
      let item;
      if (Array.isArray(value)) {
        item = "";
        value.forEach((str) => {
          encodedValue = shouldEncode ? encodeURIComponent(str) : str;
          item += `${key}=${encodedValue}&`;
        });
        item.slice(0, -1);
      } else {
        encodedValue = shouldEncode ? encodeURIComponent(value) : value;
        item = `${key}=${encodedValue}`;
      }
      return `${accumulator}&${item}`;
    }, "");
    return output.substr(1);
  };
  var buildRequestInit = (options, extra = {}) => {
    const output = Object.assign({ method: options.method || "GET", headers: options.headers }, extra);
    const headers = normalizeHttpHeaders(options.headers);
    const type = headers["content-type"] || "";
    if (typeof options.data === "string") {
      output.body = options.data;
    } else if (type.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(options.data || {})) {
        params.set(key, value);
      }
      output.body = params.toString();
    } else if (type.includes("multipart/form-data") || options.data instanceof FormData) {
      const form = new FormData();
      if (options.data instanceof FormData) {
        options.data.forEach((value, key) => {
          form.append(key, value);
        });
      } else {
        for (const key of Object.keys(options.data)) {
          form.append(key, options.data[key]);
        }
      }
      output.body = form;
      const headers2 = new Headers(output.headers);
      headers2.delete("content-type");
      output.headers = headers2;
    } else if (type.includes("application/json") || typeof options.data === "object") {
      output.body = JSON.stringify(options.data);
    }
    return output;
  };
  var CapacitorHttpPluginWeb = class extends WebPlugin {
    /**
     * Perform an Http request given a set of options
     * @param options Options to build the HTTP request
     */
    async request(options) {
      const requestInit = buildRequestInit(options, options.webFetchExtra);
      const urlParams = buildUrlParams(options.params, options.shouldEncodeUrlParams);
      const url = urlParams ? `${options.url}?${urlParams}` : options.url;
      const response = await fetch(url, requestInit);
      const contentType = response.headers.get("content-type") || "";
      let { responseType = "text" } = response.ok ? options : {};
      if (contentType.includes("application/json")) {
        responseType = "json";
      }
      let data;
      let blob;
      switch (responseType) {
        case "arraybuffer":
        case "blob":
          blob = await response.blob();
          data = await readBlobAsBase64(blob);
          break;
        case "json":
          data = await response.json();
          break;
        case "document":
        case "text":
        default:
          data = await response.text();
      }
      const headers = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return {
        data,
        headers,
        status: response.status,
        url: response.url
      };
    }
    /**
     * Perform an Http GET request given a set of options
     * @param options Options to build the HTTP request
     */
    async get(options) {
      return this.request(Object.assign(Object.assign({}, options), { method: "GET" }));
    }
    /**
     * Perform an Http POST request given a set of options
     * @param options Options to build the HTTP request
     */
    async post(options) {
      return this.request(Object.assign(Object.assign({}, options), { method: "POST" }));
    }
    /**
     * Perform an Http PUT request given a set of options
     * @param options Options to build the HTTP request
     */
    async put(options) {
      return this.request(Object.assign(Object.assign({}, options), { method: "PUT" }));
    }
    /**
     * Perform an Http PATCH request given a set of options
     * @param options Options to build the HTTP request
     */
    async patch(options) {
      return this.request(Object.assign(Object.assign({}, options), { method: "PATCH" }));
    }
    /**
     * Perform an Http DELETE request given a set of options
     * @param options Options to build the HTTP request
     */
    async delete(options) {
      return this.request(Object.assign(Object.assign({}, options), { method: "DELETE" }));
    }
  };
  var CapacitorHttp = registerPlugin("CapacitorHttp", {
    web: () => new CapacitorHttpPluginWeb()
  });
  var SystemBarsStyle;
  (function(SystemBarsStyle2) {
    SystemBarsStyle2["Dark"] = "DARK";
    SystemBarsStyle2["Light"] = "LIGHT";
    SystemBarsStyle2["Default"] = "DEFAULT";
  })(SystemBarsStyle || (SystemBarsStyle = {}));
  var SystemBarType;
  (function(SystemBarType2) {
    SystemBarType2["StatusBar"] = "StatusBar";
    SystemBarType2["NavigationBar"] = "NavigationBar";
  })(SystemBarType || (SystemBarType = {}));
  var SystemBarsPluginWeb = class extends WebPlugin {
    async setStyle() {
      this.unavailable("not available for web");
    }
    async setAnimation() {
      this.unavailable("not available for web");
    }
    async show() {
      this.unavailable("not available for web");
    }
    async hide() {
      this.unavailable("not available for web");
    }
  };
  var SystemBars = registerPlugin("SystemBars", {
    web: () => new SystemBarsPluginWeb()
  });

  // native/reminder-plan.mjs
  function reminderEvents(item) {
    if (item.hideFromWeeklyReleases === true || item.archived === true) return [];
    if (!["Series", "Anime"].includes(String(item.type))) {
      const raw = item.nextEpisodeDate || item.nextSeasonDate || item.filmReleaseDate;
      return raw ? [{ kind: item.nextEpisodeDate ? "episode" : item.nextSeasonDate ? "season" : "film", raw, number: item.nextEpisodeNum || item.nextSeasonNum }] : [];
    }
    const active = Number(item.airingSeason || item.curSeason || 0);
    const scheduled = Array.isArray(item.scheduledEpisodeReleases) ? item.scheduledEpisodeReleases : [];
    const cached = Array.isArray(item.recurringWeeklySchedule?.episodes) ? item.recurringWeeklySchedule.episodes : [];
    const match = [...scheduled, ...cached].find((ep) => Number(ep?.number) === Number(item.nextEpisodeNum) && ep?.raw === item.nextEpisodeDate);
    const nextSeason = Number(match?.season || (Number(item.nextEpisodeNum) === 1 ? item.nextSeasonNum || active : active));
    const byEpisode = /* @__PURE__ */ new Map();
    for (const ep of [...cached, { season: active, number: item.latestEpisodeNum, raw: item.latestEpisodeDate }, { season: nextSeason, number: item.nextEpisodeNum, raw: item.nextEpisodeDate }, ...scheduled]) {
      const number = Number(ep?.number), season = Number(ep?.season || 0), raw = String(ep?.raw || "").trim();
      if (raw && Number.isInteger(number) && number > 0 && Number.isInteger(season) && season >= 0) byEpisode.set(`${season}:${number}`, { kind: "episode", number, season, raw });
    }
    const events = [...byEpisode.values()];
    if (item.nextSeasonDate && !events.some((ep) => ep.season === Number(item.nextSeasonNum) && ep.number === 1)) events.push({ kind: "season", raw: item.nextSeasonDate, number: item.nextSeasonNum });
    return events;
  }
  function reminderPlan(items, accountId, { now = Date.now(), resolveItem = (item) => item, resolveEvent = (_item, event) => event, limit = 60 } = {}) {
    const requests = [], seen = /* @__PURE__ */ new Set();
    for (const original of items) {
      const item = resolveItem(original);
      for (const source of reminderEvents(item)) {
        const event = resolveEvent(item, source);
        if (!event || event.streamingUnconfirmed || !item.releaseSchedule && !event.releaseSchedule) continue;
        const raw = String(event.raw || "");
        if (!/T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) continue;
        const time = Date.parse(raw);
        if (!Number.isFinite(time) || time <= now) continue;
        if (!["Planned", "Saved"].includes(item.status) && event.kind !== "episode") continue;
        const label = event.kind === "episode" ? `${item.title} \xB7 S${event.season || item.curSeason || 1} E${event.number}` : event.kind === "season" ? `${item.title} \xB7 Season ${event.number || "next"}` : String(item.title);
        for (const lead of [24, 6, 0]) {
          const at = time - lead * 36e5;
          if (at <= now + 1e3) continue;
          const key = JSON.stringify([String(item.id), event.kind, event.season || 0, event.number || 0, raw, lead]);
          if (seen.has(key)) continue;
          seen.add(key);
          requests.push({ id: key, itemId: String(item.id), accountId: String(accountId), at, title: "Watch Logger Reminder", body: lead === 0 ? `${label} out now` : `${label} out in ${lead === 24 ? "1 day" : `${lead} hours`}` });
        }
      }
    }
    return requests.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(0, Math.max(0, Math.min(60, limit)));
  }

  // native/controls.js
  function installNativeControls(Native) {
    let frame = 0, last = "", generation = 0;
    const hidden = (element) => !element || element.hidden || element.classList.contains("hidden");
    function openSearch(query = "") {
      if (currentTab !== "search") openTitleSearch();
      if (query) {
        discoveryInput.value = query;
        discoveryInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      searchInput.value = "";
      searchQuery = "";
      discoveryInput.focus({ preventScroll: true });
    }
    searchInput.placeholder = "Search your library and all titles";
    searchInput.addEventListener("focus", () => openSearch(searchInput.value.trim()));
    searchInput.oninput = (event) => openSearch(event.target.value.trim());
    const page = document.getElementById("discovery-view");
    page.setAttribute("role", "region");
    page.removeAttribute("aria-modal");
    document.getElementById("discovery-heading").textContent = "Search";
    document.getElementById("close-title-search").setAttribute("aria-label", "Leave Search");
    async function sync() {
      frame = 0;
      const overlay = Boolean(document.querySelector("dialog[open]")) || ["modal", "episode-tracker-modal"].some((id) => !hidden(document.getElementById(id)));
      const state = { visible: Boolean(currentUser && authScreen.classList.contains("hidden") && !overlay), tab: ["settings", "search"].includes(currentTab) ? currentTab : "library", searchVisible: currentTab === "library" && !hidden(document.getElementById("add-btn")), dark: document.documentElement.dataset.theme === "dark" };
      const key = JSON.stringify(state);
      if (key === last) return;
      last = key;
      const request = ++generation;
      try {
        const result = await Native.updateControls(state);
        if (request === generation) document.documentElement.classList.toggle("watchlog-native-controls", result.ready === true);
      } catch (_) {
        if (request === generation) {
          last = "";
          document.documentElement.classList.remove("watchlog-native-controls");
        }
      }
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(sync);
    }
    new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "hidden", "open", "data-theme", "data-active-tab"] });
    window.addEventListener("watchlog:native-control", (event) => {
      if (event.detail === "search" || event.detail === "add") openSearch();
      else if (["library", "settings"].includes(event.detail)) document.querySelector(`.bottom-tabs [data-tab="${event.detail}"]`)?.click();
    });
    schedule();
  }

  // native/bridge.js
  if (Capacitor.isNativePlatform()) {
    let plan = function() {
      return reminderPlan(mediaItems, currentUser.id, {
        resolveItem: (item) => window.WatchLogRegionalReleases?.resolve(item, context()) || item,
        resolveEvent: (item, event) => window.WatchLogRegionalReleases?.resolveEvent(item, event, context()) || event
      });
    }, reconcile = function(force = false) {
      tail = tail.catch(() => {
      }).then(async () => {
        const account = String(currentUser?.id || "");
        const settings = await Native.status();
        if (account !== String(currentUser?.id || "")) return;
        if (!account || preference() !== "on" || settings.permission !== "granted") {
          if (force || lastPlan) {
            await Native.cancelReminders();
            lastPlan = "";
          }
          return;
        }
        const requests = plan(), key = JSON.stringify([account, requests]);
        if (force || key !== lastPlan) {
          await Native.replaceReminders({ requests });
          lastPlan = key;
        }
        report(`iPhone reminders on \xB7 ${requests.length} upcoming alerts scheduled. Open the app online to refresh release times.`, "ok", "on");
      });
      return tail;
    }, openPendingItem = function() {
      if (!pendingItem || !currentUser) return;
      const item = pendingItem;
      pendingItem = null;
      if (String(item.accountId) !== String(currentUser.id)) return;
      if (mediaItems.some((row) => String(row.id) === String(item.itemId))) openMediaRow(String(item.itemId));
    };
    const Native = registerPlugin("WatchLogNative");
    window.WatchLogNative = Native;
    installNativeControls(Native);
    let timer, tail = Promise.resolve(), lastPlan = "", pendingItem = null;
    const report = (message, state = "", connection = "off") => setBackgroundReminderStatus(message, state, connection);
    const preference = () => currentUser ? backgroundReminderPreference() : null;
    const context = () => ({ country: typeof releaseViewingCountry === "function" ? releaseViewingCountry() : "GB", timeZone: DEVICE_TIME_ZONE, locale: USER_LOCALE });
    async function refresh() {
      if (!currentUser) {
        report("Sign in to manage iPhone reminders.");
        await reconcile(true);
        return false;
      }
      const settings = await Native.status();
      if (settings.permission === "denied") {
        report("Notifications are blocked. Enable Watched Tracker in iPhone Settings \u2192 Notifications.", "error", "blocked");
        return false;
      }
      if (settings.permission === "granted" && preference() === "on") {
        await reconcile();
        return true;
      }
      report("Enable iPhone reminders to schedule confirmed release times on this device.");
      return false;
    }
    refreshBackgroundReminderStatus = refresh;
    syncExistingBackgroundPush = refresh;
    removeBackgroundPush = async () => {
      await Native.cancelReminders();
      lastPlan = "";
    };
    pushSupportError = () => "";
    enableBackgroundReminders.onclick = () => runBackgroundReminderAction(async () => {
      const account = String(currentUser?.id || "");
      if (!account) throw new Error("Sign in first.");
      const result = await Native.requestPermission();
      if (account !== String(currentUser?.id || "")) return;
      if (result.permission !== "granted") {
        await refresh();
        return;
      }
      backgroundReminderPreference("on");
      await reconcile(true);
    });
    disableBackgroundReminders.onclick = () => runBackgroundReminderAction(async () => {
      backgroundReminderPreference("off");
      await reconcile(true);
      await Native.cancelReminders();
      report("iPhone reminders are off on this device.");
    });
    const oldTest = document.getElementById("test-background-reminder"), test = oldTest.cloneNode(true);
    oldTest.replaceWith(test);
    test.onclick = () => runBackgroundReminderAction(async () => {
      await Native.testReminder();
      report("Test reminder scheduled for this iPhone.", "ok", "on");
    });
    const originalRender = render;
    render = function(...args) {
      const result = originalRender(...args);
      clearTimeout(timer);
      timer = setTimeout(() => void reconcile().catch((error) => report(error.message, "error", "repair")), 600);
      return result;
    };
    const originalClear = clearUserState;
    clearUserState = async function(...args) {
      clearTimeout(timer);
      const result = await originalClear(...args);
      await reconcile(true);
      await Native.cancelReminders();
      lastPlan = "";
      return result;
    };
    const offline = document.getElementById("offline-status");
    requestOfflineStatus = () => {
      offline.textContent = "The app screens are included on this iPhone. Saved titles and edits remain available offline after your first sign-in. Code updates arrive through TestFlight or the App Store.";
    };
    requestOfflineStatus();
    document.getElementById("refresh-offline-copy").hidden = true;
    const reminderDescription = document.querySelector(".background-reminder-card .small-note");
    if (reminderDescription) reminderDescription.textContent = "iPhone alerts use the latest confirmed release times saved on this device. Up to 60 upcoming alerts are kept. Open the app online to refresh dates and schedule more. These alerts are separate from website push subscriptions.";
    const oldExport = document.getElementById("export-library-backup"), exportButton = oldExport.cloneNode(true);
    oldExport.replaceWith(exportButton);
    exportButton.onclick = async () => {
      try {
        if (!currentUser) throw new Error("Sign in to export your library.");
        const data = { format: "watchlog-library-backup", version: 1, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), items: cloneLibrarySnapshot(mediaItems) };
        await Native.shareBackup({ text: JSON.stringify(data, null, 2) });
        document.getElementById("library-backup-status").textContent = "Backup sharing opened.";
      } catch (error) {
        document.getElementById("library-backup-status").textContent = error.message || "Could not share the backup.";
      }
    };
    window.addEventListener("watchlog:native-active", () => {
      window.dispatchEvent(new Event("focus"));
      void refresh().catch(() => {
      });
      void takeNotification();
    });
    async function takeNotification() {
      const item = await Native.takeNotification();
      if (item.itemId) {
        pendingItem = item;
        openPendingItem();
      }
    }
    window.addEventListener("watchlog:native-notification", () => {
      void takeNotification();
    });
    setInterval(openPendingItem, 1500);
    void takeNotification();
    void refresh().catch((error) => report(error.message, "error", "repair"));
  }
})();
/*! Bundled license information:

@capacitor/core/dist/index.js:
  (*! Capacitor: https://capacitorjs.com/ - MIT License *)
*/
