/* MagicMirror² Module: MMM-Strava-Last-Activity-Map */
/* Multi-instance support, cleaned-up version */

/* global google, Log, Module, MM */

Module.register("MMM-Strava-Last-Activity-Map", {
    // --- Module State (Instance Specific) ---
    currentActivityId: null,
	apiData: null,
	loading: true,
    error: null,
    mapsApiLoaded: false,
    mapsApiLoading: false,
    updateTimer: null,
    map: null,
    polyline: null,
    mapWrapper: null,
    infoWrapper: null,

    // --- Defaults ---
	defaults: {
		stravaClientId: "", 
		stravaClientSecret: "", 
		stravaRefreshToken: "", 
        tokenFilename: "strava_access_token.json", // REQUIRED & UNIQUE per instance
		units: "metric",
		zoom: 10,
		mapTypeId: "roadmap", // "roadmap", "satellite", "hybrid", "terrain"
        mapStyle: null, // Custom JSON style array or null
		disableDefaultUI: true,
		header: "Last Activity on Strava",
		initialLoadDelay: 2500,
		updateInterval: 15 * 60 * 1000, // 15 minutes
		width: "250px",
		height: "250px",
		googleMapsApiKey: "", // Required
        lookBackDays: 30,
        lookAheadDays: 1,
        showTextFields: true, 
        showMapIfPresent: true, 
        strokeColor: "#FC4C02", 
        strokeOpacity: 1.0,     
        strokeWeight: 2         
	},

	// --- Standard MM Methods ---
	init () { Log.info(`${this.name} (${this.identifier}): Initializing.`); },
	getHeader () { return this.config.header || "Strava Last Activity Map"; },

	start () {
		Log.info(`Starting module: ${this.name} (${this.identifier})`);
        this.currentActivityId = null; this.apiData = null; this.map = null; this.polyline = null;
		this.loading = true; this.error = null; this.mapsApiLoaded = false; this.mapsApiLoading = false;
        if (typeof google !== 'undefined' && typeof google.maps !== 'undefined') {
            this.mapsApiLoaded = true;
            Log.info(`${this.name} (${this.identifier}): Google Maps API already loaded globally.`);
        }
        // Validate required config
        if (!this.config.stravaClientId || !this.config.stravaClientSecret || !this.config.stravaRefreshToken || !this.config.tokenFilename || !this.config.googleMapsApiKey) {
            this.error = "Missing required config (check clientId, clientSecret, refreshToken, tokenFilename, googleMapsApiKey)";
            Log.error(`${this.name} (${this.identifier}): ${this.error}`);
            this.updateDom();
        } else {
            this.scheduleUpdate(this.config.initialLoadDelay);
        }
	},

	scheduleUpdate (delay) {
        // Log.info(`${this.name} (${this.identifier}): Scheduling update with delay: ${delay}`); // Optional log
        if (this.updateTimer) { clearInterval(this.updateTimer); this.updateTimer = null; }
		const interval = this.config.updateInterval;
        const self = this;

        const fetchData = () => {
             // Log.info(`${self.name} (${self.identifier}): fetchData() called.`); // Optional log
             self.error = null;
             if (typeof self.getApiData === 'function') {
                 self.getApiData();
             } else { Log.error(`${self.name} (${self.identifier}): Error - self.getApiData not found!`); }
        };

        if (typeof delay === "number" && delay >= 0) {
            setTimeout(() => {
                fetchData();
                // Log.info(`${self.name} (${self.identifier}): Setting update interval after delay: ${interval}ms`); // Optional log
                self.updateTimer = setInterval(fetchData, interval);
            }, delay);
        } else {
            fetchData();
            // Log.info(`${self.name} (${self.identifier}): Setting update interval immediately: ${interval}ms`); // Optional log
            self.updateTimer = setInterval(fetchData, interval);
        }
	},

	getApiData () {
        // Log.info(`${this.name} (${this.identifier}): Requesting Strava data from node_helper.`); // Optional log
        this.loading = true;
        this.sendSocketNotification("GET_STRAVA_DATA", {
            identifier: this.identifier,
            config: this.config
        });
	},

	getDom () {
		const wrapper = document.createElement("div");
        wrapper.className = `MMM-Strava-Last-Activity-Map ${this.identifier}`;

        // --- Error Display ---
        if (this.error) {
            wrapper.innerHTML = `<div class="error dimmed small">${this.error}</div>`;
            return wrapper;
        }
        // --- Loading Display ---
		if (this.loading && !this.apiData) {
			wrapper.innerHTML = `<div class="loading dimmed small">Loading Activity Data...</div>`;
            return wrapper;
		}
        // --- No Data ---
        if (!this.loading && (!this.apiData || !this.apiData.id)) {
             wrapper.innerHTML = `<div class="dimmed small no-activity">No recent activity data found.</div>`;
             return wrapper;
        }

        // --- Prepare Display Strings ---
        let displayDateStr = 'Date N/A', timeStr = 'N/A', paceStr = 'N/A', distanceStr = 'N/A', distanceUnits = '', nameStr = 'Unnamed Activity';
        // --- Populate Display Strings ---
        if (this.apiData && this.apiData.id) {
            nameStr = this.apiData.name || 'Unnamed Activity';
            if (this.apiData.activityDate) {
                try {
                    const date = new Date(this.apiData.activityDate);
                    const day = String(date.getDate()).padStart(2, '0');
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const year = date.getFullYear();
                    displayDateStr = `${day}.${month}.${year}`;
                } catch(e) { Log.error(`${this.name} (${this.identifier}): Error formatting date: ${this.apiData.activityDate}`, e); }
            }
            timeStr = this.apiData.formattedTime || 'N/A';
            distanceStr = this.apiData.distance ?? 'N/A';
            distanceUnits = this.apiData.distanceUnits || '';
            if (this.apiData.formattedPace) { paceStr = `${this.apiData.formattedPace} /${distanceUnits}`; }
        }

        // --- Build Activity Info HTML ---
        if (this.config.showTextFields) {
            if (!this.infoWrapper) {
                 this.infoWrapper = document.createElement("div");
                 this.infoWrapper.className = "small bright activityDetails"
            }
            this.infoWrapper.innerHTML = `
            <p>
                ${nameStr ? `<span class="name">${nameStr}</span>` : ""}
                ${"-"}
                ${displayDateStr ? `<span class="time">${displayDateStr}</span>` : ""}
            </p>
            <p>
                ${(this.apiData.distance !== null && this.apiData.distance !== undefined) ? `<span class="value">${this.apiData.distance}</span> ${this.apiData.distanceUnits || ''}` : ""}
                ${(typeof this.apiData.hours === 'number' && typeof this.apiData.minutes === 'number') ? ` / <span class="value">${this.apiData.hours}</span>h <span class="value">${this.apiData.minutes}</span>m` : ""}
                ${(this.apiData.formattedPace) ? ` / <span class="pace value">${this.apiData.formattedPace}</span> /${this.apiData.distanceUnits}` : ""}
            </p>
        `;
            wrapper.appendChild(this.infoWrapper);
        }

        // --- Determine if a map should potentially be shown ---
        const shouldAttemptMapDisplay = this.config.showMapIfPresent && this.apiData && this.apiData.polyline && typeof this.apiData.latitude === 'number';

        // --- Handle Map Display or "Not Available" Message ---
        if (this.config.showMapIfPresent) {
            if (shouldAttemptMapDisplay) {
                // Map should be shown or loading
                if (!this.mapWrapper) {
                    this.mapWrapper = document.createElement("div");
                    this.mapWrapper.id = `${this.identifier}_map`;
                    this.mapWrapper.className = "strava-map";
                }
                this.mapWrapper.style.height = this.config.height;
                this.mapWrapper.style.width = this.config.width;
                this.mapWrapper.style.display = 'block';

                if (this.mapsApiLoaded) {
                    this.mapWrapper.innerHTML = ''; // Clear placeholder
                    setTimeout(() => { // Defer initialization slightly
                        if (typeof this.initializeOrUpdateMap === 'function') {
                             this.initializeOrUpdateMap();
                        } else { Log.error(`${this.name} (${this.identifier}): initializeOrUpdateMap method not found!`); }
                    }, 0);
                } else {
                    this.mapWrapper.innerHTML = `<div class="small dimmed map-loading">Loading map...</div>`;
                    if (!this.mapsApiLoading) { this.loadGoogleMapsScript(); }
                }
                wrapper.appendChild(this.mapWrapper);
            } else if (this.apiData && this.apiData.id) {
                // Map data missing for this activity
                if (this.mapWrapper) { // Remove old map wrapper if it exists
                     this.mapWrapper.remove(); this.mapWrapper = null;
                     this.map = null; this.polyline = null;
                }
                const mapMessage = document.createElement("div");
                mapMessage.className = "small dimmed map-message";
                mapMessage.innerHTML = "Map not available for this activity.";
                wrapper.appendChild(mapMessage);
            }
        } else if (this.mapWrapper) { // Maps disabled in config
             this.mapWrapper.remove(); this.mapWrapper = null;
             this.map = null; this.polyline = null;
        }
		return wrapper;
	}, // End of getDom

    // --- Initialize or Update Map ---
    initializeOrUpdateMap () {
        if (typeof google === "undefined" || typeof google.maps === "undefined" || typeof google.maps.geometry === "undefined") {
            Log.warn(`${this.name} (${this.identifier}): initializeOrUpdateMap called but Google Maps not ready yet.`);
			return;
		}
        const mapElementId = `${this.identifier}_map`;
        const mapElement = document.getElementById(mapElementId);
        if (!mapElement) { Log.error(`${this.name} (${this.identifier}): Map container element #${mapElementId} not found!`); return; }

        if (!this.apiData || !this.apiData.polyline || typeof this.apiData.latitude !== 'number' || typeof this.apiData.longitude !== 'number') {
            Log.warn(`${this.name} (${this.identifier}): initializeOrUpdateMap called without valid map data.`);
            mapElement.innerHTML = `<div class="small dimmed">Map data missing.</div>`;
             this.map = null; this.polyline = null;
            return;
        }

        // Log.info(`${this.name} (${this.identifier}): Initializing/Updating map in element #${mapElementId}`); // Optional log
        mapElement.style.display = 'block';
        mapElement.innerHTML = '';

        try {
            const map = new google.maps.Map(mapElement, { // Use local map variable for init
                zoom: this.config.zoom,
                center: { lat: this.apiData.latitude, lng: this.apiData.longitude },
                mapTypeId: this.config.mapTypeId || 'roadmap',
                disableDefaultUI: this.config.disableDefaultUI,
            });
            const decodedPath = google.maps.geometry.encoding.decodePath(this.apiData.polyline);
            if (!decodedPath || decodedPath.length === 0) {
                Log.warn(`${this.name} (${this.identifier}): Decoded polyline path is empty.`);
                mapElement.innerHTML = "<div class='small dimmed'>Error decoding map path.</div>";
                 this.map = null; this.polyline = null;
                return;
            }
            const polyline = new google.maps.Polyline({ // Use local polyline variable for init
                path: decodedPath, geodesic: true,
                strokeColor: this.config.strokeColor || "#FF0000",
                strokeOpacity: this.config.strokeOpacity || 1.0,
                strokeWeight: this.config.strokeWeight || 2,
            });
            polyline.setMap(map);

            const bounds = new google.maps.LatLngBounds();
            decodedPath.forEach((point) => { bounds.extend(point); });
            map.fitBounds(bounds);
            // Log.info(`${this.name} (${this.identifier}): Map bounds adjusted.`); // Optional log

            google.maps.event.addListenerOnce(map, "bounds_changed", () => { map.setZoom(map.getZoom()); });
            google.maps.event.addListenerOnce(map, 'idle', () => { google.maps.event.trigger(map, 'resize'); });

            // Store references on the instance
            this.map = map;
            this.polyline = polyline;

        } catch (error) {
            Log.error(`${this.name} (${this.identifier}): Error initializing Google Map:`, error);
            mapElement.innerHTML = "<div class='small dimmed'>Error loading map.</div>";
            this.map = null; this.polyline = null;
        }
	}, // End of initializeOrUpdateMap

    // --- Socket Notification Handler ---
	socketNotificationReceived (notification, payload) {
        if (!payload || payload.identifier !== this.identifier) { return; }

        // Log.log(`${this.name} (${this.identifier}): Processing notification ${notification}.`); // Optional log

        if (notification === "LOG") { // Keep LOG handling if node_helper uses it
			Log.log(`${this.name} NodeHelper: ${payload.message || payload}`);
		} else if (notification === "ACCESS_TOKEN_ERROR") {
			Log.error(`${this.name} (${this.identifier}): Access Token Error received:`, payload.error || payload);
            this.loading = false; this.error = `Strava Token Error: ${payload.error?.message || JSON.stringify(payload.error || payload)}`;
            this.apiData = null; this.currentActivityId = null; this.updateDom();
		} else if (notification === "STRAVA_FETCH_ERROR") {
			 Log.error(`${this.name} (${this.identifier}): Strava Fetch Error received:`, payload.error || payload);
             this.loading = false; this.error = `Strava API Error: ${payload.error || 'Unknown fetch error'}`;
             this.apiData = null; this.currentActivityId = null; this.updateDom();
		} else if (notification === "STRAVA_DATA_RESULT") {
            // Log.info(`${this.name} (${this.identifier}): Strava data result received.`); // Optional log
            this.loading = false; this.error = null;
            const newActivityData = payload.data;
            // Log only if needed: Log.log(`${this.name} (${this.identifier}): Received apiData object:`, JSON.stringify(newActivityData, null, 2));

            if (!newActivityData || !newActivityData.id) {
                 Log.warn(`${this.name} (${this.identifier}): Received invalid or empty activity data.`, newActivityData);
                 this.apiData = null; this.currentActivityId = null;
            } else if (this.currentActivityId !== null && this.currentActivityId === newActivityData.id) {
                 // Log.info(`${this.name} (${this.identifier}): Received data for same activity ID (${newActivityData.id}). Updating DOM only.`); // Optional log
                 this.apiData = newActivityData; // Update data anyway
            } else {
                 // Log.info(`${this.name} (${this.identifier}): New activity data received (ID: ${newActivityData.id}). Processing.`); // Optional log
                 this.apiData = newActivityData; this.currentActivityId = newActivityData.id;

                 const shouldShowMap = this.config.showMapIfPresent && this.apiData.polyline && typeof this.apiData.latitude === 'number';
                 if (shouldShowMap) {
                     if (this.mapsApiLoaded) {
                          // Log.info(`${this.name} (${this.identifier}): Maps API ready, initializing/updating map.`); // Optional log
                          this.initializeOrUpdateMap();
                     } else if (!this.mapsApiLoading) {
                          Log.info(`${this.name} (${this.identifier}): Maps API not loaded, initiating load.`);
                          this.loadGoogleMapsScript();
                     }
                 } else {
                      // Log.info(`${this.name} (${this.identifier}): No map to display for activity ${this.currentActivityId}.`); // Optional log
                      if (this.map && this.mapWrapper) { this.mapWrapper.innerHTML = ''; this.map = null; this.polyline = null; }
                 }
            }
            this.updateDom();
		}
	}, // End of socketNotificationReceived

    // --- Google Maps Loader ---
    loadGoogleMapsScript () {
        if (this.mapsApiLoading || this.mapsApiLoaded) { return; }
        if (!this.config.googleMapsApiKey) {
            Log.error(`${this.name} (${this.identifier}): Google Maps API key not configured!`);
            this.error = "Missing Google Maps API Key"; this.updateDom(); return;
        }

        Log.info(`${this.name} (${this.identifier}): Initiating load for Google Maps API script.`);
        this.mapsApiLoading = true;

        const safeIdentifier = this.identifier.replace(/-/g, '_');
        const callbackFunctionName = `magicMirrorStravaMapApiLoaded_${safeIdentifier}`;

        window[callbackFunctionName] = () => {
             Log.info(`${this.name} (${this.identifier}): Google Maps API script loaded via callback ${callbackFunctionName}.`);
             this.mapsApiLoaded = true; this.mapsApiLoading = false;

             const shouldShowMap = this.config.showMapIfPresent && this.apiData && this.apiData.polyline;
             if (shouldShowMap) {
                // Log.info(`${this.name} (${this.identifier}): API loaded, initializing/updating map.`); // Optional log
                this.initializeOrUpdateMap();
             }
             this.updateDom();
             // delete window[callbackFunctionName]; // Optional cleanup
        };

        const scriptSrc = `https://maps.googleapis.com/maps/api/js?key=${this.config.googleMapsApiKey}&libraries=geometry&callback=${callbackFunctionName}`;
        const script = document.createElement("script");
        script.id = `googleMapsScript_${this.identifier}`; script.type = "text/javascript"; script.src = scriptSrc; script.async = true; script.defer = true;
        document.body.appendChild(script);
        script.onerror = () => {
            Log.error(`${this.name} (${this.identifier}): Failed to load Google Maps script!`);
            this.mapsApiLoading = false; this.error = "Failed to load Google Maps";
            this.updateDom(); delete window[callbackFunctionName];
        };
    }, // End of loadGoogleMapsScript

    // --- Styles ---
	getStyles () { return ["MMM-Strava-Last-Activity-Map.css"]; }

}); // End of Module.register
