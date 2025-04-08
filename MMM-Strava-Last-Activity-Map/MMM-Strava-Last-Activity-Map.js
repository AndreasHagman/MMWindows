/* MagicMirror²
 * Module: MMM-Strava-Last-Activity-Map
 *
 * By Tyler Stambaugh
 */

/* global google */
/* MagicMirror²
 * Module: MMM-Strava-Last-Activity-Map
 *
 * By Tyler Stambaugh
 * Modified for conditional map display
 */

/* global google */

Module.register("MMM-Strava-Last-Activity-Map", {
	// --- Existing variables ---
	baseUrl: "https://www.strava.com/api/v3/",
	tokenUrl: "https://www.strava.com/oauth/token?",
	accessTokenError: {},
	apiData: null, // Initialize as null to better check if data has arrived
	loading: true,
    mapsApiLoaded: false, // Flag to track Google Maps script loading

	// --- Existing config defaults ---
	defaults: {
		zoom: 10,
		mapTypeId: "roadmap",
		styledMapType: "standard", // Note: 'styles' property expects an array, not a string name
		disableDefaultUI: true,
		header: "Last Activity on Strava",
		initialLoadDelay: 2500,
		retryDelay: 2500,
		updateInterval: 60 * 10 * 1000, // Increased default interval slightly
		width: "250px",
		height: "250px",
		googleMapsApiKey: "" // Make sure API Key is set in config.js
	},

	// --- Existing init/getHeader ---
	init () {},
	getHeader () {
		return this.config.header || "Strava Last Activity Map";
	},

	// --- Existing start ---
	start () {
		Log.info(`Starting module: ${this.name}`);
		// No need to log start message here, node_helper does it.

		this.apiData = null; // Reset data
		this.loading = true;
        this.mapsApiLoaded = false; // Reset flag on start
		this.scheduleUpdate(this.config.initialLoadDelay); // Use initial delay for first fetch
	},

	// --- Modified scheduleUpdate to avoid multiple intervals ---
	scheduleUpdate (delay) {
        // Clear any existing interval first
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }

		// Set timeout for the first execution if delay is provided
        if (typeof delay !== "undefined" && delay >= 0) {
            setTimeout(() => {
                this.getApiData();
                 // Then set the regular interval after the first delayed execution
                 this.updateTimer = setInterval(() => {
                    this.getApiData();
                 }, this.config.updateInterval);
            }, delay);
        } else {
             // If no delay, fetch immediately and set interval
             this.getApiData();
             this.updateTimer = setInterval(() => {
                 this.getApiData();
             }, this.config.updateInterval);
        }
	},

	notificationReceived () {}, // Keep empty unless needed

    // --- Modified getDom for conditional map display ---
	getDom () {
		var wrapper = document.createElement("div");
		wrapper.className = "wrapper"; // Consider adding this.identifier for uniqueness

		if (this.loading) {
			var loadingMessage = document.createElement("div");
			loadingMessage.className = "loading dimmed small"; // Added classes
			loadingMessage.innerHTML = "Loading Activity Data...";
			wrapper.appendChild(loadingMessage);
            return wrapper; // Return early if still loading
		}

        // --- Handle Access Token Errors ---
		if (this.accessTokenError && Object.keys(this.accessTokenError).length > 0) {
			var errorWrapper = document.createElement("div");
			errorWrapper.className = "small bright error"; // Added class
			errorWrapper.innerHTML = `Strava API Token Error: ${JSON.stringify(this.accessTokenError)}`;
			wrapper.appendChild(errorWrapper);
            return wrapper; // Return early on token error
		}

        // --- Handle case where data fetch failed or returned no activity ---
        if (!this.apiData || !this.apiData.name) { // Check if apiData is null or lacks essential info
             var noDataMessage = document.createElement("div");
             noDataMessage.className = "dimmed small no-activity"; // Added classes
             noDataMessage.innerHTML = "No recent activity data found.";
             wrapper.appendChild(noDataMessage);
             return wrapper; // Return early if no valid data
        }

        // --- Display Activity Details (Always shown if data is valid) ---
		var detailsWrapper = document.createElement("div");
		detailsWrapper.className = "small bright activityDetails";
		// Use checks to avoid displaying "null" or "undefined"
        detailsWrapper.innerHTML = `
            ${this.apiData.name ? `<p class="name">${this.apiData.name}</p>` : ""}
            ${this.apiData.activityDate ? `<p class="date value">${this.apiData.activityDate}</p>` : ""}
        `;
		wrapper.appendChild(detailsWrapper);

        // --- Conditionally Display Map or "Map Not Available" ---
        // Check if summaryPolyLine exists and is not empty
        if (this.apiData.summaryPolyLine) {
            // Polyline exists, attempt to show map

            // Check if Google Maps API script has loaded
            if (this.mapsApiLoaded) {
                var mapContainerWrapper = document.createElement("div");
                mapContainerWrapper.className = "map-container-wrapper";

                var mapContainer = document.createElement("div");
                mapContainer.className = "map";
                // Use identifier to make ID unique if multiple instances exist
                mapContainer.setAttribute("id", this.identifier + "_map");
                mapContainer.style.height = `${this.config.height}`;
                mapContainer.style.width = `${this.config.width}`;

                mapContainerWrapper.appendChild(mapContainer);
                wrapper.appendChild(mapContainerWrapper);

                 // Call initializeMap *only* if the API is loaded and element exists
                 // Use a slight delay to ensure DOM element is ready after updateDom
                 setTimeout(() => this.initializeMap(), 0);

            } else {
                // API Script hasn't loaded yet, show a placeholder message
                var mapLoadingMessage = document.createElement("div");
                mapLoadingMessage.className = "small dimmed map-loading";
                mapLoadingMessage.innerHTML = "Loading map...";
                wrapper.appendChild(mapLoadingMessage);
                // Script loading is triggered in socketNotificationReceived
            }

        } else {
            // No polyline data, show "Map not available" message
            var mapMessageWrapper = document.createElement("div");
            mapMessageWrapper.className = "small dimmed map-message"; // Add classes
            mapMessageWrapper.innerHTML = "Map not available for this activity.";
            wrapper.appendChild(mapMessageWrapper);
        }

        // --- Display Distance/Time Details (Always shown if data is valid) ---
		var detailsWrapper2 = document.createElement("div");
		detailsWrapper2.className = "small bright activityDetails";
		// Add checks for numeric values/existence to avoid displaying "NaN" or "null"
        detailsWrapper2.innerHTML = `
             <p>
                ${(this.apiData.distance !== null && this.apiData.distance !== undefined) ? `<span class="value">${this.apiData.distance}</span> km` : ""}
                ${(typeof this.apiData.hours === 'number' && typeof this.apiData.minutes === 'number') ? ` / <span class="value">${this.apiData.hours}</span>h <span class="value">${this.apiData.minutes}</span>m` : ""}
             </p>
        `;
		wrapper.appendChild(detailsWrapper2);

		return wrapper;
	}, // End of getDom function

    // --- Modified initializeMap to use unique ID and check google object ---
	initializeMap () {
        // Double check if Google object is ready
		if (typeof google === "undefined" || typeof google.maps === "undefined" || typeof google.maps.geometry === "undefined") {
            Log.warn(this.name + ": initializeMap called but Google Maps or geometry library not ready yet.");
            // Don't use setTimeout loop here, rely on callback mechanism
			return;
		}

        const mapElementId = this.identifier + "_map";
        const mapElement = document.getElementById(mapElementId);

        // Check if the map element exists in the DOM
        if (!mapElement) {
             Log.error(this.name + `: Map container element #${mapElementId} not found! Cannot initialize map.`);
             return;
        }

        // Check if required data exists (should be guaranteed by getDom logic, but good practice)
        if (!this.apiData || !this.apiData.summaryPolyLine || typeof this.apiData.latitude !== 'number' || typeof this.apiData.longitude !== 'number') {
            Log.error(this.name + ": initializeMap called without valid data (lat/lng/polyline).");
            return;
        }

        Log.info(this.name + ": Initializing map in element #" + mapElementId);

        try {
            const map = new google.maps.Map(mapElement, {
                zoom: this.config.zoom,
                center: { lat: this.apiData.latitude, lng: this.apiData.longitude },
                mapTypeId: this.config.mapTypeId,
                // styles: this.styledMapType, // This needs an array of styles, not just a name like 'standard'
                disableDefaultUI: this.config.disableDefaultUI,
                // backgroundColor: this.config.backgroundColor // Not a standard MapOption, remove or handle differently
            });

            // Use google.maps.geometry.encoding.decodePath
            const decodedPath = google.maps.geometry.encoding.decodePath(this.apiData.summaryPolyLine);

            if (!decodedPath || decodedPath.length === 0) {
                Log.warn(this.name + ": Decoded polyline path is empty.");
                mapElement.innerHTML = "Error decoding map path."; // Show error inside map div
                return;
            }

            const polyline = new google.maps.Polyline({
                path: decodedPath,
                geodesic: true,
                strokeColor: "#FF0000", // Example color
                strokeOpacity: 1.0,
                strokeWeight: 2
            });
            polyline.setMap(map);

            const bounds = new google.maps.LatLngBounds();
            decodedPath.forEach((point) => {
                bounds.extend(point); // Use the LatLng objects directly
            });

            map.fitBounds(bounds);

            // Optional: Adjust zoom slightly after fitBounds if needed
            google.maps.event.addListenerOnce(map, "bounds_changed", () => {
                if (map.getZoom() > 15) { // Example: Don't zoom in too much
                    map.setZoom(15);
                }
            });
        } catch (error) {
            Log.error(this.name + ": Error initializing Google Map:", error);
            mapElement.innerHTML = "Error loading map."; // Show error inside map div
        }
	},

	// --- Removed decodePolyline - Use google.maps.geometry.encoding.decodePath ---
    // decodePolyline() is no longer needed as google maps api provides this

	// --- Existing getApiData ---
	getApiData () {
        // Clear previous error before fetching
        this.accessTokenError = {};

		let payload = {
			url: this.baseUrl,
			tokenUrl: this.tokenUrl,
			clientId: this.config.stravaClientId,
			clientSecret: this.config.stravaClientSecret,
			refreshToken: this.config.stravaRefreshToken,
			// --- Use node_helper defaults for before/after unless specified in config ---
            // after: Math.floor(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).getTime() / 1000), // Example: 10 days ago
			// before: Math.floor(Date.now() / 1000) // Example: Now
            // Let node_helper handle defaults unless overridden in config.js
            before: this.config.activityBefore,
            after: this.config.activityAfter,
		};
		this.sendSocketNotification("GET_STRAVA_DATA", payload);
	},

    // --- Modified socketNotificationReceived ---
	socketNotificationReceived (notification, payload) {
		if (notification === "LOG") {
			Log.log(this.name + " NodeHelper:", payload); // Use Log.log or Log.info
		}
		if (notification === "ACCESS_TOKEN_ERROR") {
			Log.error(this.name + ": Access Token Error received:", payload);
			this.accessTokenError = payload;
            this.loading = false; // Stop loading on error
			this.updateDom();
		}
        if (notification === "STRAVA_FETCH_ERROR") {
             Log.error(this.name + ": Strava Fetch Error received:", payload);
             // Could display this error in getDom similar to accessTokenError
             this.apiData = { error: payload }; // Store error state
             this.loading = false;
             this.updateDom();
        }
		if (notification === "STRAVA_DATA_RESULT") {
            Log.info(this.name + ": Strava data received.");
            this.apiData = payload; // Store the received data (could be null/empty)
            this.loading = false; // Data fetch attempt complete
            this.accessTokenError = {}; // Clear any previous token error on successful fetch

			// --- Conditionally load Google Maps script ---
            // Only load if polyline exists AND the script hasn't been loaded yet
            if (this.apiData && this.apiData.summaryPolyLine && !this.mapsApiLoaded) {
                 this.loadGoogleMapsScript();
            }

			this.updateDom(); // Update display with new data/state
		}
	},

    // In MMM-Strava-Last-Activity-Map.js

// In MMM-Strava-Last-Activity-Map.js

// --- Modified loadGoogleMapsScript with SIMPLIFIED callback name ---
loadGoogleMapsScript () {
    if (this.config.googleMapsApiKey === "") {
        Log.error(`${this.name}: Google Maps API key not set!`);
        return; // Don't proceed if key is missing
    }

    const scriptId = "googleMapsScript_" + this.identifier; // Keep ID for checking if exists
    if (this.mapsApiLoaded || document.getElementById(scriptId)) {
        return;
    }

    Log.info(`${this.name}: Loading Google Maps API script.`);

    // --- Define a SIMPLE, STATIC callback function name ---
    const staticCallbackName = "MMMStravaMapsApiLoadedCallback"; // Simple static name
    window[staticCallbackName] = () => {
        Log.info(`${this.name}: Google Maps API script loaded successfully via callback: ${staticCallbackName}`);
        // *** Important: We need 'this' to refer to the Module instance ***
        // We need to find the correct module instance inside the global callback
        // This is tricky. A common pattern is to store instances.
        // Let's try a simpler approach first - assume 'this' somehow works (might not)
        // A better way is needed if 'this' is undefined here.
        // For now, let's see if the ReferenceError goes away.
        try {
            this.mapsApiLoaded = true;
             // Update the DOM now that the API is ready, which might trigger map initialization
             setTimeout(() => this.updateDom(), 0);
        } catch(e) {
             // Log an error if 'this' is not the module instance here
             console.error("ERROR: 'this' context lost in Google Maps callback for " + this.name + ". Map might not load.", e);
             // You might need to find the module instance differently, e.g., through MM.getModules()
             // Example (may need adjustment based on MM version):
             /*
             const moduleInstance = MM.getModules().find(m => m.identifier === this.identifier); // Requires this.identifier to be accessible, which it might not be here
             if (moduleInstance) {
                 moduleInstance.mapsApiLoaded = true;
                 setTimeout(() => moduleInstance.updateDom(), 0);
             } else {
                  console.error("Could not find module instance in callback for " + this.identifier);
             }
             */
        }
    };
     // Log right after definition to see if it exists on window
     Log.info(`Callback ${staticCallbackName} defined on window: ${typeof window[staticCallbackName]}`);
    // --- END Define the callback function FIRST ---

    // --- Now create and append the script tag ---
    const googleMapsScript = document.createElement("script");
    googleMapsScript.id = scriptId;
    googleMapsScript.type = "text/javascript";
    // Use the STATIC callback name in the URL
    googleMapsScript.src = `https://maps.googleapis.com/maps/api/js?key=${this.config.googleMapsApiKey}&libraries=geometry&callback=${staticCallbackName}`;
    googleMapsScript.async = true; // Use async, defer less critical here
    // googleMapsScript.defer = true; // Remove defer for simplicity

    document.head.appendChild(googleMapsScript);

    googleMapsScript.onerror = () => {
        Log.error(`${this.name}: Failed to load Google Maps script! Check API key, network, and browser console.`);
        delete window[staticCallbackName]; // Clean up failed callback
    };
    // --- END Now create and append the script tag ---
},

    // --- Existing getStyles ---
	getStyles () {
		return ["MMM-Strava-Last-Activity-Map.css"];
	}
});