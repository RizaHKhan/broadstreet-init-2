/* jshint loopfunc:true */
/* jslint evil: true */
(function (win) {
    'use strict';

    var listeners = [],
    doc = win.document,
    MutationObserver = win.MutationObserver || win.WebKitMutationObserver,
    observer;

    /**
     * Listen for availablity of certain DOM elements
     *
     * @param {any} selector The selector of an element you need to know about
     * @param {any} fn The callback when it become available
     */
    var ready = function(selector, fn) {
        // Store the selector and callback to be monitored
        listeners.push({
            selector: selector,
            fn: fn
        });
        if(!observer){
            // Watch for changes in the document
            observer = new MutationObserver(check);
            observer.observe(doc.documentElement, {
                childList: true,
                subtree: true
            });
        }
        // Check if the element is currently in the DOM
        check();
    };

    /**
     * Check to see if a given eleemnt is in the DOM
     */
    var check = function() {
        // Check the DOM for elements matching a stored selector
        for(var i = 0, len = listeners.length, listener, elements; i < len; i++){
            listener = listeners[i];
            // Query for elements matching the specified selector
            elements = doc.querySelectorAll(listener.selector);
            for(var j = 0, jLen = elements.length, element; j < jLen; j++){
                element = elements[j];
                // Make sure the callback isn't invoked with the
                // same element more than once
                if(!element.ready){
                    element.ready = true;
                    // Invoke the callback with the element
                    listener.fn.call(element, element);
                }
            }
        }
    };

    /**
     * Get query param
     */
    var getQueryParam = function(name) {
        name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
        var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
        results = regex.exec(location.search);
        return results === null ? null : decodeURIComponent(results[1].replace(/\+/g, " "));
    };

    /**
     * Get parameters used for displaying an ad in a zone
     */
    var getPreviewParams = function(zone_id) {
        var zone = getQueryParam('broadstreet_preview_zone');
        var alias = getQueryParam('broadstreet_preview_zone_alias');
        var ad = getQueryParam('broadstreet_preview_ad');

        if (zone && ad) {
            return { zone_id: zone, zone_alias: alias, ad_id: ad };
        } else {
            return null;
        }
    };

    /**
     * Generate a random string with a given prefix and length
     *
     * @param {any} prefix
     * @param {any} length
     * @returns
     */
    var randomString = function(prefix, length) {
        return (prefix || '') + Math.round((Math.pow(36, length + 1) - Math.random() * Math.pow(36, length))).toString(36).slice(1);
    };

    /**
     * Get the segments of the current URL's URI
     *
     * @returns
     */
    var uriSegments = function () {
        var path = window.location.pathname;
        var extIdx = path.indexOf('.'); // -1 if no extension found
        return win.location.pathname.slice(1, extIdx !== -1 ? extIdx : undefined).split('/');
    };

    /**
     * This is the main Broadstreet object, used for loading and
     * interacting with zones.
     * TODO: Undo
     */
    win.broadstreet = /* win.broadstreet || */ (function () {
        var self = {},
            shown = '',
            queue = [],
            head = document.head,
            body = document.body,
            working = false,
            zones = {},
            altMode = false,
            previewParams = null,
            networkJSLoaded = false;

        var options = {
            domain: 'ad.broadstreetads.com',
            selector: 'broadstreet-zone',
            keywords: window.broadstreetKeywords || [],
            uriKeywords: false,
            softKeywords: false,
            noRotate: false,
            useAltZone: function () { return false; },
            altZoneWhitelist: [],
            altZoneShortlist: [],
            autoAttach: [],
            autoAttachAndWatch: [],
            networkId: null,
            useZoneAliases: false,
            targets: {},
            zoneOptions: {}
        };

        /**
         * Return a comma separated list of keywords
         *
         * @param {any} keywords
         * @returns
         */
        var constructKeywordsString = function (keywords) {
            return typeof keywords.join === 'function' ? keywords.join(',') : keywords;
        };

        /**
         * Turns an object into params
         * @param {*} targets
         */
        var objectToQueryString = function (a) {
            var prefix, s, add, name, r20, output;
            s = [];
            r20 = /%20/g;
            add = function (key, value) {
                // key = 'bst_' + key;
                // If value is a function, invoke it and return its value
                value = ( typeof value == 'function' ) ? value() : ( !value ? "" : value );
                s[ s.length ] = encodeURIComponent(key) + "=" + encodeURIComponent(value);
            };
            if (a instanceof Array) {
                for (name in a) {
                    add(name, a[name]);
                }
            } else {
                for (prefix in a) {
                    buildParams(prefix, a[ prefix ], add);
                }
            }
            output = s.join("&").replace(r20, "+");
            return output;
        };

        /**
         * Format targets for the adserver
         * @param {*} targets
         */
        var prepTargets = function (targets) {
            targets = targets || {};
            var t = {}, k = Object.keys(targets);
            for (var i = 0; i < k.length; i++) {
                t['bst_' + k[i]] = targets[k[i]];
            }
            return t;
        };

        /**
         *
         * @param {*} Build params for a property prefix
         * @param {*} obj
         * @param {*} add
         */
        var buildParams = function(prefix, obj, add) {
            var name, i, l, rbracket;
            rbracket = /\[\]$/;
            if (obj instanceof Array) {
                for (i = 0, l = obj.length; i < l; i++) {
                    if (rbracket.test(prefix)) {
                        add(prefix, obj[i]);
                    } else {
                        buildParams(prefix + "[" + ( typeof obj[i] === "object" ? i : "" ) + "]", obj[i], add);
                    }
                }
            } else if (typeof obj == "object") {
                // Serialize object item.
                for (name in obj) {
                    buildParams(prefix + "[" + name + "]", obj[ name ], add);
                }
            } else {
                // Serialize scalar item.
                add(prefix, obj);
            }
        };

        /**
         * Begin processing / loading zones
         */
        var loadZones = function () {
            if (working) return;
            var z = queue.shift();
            if (!z) return;

            var done = false;
            var script = document.createElement('script');
            script.type = 'text/javascript';
            script.async = true;

            // are we in preview mode?
            if (previewParams && (z.id == previewParams.zone_alias || z.id == previewParams.zone_id)) {
                script.src = adUrl(previewParams.ad_id, z);
                previewParams = null;
            } else {
                // load the zone as usual
                script.src = zoneUrl(z.id, z.options) + '&target=' + z.el.id;
            }

            script.onload = script.onreadystatechange = script.onerror = function () {
                if (!done && (!script.readyState || script.readyState === 'loaded' || script.readyState === 'complete')) {
                    done = true;
                    working = false;
                    loadZones();
                    // memory leak
                    script.onload = script.onreadystatechange = script.onerror = null;
                    if (document.head && script.parentNode) { document.head.removeChild(script); }
                }
            };
            working = true;
            document.head.insertBefore(script, document.head.lastChild);
        };

        var attachZone = function (el, z) {
            // has the element already had an auto-attach?
            if (el.getAttribute('data-autoattached') == 'true') return;
            var pos = z.position || 'afterend';
            var z_el = document.createElement(options.selector);
            var attrs = Object.keys(z);
            for (var a = 0; a < attrs.length; a++) {
                z_el.setAttribute(attrs[a], z[attrs[a]]);
            }
            el.insertAdjacentHTML(pos, z_el.outerHTML);
            // mark it so we don't hit it again
            el.setAttribute('data-autoattached', 'true');
        };

        /**
         * Merge multiple objects into a new one
         * @param {*} o1
         * @param {*} o2
         */
        var mergeObjects = function (o1, o2) {
            o1 = o1 || {};
            o2 = o2 || {};
            var newObject = {};

            var keys = Object.keys(o1).concat(Object.keys(o2));

            for (var i  = 0; i < keys.length; i++) {
                if (o2.hasOwnProperty(keys[i])) {
                    newObject[keys[i] + ''] = o2[keys[i]];
                } else {
                    newObject[keys[i] + ''] = o1[keys[i]];
                }
            }

            return newObject;
        };

        self.autoAttach = function (rules) {
            var props, els, z, pos, el, attrs;
            props = Object.keys(rules || options.autoAttach);
            for (var i = 0; i < props.length; i++) {
                try {
                    els = document.querySelectorAll(props[i]);
                } catch (e) {
                    console.debug('No elements found for selector', props[i]);
                    els = [];
                }
                if (els.length) {
                    z = options.autoAttach[props[i]];
                    for (var j = 0; j < els.length; j++) {
                        attachZone(els[j], z);
                    }
                }
            }
        };

        self.autoAttachAndWatch = function (rules) {
            var props = Object.keys(rules || options.autoAttachAndWatch);
            for (var i = 0; i < props.length; i++) {
                var zone = options.autoAttachAndWatch[props[i]];
                ready(props[i], function (z) {
                    return function (el) {
                        attachZone(el, z);
                    };
                }(zone));
            }
        };

        var debounce = function (func, wait, immediate) {
            var timeout;
            return function() {
                var context = this, args = arguments;
                var later = function() {
                    timeout = null;
                    if (!immediate) func.apply(context, args);
                };
                var callNow = immediate && !timeout;
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
                if (callNow) func.apply(context, args);
            };
        };

        /**
         * Check if the page is ready
         */
        var pageReady = function () {
            return (document.readyState === "complete" || document.readyState === "loaded" || document.readyState === "interactive");
        };

        var init = function() {
            // check for preview mode
            previewParams = getPreviewParams();

            // checking for integer below
            if (options.useAltZone % 1 === 0) {
                var width = options.useAltZone;
                options.useAltZone = function() {
                    if (window.innerWidth <= width) {
                        altMode = true;
                        return true;
                    } else {
                        altMode = false;
                        return false;
                    }
                };

                window.addEventListener('resize', debounce(function () {
                    if ((altMode && !options.useAltZone()) || (!altMode && options.useAltZone())) {
                        self.refreshAll();
                    }
                }), 500, false);
            }

            /**
             * See if the auto-attach utility is used. On DOM load, will
             * run it if needed
             */
            if (options.networkId) {
                self.loadNetworkJS (options.networkId);
            }

            /**
             * Make sure any zone ids passed in are strings (for equality checking)
             */
            if (options.altZoneShortlist.length) {
                for (var i = 0; i < options.altZoneShortlist.length; i++) {
                    options.altZoneShortlist[i] = options.altZoneShortlist[i].toString();
                }
            }

            if (options.altZoneWhitelist.length) {
                for (var j = 0; j < options.altZoneWhitelist.length; j++) {
                    options.altZoneWhitelist[j] = options.altZoneWhitelist[j].toString();
                }
            }

            /**
             * See if the auto-attach utility is used. On DOM load, will
             * run it if needed
             */
            if (Object.keys(options.autoAttach).length) {
                if (pageReady()) {
                    self.autoAttach();
                } else {
                    document.addEventListener('DOMContentLoaded', function () { self.autoAttach(); });
                }
            }

            /**
             * See if the auto-attach utility is used. On DOM load, will
             * run it if needed
             */
            if (Object.keys(options.autoAttachAndWatch).length) {
                if (pageReady()) {
                    self.autoAttachAndWatch();
                } else {
                    document.addEventListener('DOMContentLoaded', function () { self.autoAttachAndWatch(); });
                }
            }
        };

        /**
         * Handler for when a zone DOM element becomes available
         *
         * @param {any} z
         * @returns
         */
        var zoneElementAvailable = function(z, finalOverrides) {
            var id = z.getAttribute('zone-id') || z.getAttribute('alt-zone-id'),
                altId = z.getAttribute('alt-zone-id'),
                noAlt = z.getAttribute('no-alt'),
                tmp,
                opts;

            finalOverrides = finalOverrides || {};

            var zContainer = document.createElement(options.selector + '-container' + (altId ? '-alt' : ''));
            z.parentNode.replaceChild(zContainer, z);
            zContainer.appendChild(z);

            // A flag to let show that there is no alt position, and to load it in alt mode
            if (noAlt) {
                options.altZoneWhitelist.push(id);
            }

            // clear any old styles
            z.removeAttribute('style');

            if (altId) {
                if (!zones[id]) zones[id] = {};
                zones[id].altContainer = zContainer;
                if (!options.useAltZone()) return;
            } else {
                if (!zones[id]) zones[id] = {};
                zones[id].container = zContainer;
                zones[id].el = z;
                if (options.useAltZone()) {
                    if (options.altZoneShortlist.length) {
                        if (options.altZoneShortlist.indexOf(id) >= 0) return;
                    } else if (options.altZoneWhitelist.indexOf(id) < 0) {
                        return;
                    }
                }
            }

            tmp = z.getAttribute('active-style');
            if (tmp) {
                z.setAttribute('style', tmp);
            }

            // clone the options
            opts = JSON.parse(JSON.stringify(options));
            opts = mergeObjects(opts, opts.zoneOptions[id]);
            opts = mergeObjects(opts, finalOverrides);

            // keep track of whether this ad was loaded
            if (z.getAttribute('tracked')) {
                return;
            } else {
                z.setAttribute('tracked', 'true');
            }

            tmp = z.getAttribute('autoload');
            if (tmp || opts.autoload === false) {
                if (opts.autoload === false || (tmp && tmp.toLowerCase() == 'false')) return;
            }

            // set keywords
            tmp = z.getAttribute('keywords');
            if (tmp) {
                opts.keywords = tmp.split(',');
                for (var i = 0; i < opts.keywords.length; i++) {
                    opts.keywords[i] = opts.keywords[i].trim().toLowerCase();
                }
            }

            // soft keywords
            tmp = z.getAttribute('soft-keywords');
            if (tmp) {
                if (tmp && tmp.toLowerCase() == 'true') {
                    opts.softKeywords = true;
                }
            }

            // rotation
            tmp = z.getAttribute('no-rotate');
            if (tmp) {
                if (tmp && tmp.toLowerCase() == 'true') {
                    opts.noRotate = true;
                }
            }

            // callback
            tmp = z.getAttribute('callback');
            if (tmp) {
                opts.callback = tmp;
            }

            // ad count
            tmp = z.getAttribute('count');
            if (tmp) {
                opts.count = tmp;
            }

            // give it an id
            if (!z.id) z.id = randomString('street-', 10);

            // hold on to the options
            zones[id].opts = opts;

            queue.push({
                id: id,
                el: z,
                options: opts
            });

            loadZones();
        };

        /**
         * Load gloabl network javascript
         */
        self.loadNetworkJS = function (networkId) {
            if (networkJSLoaded) return;
            options.networkId = networkId;
            var script = document.createElement('script');
            script.type = 'text/javascript';
            script.async = true;
            script.src = '//' + options.domain + '/ndisplay/' + networkId + '.js';
            document.head.insertBefore(script, document.head.lastChild);
            networkJSLoaded = true;
        };

        /**
         * When Broadstreet loads, there might be a queue
         * of functions to run. Init runs those and after that,
         * that queue gets replaced with this
         */
        setTimeout(function() {
            if (window.broadstreet.run && window.broadstreet.run.length) {
                for (var i = 0; i < window.broadstreet.run.length; i++) {
                    window.broadstreet.run[i]();
                }
                window.broadstreet.run = self.run;
            }
        }, 50);
        self.run = (function () {
            return {
                push: function(fn) {
                    fn();
                }
            };
        })();

        /**
         * In the case of an ad to zone preview,the ad url required to force an
         *  ad into a zone
         */
        var adUrl = function (adId, zone) {
            var src;
            zone.el.innerHTML = '<div street-address="' + adId + '"></div>';
            return '//' + options.domain + '/display/' + adId + '.js?sa=1&init=0';
        };


        /**
         * Construct the url for a zone
         *
         * @param {any} id
         * @param {any} opts
         * @returns
         */
        var zoneUrl = function (id, opts) {

            var src;
            if (opts.useZoneAliases && opts.networkId) {
                src = '//' + opts.domain +  '/zndisplay/' + opts.networkId + '/' + id + '.js';
            } else {
                src = '//' + opts.domain +  '/zdisplay/' + id + '.js';
            }
            // set up options
            if (opts.uriKeywords) {
                opts.keywords = opts.keywords || [];
                opts.keywords = opts.keywords.concat(uriSegments());
            }

            var params = prepTargets(opts.targets);
            // put together our string
            src += '?b=' + shown;
            if (opts.keywords) params.kw = constructKeywordsString(opts.keywords);
            if (opts.count) params.count = opts.count;
            if (opts.softKeywords) params.skw = 'true';
            if (opts.noRotate) params.nr = 'true';
            if (opts.adOverride) params.ao = opts.adOverride;
            if (opts.campaignOverride) params.co = opts.campaignOverride;
            if (opts.callback) params.cb = opts.callback;

            src += '&' + objectToQueryString(params);

            return src;
        };

        /**
         * Clear the list of campaigns
         */
        self.clearCampaignLog = function() {
            shown = '';
        };

        /**
         * Load or reload a zone
         *
         * @param {any} z Selector or DOM element
         */
        self.loadZone = function (z, opts) {
            opts = opts || {};
            opts.autoload = true;

            if (!z.tagName) {
                z = document.querySelector(z);
            }

            z.removeAttribute('autoload');
            z.removeAttribute('tracked');
            z.innerHTML = '';

            zoneElementAvailable(z, opts);
        };

        /**
         * Refresh all zones on the page
         */
        self.refreshAll = function () {
            var els = document.querySelectorAll(options.selector);
            self.clearCampaignLog ();
            for (var i = 0; i < els.length; i++) {
                self.loadZone (els[i]);
            }
        };

        /**
         * Register a campaign as shown (more for the backend)
         *
         * @param {any} id
         */
        self.register = function (id) {
            shown += shown ? ',' + id : id;
        };

        /**
         * Set targets to be sent to the adserver
         */
        self.setTargeting = function (key, value) {
            if (typeof key == 'object') {
                // bulk setting of options
                options.targets = mergeObjects(options.targets, key);
            } else {
                options.targets[key] = value;
            }
        };

        /**
         * Set options for the Broadstreet object
         *
         * @param {any} opts
         */
        self.setOptions = function (opts) {
            options = mergeObjects(options, opts);
        };

        /**
         * Track hover for an element
         * */
        self.trackHover = function (elem, url) {
            elem.onmouseover = undefined; // only once
            // send
            var xmlhttp = window.XMLHttpRequest ? new XMLHttpRequest() : new ActiveXObject('Microsoft.XMLHTTP');
            xmlhttp.open('GET', url, true);
            xmlhttp.send();
        };

        /**
         * Begin watching for new zones
         *
         * @param {any} opts
         */
        self.watch = function (opts) {
            if (window.broadstreetLoaded) {
                console.warn ('broadstreet.watch() has been called multiple times. Ignoring calls beyond the first.');
            } else {
                window.broadstreetLoaded = true;
                self.setOptions(opts || {});
                init();
                ready(options.selector, zoneElementAvailable);
            }
        };

        /**
         * Note that a certain method is unsupported
         */
        self.deprecated = function (name) {
            return function () {
                console.warn('broadstreet.' + name, 'is no longer a supported method call. Please see: http://information.broadstreetads.com/using-broadstreets-v2-ad-tags/');
            };
        };

        self.setDefaultAsync = self.deprecated('setDefaultAsync');
        self.setWhitelabel = self.deprecated('setWhitelabel');
        self.zone = function (id) {
            // we'll do it, but only if we can
            if (document.readyState == 'loading') {
                document.write('<' + options.selector + ' zone-id="' + id + '"></' + options.selector + '>');
            }

            self.deprecated('zone')();
        };

        return self;
    })();

})(this);

if (document.dispatchEvent) {
    // Let anyone who's watching know
    try {
        document.dispatchEvent(new Event('broadstreetLoaded'));
    } catch (e) {
        // noop
    }
}

/* Built: Tue Sep 05 2017 19:01:48 GMT-0700 (PDT) */