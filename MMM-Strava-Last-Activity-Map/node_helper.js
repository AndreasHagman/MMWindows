/* MagicMirror² Node Helper: MMM-Strava-Last-Activity-Map */
/* Multi-instance support using axios, cleaned-up version */

const path = require("node:path");
const fs = require("node:fs");
const NodeHelper = require("node_helper");
const axios = require("axios");

module.exports = NodeHelper.create({
    // --- Instance Storage ---
    instances: {},

    // --- Standard Methods ---
	start () {
		this.log("Starting node_helper...");
	},

    // --- Initialize or Update Instance Data ---
    initInstance(identifier, config) {
        if (!this.instances[identifier]) {
            const tokenFilename = config.tokenFilename || `strava_access_token_${identifier}.json`;
            const tokenFilePath = path.resolve(__dirname, tokenFilename);
            this.instances[identifier] = {
                config: config, tokenFilePath: tokenFilePath,
                accessToken: null, refreshToken: config.stravaRefreshToken || null, expiresAt: null
            };
            this.log(`Initialized instance ${identifier} with token file ${tokenFilePath}`);
        } else { // Update config on restart
            this.instances[identifier].config = config;
            this.instances[identifier].refreshToken = config.stravaRefreshToken || this.instances[identifier].refreshToken;
            this.instances[identifier].tokenFilePath = path.resolve(__dirname, config.tokenFilename || path.basename(this.instances[identifier].tokenFilePath));
            // this.log(`Refreshed config for instance ${identifier}`); // Optional log
        }
    },

    // --- Socket Notification Handler ---
	socketNotificationReceived (notification, payload) {
        if (!payload || !payload.identifier || !payload.config) {
             this.log(`Received notification "${notification}" without identifier/config. Ignoring.`, "warn");
             return;
        }
        const identifier = payload.identifier;
        this.initInstance(identifier, payload.config); // Ensure instance exists

		if (notification === "GET_STRAVA_DATA") {
            // this.log(`Received ${notification} request for instance ${identifier}`); // Optional log
			this.getStravaData(identifier);
		} else {
            this.log(`Received unhandled notification: ${notification} for ${identifier}`, "warn");
        }
	},

    // --- Fetch Strava Data Orchestration ---
    async getStravaData (identifier) {
        const instance = this.instances[identifier];
        if (!instance) {
             this.log(`Instance ${identifier} not found in getStravaData.`, "error");
             this.sendSocketNotification("STRAVA_FETCH_ERROR", { identifier: identifier, error: "Node helper instance not found." });
             return;
        }
        // this.log(`Getting Strava data for ${identifier}.`); // Optional log

        try {
            const accessToken = await this.getValidAccessToken(identifier);
            if (!accessToken) {
                this.log(`Failed to obtain valid access token for ${identifier}. Cannot fetch activities.`, "error");
                return; // Error/Auth message already sent
            }

            const config = instance.config;
            const lookBackDays = config.lookBackDays || 30;
            const lookAheadDays = config.lookAheadDays || 1;
            const nowSeconds = Math.floor(Date.now() / 1000);
            const afterTimestamp = nowSeconds - (lookBackDays * 24 * 60 * 60);
            const beforeTimestamp = nowSeconds + (lookAheadDays * 24 * 60 * 60);
            const activitiesUrl = `https://www.strava.com/api/v3/athlete/activities?before=${beforeTimestamp}&after=${afterTimestamp}&page=1&per_page=1`;

            // this.log(`Fetching Strava activities for ${identifier} from: ${activitiesUrl}`); // Optional log
            const response = await axios.get(activitiesUrl, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            if (response.data && Array.isArray(response.data)) {
                 if (response.data.length > 0) {
                    const processedData = this.processData(response.data[0], config);
                    // this.log(`Successfully processed activity ID ${processedData.id} for ${identifier}`); // Optional log
                    // Log only essential data being sent:
                    // this.log(`Sending data for ${identifier}: ID ${processedData.id}, Polyline: ${!!processedData.polyline}, Lat: ${processedData.latitude}`);
                    this.sendSocketNotification("STRAVA_DATA_RESULT", { identifier: identifier, data: processedData });
                 } else {
                    this.log(`No activities found within the time range for ${identifier}.`);
                    this.sendSocketNotification("STRAVA_DATA_RESULT", { identifier: identifier, data: null });
                 }
            } else {
                 this.log(`Unexpected Strava API response format for ${identifier}.`, "warn");
                 throw new Error("Unexpected response format from Strava API.");
            }
        } catch (error) {
            this.log(`Error during getStravaData for ${identifier}: ${error.message}`, "error");
            let errorMessage = error.message || "Unknown error";
            let isAuthError = false;
            if (error.response) {
                 errorMessage = `API Error (${error.response.status}): ${error.response.data?.message || error.message}`;
                 if (error.response.status === 401) {
                     isAuthError = true; errorMessage = "Invalid credentials (401). Token may be revoked or expired.";
                     if (instance) { instance.accessToken = null; instance.expiresAt = null; } // Clear bad token
                     this.sendSocketNotification("ACCESS_TOKEN_ERROR", { identifier: identifier, error: errorMessage });
                 } else if (error.response.status === 429) {
                      errorMessage = "Strava API rate limit exceeded (429).";
                      this.sendSocketNotification("STRAVA_FETCH_ERROR", { identifier: identifier, error: errorMessage });
                 } else { this.sendSocketNotification("STRAVA_FETCH_ERROR", { identifier: identifier, error: errorMessage }); }
            } else { this.sendSocketNotification("STRAVA_FETCH_ERROR", { identifier: identifier, error: errorMessage }); }
        }
    }, // End of getStravaData

    // --- Get Valid Access Token ---
    async getValidAccessToken(identifier) {
        const instance = this.instances[identifier];
        if (!instance) return null;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const buffer = 300; // 5 minute buffer

        // 1. Check memory token
        if (instance.accessToken && instance.expiresAt && nowSeconds < (instance.expiresAt - buffer)) {
            // this.log(`Using valid token from memory for ${identifier}.`); // Optional log
            return instance.accessToken;
        }

        // 2. Try loading from file if needed
        if (!instance.accessToken || !instance.expiresAt) { // Load only if not in memory
            // this.log(`No token in memory for ${identifier}. Loading from file: ${instance.tokenFilePath}`); // Optional log
            if (fs.existsSync(instance.tokenFilePath)) {
                try {
                    const fileData = JSON.parse(fs.readFileSync(instance.tokenFilePath));
                    if (fileData.access_token && fileData.refresh_token && fileData.expires_at) {
                         instance.accessToken = fileData.access_token;
                         instance.refreshToken = fileData.refresh_token;
                         instance.expiresAt = fileData.expires_at;
                         // Re-check expiration after loading
                         if (nowSeconds < (instance.expiresAt - buffer)) {
                             this.log(`Token loaded from file is valid for ${identifier}.`);
                             return instance.accessToken;
                         } else {
                              this.log(`Token loaded from file is expired for ${identifier}.`);
                         }
                    } else { this.log(`Token file for ${identifier} missing required fields.`, "warn"); }
                } catch (err) { this.log(`Error reading/parsing token file ${instance.tokenFilePath} for ${identifier}: ${err}`, "error"); }
            } else { /* this.log(`Token file not found for ${identifier}.`); */ } // Optional log
        }

        // 3. If still no valid token (memory/file expired or missing), refresh
        this.log(`Attempting token refresh for ${identifier}.`);
        const refreshedTokenData = await this.refreshAccessToken(identifier);
        return refreshedTokenData ? refreshedTokenData.access_token : null;
    },

    // --- Refresh Access Token ---
	async refreshAccessToken (identifier) {
        const instance = this.instances[identifier];
        if (!instance) { this.log(`refreshAccessToken: Instance ${identifier} not found.`, "error"); return null; }
		const config = instance.config;
        if (!config.stravaClientId || !config.stravaClientSecret) {
             this.log(`Cannot refresh token for ${identifier}: Client ID/Secret missing.`, "error");
             this.sendSocketNotification("ACCESS_TOKEN_ERROR", { identifier: identifier, error: "Client ID/Secret missing" }); return null;
        }
         if (!instance.refreshToken) {
             this.log(`Cannot refresh token for ${identifier}: No refresh token available.`, "error");
             this.sendSocketNotification("ACCESS_TOKEN_ERROR", { identifier: identifier, error: "Refresh token missing" }); return null;
         }

		try {
             const url = `https://www.strava.com/oauth/token`;
             // this.log(`Attempting token refresh for ${identifier}...`); // Optional log
			 const response = await axios.post(url, null, { params: {
                     client_id: config.stravaClientId, client_secret: config.stravaClientSecret,
                     refresh_token: instance.refreshToken, grant_type: "refresh_token"
                 }});
             if (!response.data?.access_token || !response.data?.refresh_token || !response.data?.expires_at) {
                 throw new Error("Incomplete token data received from Strava.");
             }
             const newTokenData = response.data;
			 this.log(`Token refresh successful for ${identifier}.`); // Keep success log
             instance.accessToken = newTokenData.access_token;
             instance.refreshToken = newTokenData.refresh_token;
             instance.expiresAt = newTokenData.expires_at;
             this.saveTokensToFile(identifier, newTokenData);
             return newTokenData;
		} catch (error) {
             this.log(`Error refreshing access token for ${identifier}: ${error.message}`, "error");
             if (instance) { instance.accessToken = null; instance.expiresAt = null; } // Clear state
             let errorMessage = error.message || "Failed to refresh token";
             if (error.response) {
                 errorMessage = `Token Refresh Error (${error.response.status}): ${error.response.data?.message || error.message}`;
                 if (error.response.status === 400 || error.response.status === 401) {
                     errorMessage = "Invalid refresh token (400/401). Re-authentication may be required.";
                     this.sendSocketNotification("ACCESS_TOKEN_ERROR", { identifier: identifier, error: errorMessage });
                 } else { this.sendSocketNotification("ACCESS_TOKEN_ERROR", { identifier: identifier, error: errorMessage }); }
             } else { this.sendSocketNotification("ACCESS_TOKEN_ERROR", { identifier: identifier, error: errorMessage }); }
             return null;
		}
	}, // End of refreshAccessToken

    // --- Save Tokens to File ---
    saveTokensToFile(identifier, tokenData) {
        const instance = this.instances[identifier];
        if (!instance || !instance.tokenFilePath) { this.log(`Cannot save tokens: Instance ${identifier} missing.`, "warn"); return; }
        if (!tokenData?.access_token || !tokenData?.refresh_token || !tokenData?.expires_at) {
            this.log(`Attempted to save invalid tokens for ${identifier}. Aborting.`, "warn"); return;
        }
        try {
            fs.writeFileSync(instance.tokenFilePath, JSON.stringify(tokenData, null, 2));
            this.log(`Tokens saved successfully to ${path.basename(instance.tokenFilePath)} for ${identifier}.`); // Keep success log
        } catch (error) { this.log(`Error writing token file ${instance.tokenFilePath} for ${identifier}: ${error}`, "error"); }
    },

    // --- Process Activity Data ---
    processData (activity, config) { // Process a SINGLE activity object
        const unitsConfig = config.units || "metric";
        let name = null, 
        activityDate = null, 
        distance = null, 
        distanceUnits = "", 
        minutes = null, 
        hours = null,
        latitude = null, 
        longitude = null, 
        polyline = null, 
        formattedPace = null, 
        activityId = null, 
        formattedTime = null;

        if (!activity || typeof activity !== 'object') return {}; // Return empty for invalid input

        // this.log(`Processing activity: ${activity.name || 'Unnamed'} (ID: ${activity.id})`); // Optional log

        activityId = activity.id || null;
        name = activity.name || "Unnamed Activity";
        activityDate = activity.start_date_local || activity.start_date || null;

        // Distance
        let distanceInMeters = 0;
        if (typeof activity.distance === 'number') {
            distanceInMeters = activity.distance;
            if (unitsConfig === "imperial") {
                distance = (distanceInMeters * 0.000621371).toFixed(1); distanceUnits = "mi";
            } else { distance = (distanceInMeters / 1000).toFixed(1); distanceUnits = "km"; }
        }

        // Time
        let movingTimeInSeconds = 0;
        if (typeof activity.moving_time === 'number') {
            movingTimeInSeconds = activity.moving_time;
            const totalMinutes = Math.floor(movingTimeInSeconds / 60);
            minutes = totalMinutes % 60; 
            hours = Math.floor(totalMinutes / 60);
            if (hours > 0) { formattedTime = `${hours}h ${minutes}m`; }
            else if (minutes > 0) { formattedTime = `${minutes}m`; }
            else if (movingTimeInSeconds > 0) { formattedTime = `${movingTimeInSeconds}s`; }
        }

        // Pace
        if (distanceInMeters > 0 && movingTimeInSeconds > 0) {
            let paceMinPerUnit = (unitsConfig === "imperial")
                ? (movingTimeInSeconds / 60) / (distanceInMeters * 0.000621371)
                : (movingTimeInSeconds / 60) / (distanceInMeters / 1000);
            const paceMinutes = Math.floor(paceMinPerUnit);
            const paceSeconds = Math.round((paceMinPerUnit - paceMinutes) * 60);
            formattedPace = `${paceMinutes}:${String(paceSeconds).padStart(2, '0')}`;
        }

        // Map Data
        latitude = activity.start_latlng?.[0] ?? null;
        longitude = activity.start_latlng?.[1] ?? null;
        polyline = activity.map?.summary_polyline ?? null;

        return {
            id: activityId, 
            name: name, 
            activityDate: activityDate,
            distance: distance, 
            distanceUnits: distanceUnits,
            minutes: minutes,
            hours: hours,
            formattedTime: formattedTime, // Use formatted time
            latitude: latitude, 
            longitude: longitude,
            polyline: polyline,
            formattedPace: formattedPace,
        };
    }, // End of processData

    // --- Logging Helper ---
    log: function(message, type = "log") {
        const prefix = `MMM-Strava-LAM NodeHelper:`; // Simpler prefix
        switch(type) {
            case "error": console.error(`${prefix} ERROR: ${message}`); break;
            case "warn": console.warn(`${prefix} WARN: ${message}`); break;
            // Keep info logs minimal or remove if not needed
            // case "info": console.info(`${prefix} INFO: ${message}`); break;
            default: console.log(`${prefix} ${message}`);
        }
    }

}); // End of module.exports
