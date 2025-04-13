const path = require("node:path");
const fs = require("node:fs");
const { Console } = require("node:console");
const NodeHelper = require("node_helper");
const axios = require("axios");
const Log = require("logger");

module.exports = NodeHelper.create({
	accessTokenData: {},

	start () {
		console.log(`Starting node_helper for: ${this.name}`);

		setInterval(() => {
			const memoryUsage = process.memoryUsage();
			this.sendSocketNotification("LOG", `meory usage: ${JSON.stringify(memoryUsage)}`);
		}, 10000);
	},

	async getAccessToken (payload) {
		try {
			const url = `${payload.tokenUrl}client_id=${payload.clientId}&client_secret=${payload.clientSecret}&refresh_token=${payload.refreshToken}&grant_type=refresh_token`;
			const response = await axios.post(url);
			const filePath = path.join(__dirname, "..", "strava_access_token.json");

			try {
				fs.writeFileSync(filePath, JSON.stringify(response.data));
			} catch (error) {
				this.sendSocketNotification(
					"LOG",
					`Error writing to file access_token.json: ${error}`
				);
			}

			this.accessTokenData = response.data;
		} catch (error) {
			this.sendSocketNotification(
				"LOG",
				`Error fetching access token from API: ${error}`
			);
			this.sendSocketNotification("ACCESS_TOKEN_ERROR", error);
		}
	},

// In node_helper.js

processData (data) {
    let name = null,
        activityDate = null,
        distance = null, // Initialize as null
        minutes = null,
        hours = null,
        latitude = null,
        longitude = null,
        summaryPolyLine = null;
        formattedPace = null;
        activityId = null;

    if (Array.isArray(data) && data.length > 0) {
        this.sendSocketNotification("LOG", `Processing activity data. Count: ${data.length}`);
        const activity = data[0];

        // --- Extract ID inside the block where activity is defined ---
        activityId = activity.id || null; // Assign the ID if activity exists


        // Basic Info
        name = activity.name;
        const date = new Date(activity.start_date);
        const month = String(date.getUTCMonth() + 1).padStart(2, "0");
        const day = String(date.getUTCDate()).padStart(2, "0");
        const year = date.getUTCFullYear();
        activityDate = `${month}/${day}/${year}`;

        // --- CORRECTED Distance Calculation ---
        // Declare distanceInMeters here with a default value
        let distanceInMeters = 0;
        if (typeof activity.distance === 'number') {
            distanceInMeters = activity.distance; // Assign the actual value
            distance = (distanceInMeters / 1000).toFixed(1); // Formatted km string for display
        } else {
             this.sendSocketNotification("LOG", `Notice: Activity '${activity.name}' lacks distance data.`);
        }
        // --- End Distance Calculation ---


        // --- CORRECTED Time Calculation ---
        // Declare movingTimeInSeconds here with a default value
        let movingTimeInSeconds = 0;
        if (typeof activity.moving_time === 'number') {
            movingTimeInSeconds = activity.moving_time; // Assign the actual value
            const totalMinutes = Math.floor(movingTimeInSeconds / 60);
            minutes = totalMinutes % 60; // Assign to outer scope variable
            hours = Math.floor(totalMinutes / 60);   // Assign to outer scope variable
        } else {
             this.sendSocketNotification("LOG", `Notice: Activity '${activity.name}' lacks moving time data.`);
        }
        // --- End Time Calculation ---

        // --- Pace Calculation (Time per Kilometer) ---
        // Check if we have valid distance and time, and if it's a relevant sport type (like Walk, Run)
        const isPaceRelevant = ['Run', 'Walk', 'Hike'].includes(activity.type);
        if (isPaceRelevant && distanceInMeters > 0 && movingTimeInSeconds > 0) {
            const distanceInKm = distanceInMeters / 1000;
            const paceInSecondsPerKm = movingTimeInSeconds / distanceInKm;
            const paceMinutes = Math.floor(paceInSecondsPerKm / 60);
            const paceSeconds = Math.round(paceInSecondsPerKm % 60);
            const formattedSeconds = String(paceSeconds).padStart(2, '0');
            formattedPace = `${paceMinutes}:${formattedSeconds}`;
            this.sendSocketNotification("LOG", `Calculated Pace: ${formattedPace}`);
        } else if (distanceInMeters <= 0 || movingTimeInSeconds <= 0) {
             this.sendSocketNotification("LOG", "Could not calculate pace due to zero distance or time.");
        } else {
             this.sendSocketNotification("LOG", `Pace calculation not relevant for activity type: ${activity.type}`);
        }
        // --- End Pace Calculation ---

        // --- Map Data Handling ---
        // (Keep the existing logic for latitude, longitude, summaryPolyLine here)
        this.sendSocketNotification("LOG", `Raw activity start_latlng: ${JSON.stringify(activity.start_latlng)}`);
        this.sendSocketNotification("LOG", `Raw activity map data: ${JSON.stringify(activity.map)}`);
        if (activity.start_latlng && activity.start_latlng.length >= 2 &&
            typeof activity.start_latlng[0] === 'number' && typeof activity.start_latlng[1] === 'number') {
            latitude = activity.start_latlng[0];
            longitude = activity.start_latlng[1];
        } else {
             this.sendSocketNotification("LOG", `Notice: Activity '${activity.name}' lacks valid start coordinates.`);
        }
        if (activity.map && activity.map.summary_polyline) {
            summaryPolyLine = activity.map.summary_polyline;
        } else {
             this.sendSocketNotification("LOG", `Notice: Activity '${activity.name}' lacks summary polyline.`);
        }
        // --- End Map Data Handling ---

        this.sendSocketNotification("LOG", `Processed Distance (km): ${distance}, Lat: ${latitude}, Lng: ${longitude}, Polyline Exists: ${!!summaryPolyLine}`);

    } else {
         this.sendSocketNotification("LOG", "Warning: Received empty data array from Strava API.");
    }

    // Return the processed data object
    return {
        id: activityId,
        name,
        activityDate,
        distance, // This now holds the distance in km (as a string from toFixed)
        minutes,
        hours,
        latitude,
        longitude,
        summaryPolyLine,
        formattedPace
    };
},

// In node_helper.js

async getStravaData (payload) {
    const filePath = path.join(__dirname, "..", "strava_access_token.json");

    try {
        let justRefreshedToken = false; // Flag to know if we just got a token
        let localAccessTokenData; // <<< Declare localAccessTokenData here, outside the 'if' block

        if (fs.existsSync(filePath)) {
            try {
                 const localAccessTokenFileData = await fs.promises.readFile(filePath);
                 localAccessTokenData = JSON.parse(localAccessTokenFileData); // Assign value here

                 if (
                    localAccessTokenData && // Check if parsing succeeded
                    localAccessTokenData.access_token &&
                    localAccessTokenData.expires_at > Math.floor(Date.now() / 1000)
                 ) {
                    // Token exists and is valid
                    this.sendSocketNotification("LOG", "Using existing valid token from file.");
                    this.accessTokenData = localAccessTokenData;
                 } else {
                    // Token exists but is expired or invalid
                    this.sendSocketNotification("LOG", "Local token expired or invalid, fetching new one.");
                    // Ensure we have a refresh token to use
                    const refreshToken = localAccessTokenData ? localAccessTokenData.refresh_token : payload.refreshToken;
                    if (!refreshToken) {
                        throw new Error("No refresh token available in file or config to refresh expired token.");
                    }
                    await this.getAccessToken({
                        ...payload, // Pass client ID, secret, token URL etc.
                        refreshToken: refreshToken // Use token from file (preferred) or config
                    });
                    justRefreshedToken = true; // Mark that we just refreshed
                 }
            } catch (fileError) {
                 // Error reading or parsing the JSON file, treat as if file doesn't exist
                 this.sendSocketNotification("LOG", `Error reading/parsing token file: ${fileError}. Fetching new token.`);
                 // Fall back to using the initial refresh token from config
                 await this.getAccessToken(payload);
                 justRefreshedToken = true;
            }

        } else {
            // File doesn't exist, fetch initial token
            this.sendSocketNotification("LOG", "Token file not found, fetching initial token.");
            await this.getAccessToken(payload); // Uses payload.refreshToken from config
            justRefreshedToken = true; // Mark that we just refreshed
        }

        // *** ADDED DELAY: Wait a bit if we just interacted with the token API ***
        if (justRefreshedToken) {
            this.sendSocketNotification("LOG", "Token was just obtained/refreshed. Waiting before fetching data...");
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
            this.sendSocketNotification("LOG", "Proceeding to fetch Strava data after delay.");
        }
        // *** END DELAY ***


        // Check if accessTokenData is populated after potentially refreshing
        // this.accessTokenData should have been set either by using existing token or by getAccessToken()
        if (!this.accessTokenData || !this.accessTokenData.access_token) {
             // This should ideally not happen if getAccessToken worked, but good failsafe
             throw new Error("Failed to obtain a valid access token after check/refresh.");
        }

        // Construct the activities URL (ensure payload.url and other params are correct)
         const beforeTimestamp = payload.before || Math.floor(Date.now() / 1000);
         const afterTimestamp = payload.after || Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000); // Default to last 30 days if 'after' not provided
         const activitiesUrl = `${payload.url}athlete/activities?before=${beforeTimestamp}&after=${afterTimestamp}&per_page=1`; // Fetch only 1 activity

        this.sendSocketNotification("LOG", `Fetching Strava activities from: ${activitiesUrl}`);
        const response = await axios.get(activitiesUrl, {
            headers: {
                Authorization: `Bearer ${this.accessTokenData.access_token}`
            }
        });

        // --- ADD THIS LOGGING LINE ---
        this.sendSocketNotification("LOG", `Raw Strava API Response Data:\n${JSON.stringify(response.data, null, 2)}`);
        // --- END OF ADDED LINE ---

        const processedData = this.processData(response.data);
        this.sendSocketNotification("STRAVA_DATA_RESULT", processedData);

    } catch (error) {
       // --- Keep the improved catch block ---
        if (error.response && error.response.status === 401) {
            // Unauthorized error, likely token became invalid between check and use, or initial check failed subtly.
            this.sendSocketNotification(
                "LOG",
                "Access token invalid (401 received on data fetch), attempting refresh."
            );
            try {
                let refreshTokenToUse = payload.refreshToken; // Start with config refresh token

                // Try reading the token file again *here* to get the latest refresh token if available
                if (fs.existsSync(filePath)) {
                    try {
                        const localFileData = await fs.promises.readFile(filePath);
                        const fileData = JSON.parse(localFileData); // Use different variable name 'fileData'
                        if (fileData && fileData.refresh_token) {
                            refreshTokenToUse = fileData.refresh_token; // Prefer token from file
                            this.sendSocketNotification("LOG", "Using refresh token from existing file for 401 recovery.");
                        }
                    } catch (readError) {
                        this.sendSocketNotification("LOG", `Error reading token file during 401 recovery: ${readError}. Using config refresh token.`);
                    }
                }

                if (!refreshTokenToUse) {
                     throw new Error("No refresh token available (checked file and config) for 401 recovery.");
                }

                // Call getAccessToken to refresh
                await this.getAccessToken({
                     ...payload, // Pass necessary config like clientId, clientSecret, tokenUrl
                     refreshToken: refreshTokenToUse
                 });

                // If refresh succeeds, accessTokenData is updated internally by getAccessToken
                this.sendSocketNotification("LOG", "Token refreshed after 401. Waiting before retrying data fetch...");
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds after refresh

                this.sendSocketNotification("LOG", "Retrying fetching Strava data after 401 & delay.");
                // IMPORTANT: Re-call getStravaData to retry the *entire* process cleanly
                // Avoids potential state issues of trying to resume mid-function
                // Ensure this doesn't cause an infinite loop if refresh keeps failing -> getAccessToken should throw or handle this
                 this.getStravaData(payload); // Re-trigger the fetch

            } catch (tokenError) {
                 // This catches errors during the getAccessToken call within the 401 handler
                 this.sendSocketNotification("LOG", `Failed to refresh token after 401 or subsequent retry failed: ${tokenError}`);
                 this.sendSocketNotification("ACCESS_TOKEN_ERROR", `Failed to recover from 401: ${tokenError.message || tokenError}`);
            }
        } else if (error.response && error.response.status === 429) {
            // Rate limit hit
            this.sendSocketNotification("LOG",`Strava API rate limit hit (429). Increase updateInterval in config.js. Error: ${error}`);
            // Send an error to the frontend module?
            this.sendSocketNotification("STRAVA_FETCH_ERROR", "Rate limit hit (429). Will retry on next update cycle.");
        } else {
            // Handle other errors (network errors, processing errors, etc.)
           this.sendSocketNotification(
                "LOG",
                `Error fetching/processing Strava data: ${error}`
            );
             // Send a generic error to the frontend module display
             this.sendSocketNotification("STRAVA_FETCH_ERROR", `API/Processing Error: ${error.message || error}`);
        }
    }
},

// Make sure the rest of your node_helper methods (start, getAccessToken, processData, socketNotificationReceived) remain as they were.

	socketNotificationReceived (notification, payload) {
		if (notification === "GET_STRAVA_DATA") {
			this.getStravaData(payload);
		}
	}
});
