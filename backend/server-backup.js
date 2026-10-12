const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(cors());

/*
    GLOBAL AIRCRAFT REGIONS

    Each region is:
    [latitude, longitude]

    ADS-B.fi allows a maximum radius of 250 NM.
*/
const REGIONS = [
    // North America
    [55, -125], [55, -100], [55, -75],
    [40, -125], [40, -100], [40, -75],
    [25, -115], [25, -95], [25, -75],

    // South America
    [10, -75], [0, -60],
    [-15, -75], [-15, -50],
    [-30, -70], [-30, -50],

    // Europe
    [60, 0], [55, 10], [50, -5],
    [50, 15], [45, 25], [40, 0],
    [40, 20], [40, 40],

    // Africa
    [30, 0], [15, 0], [0, 20],
    [-15, 20], [-30, 25],

    // Middle East
    [35, 45], [25, 50], [15, 45],

    // Central and South Asia
    [55, 40], [50, 70], [45, 90],
    [35, 75], [30, 75], [28.6, 77.2],
    [20, 80], [10, 75],

    // East and Southeast Asia
    [45, 105], [35, 110], [30, 120],
    [35, 135], [25, 120], [20, 110],
    [10, 105], [0, 110],

    // Australia
    [-10, 130], [-25, 135], [-35, 150]
];
const DISTANCE = 250;

let aircraftCache = [];
let lastUpdated = null;
let isFetching = false;


/*
    HOME ROUTE
*/
app.get("/", (req, res) => {
    res.send("Global Airplane Tracker Backend is working!");
});


/*
    FETCH ONE REGION
*/
async function fetchRegion(latitude, longitude) {

    const url =
        `https://opendata.adsb.fi/api/v3/lat/${latitude}/lon/${longitude}/dist/${DISTANCE}`;

    try {

        const response = await axios.get(url, {
            timeout: 30000
        });

        return response.data.ac || [];

    } catch (error) {

        console.log(
            `Region error (${latitude}, ${longitude}):`,
            error.response?.status || error.message
        );

        return [];
    }
}


/*
    UPDATE GLOBAL AIRCRAFT DATA
*/
async function updateAircraftData() {

    if (isFetching) {
        return;
    }

    isFetching = true;

    console.log("--------------------------------");
    console.log("Updating global aircraft data...");
    console.log("--------------------------------");

    try {

        const allAircraft = [];

        /*
            Fetch regions one by one.

            We intentionally wait 1.1 seconds between
            requests because ADS-B.fi public endpoints
            are rate limited.
        */
        for (const [latitude, longitude] of REGIONS) {

            console.log(
                `Fetching region: ${latitude}, ${longitude}`
            );

            const aircraft =
                await fetchRegion(
                    latitude,
                    longitude
                );

            allAircraft.push(
                ...aircraft
            );

            /*
                Wait before next request.
            */
            await new Promise(resolve =>
                setTimeout(resolve, 1100)
            );
        }


        /*
            Remove duplicate aircraft.

            The same aircraft can appear in
            multiple overlapping regions.
        */
        const uniqueAircraft =
            new Map();

        for (const plane of allAircraft) {

            if (
                plane.hex &&
                plane.lat != null &&
                plane.lon != null
            ) {

                uniqueAircraft.set(
                    plane.hex,
                    plane
                );
            }
        }


        /*
            Convert ADS-B.fi data into the
            format already used by your frontend.
        */
        aircraftCache =
            Array.from(
                uniqueAircraft.values()
            )
            .map(plane => ({

                icao24:
                    plane.hex,

                callsign:
                    plane.flight?.trim() ||
                    "Unknown",

                registration:
                    plane.r ||
                    "Unknown",

                aircraftType:
                    plane.t ||
                    "Unknown",

                description:
                    plane.desc ||
                    "Unknown",

                country:
                    "Unknown",

                longitude:
                    plane.lon,

                latitude:
                    plane.lat,

                altitude:
                    typeof plane.alt_baro === "number"
                        ? plane.alt_baro * 0.3048
                        : null,

                velocity:
                    typeof plane.gs === "number"
                        ? plane.gs * 0.514444
                        : null,

                heading:
                    typeof plane.track === "number"
                        ? plane.track
                        : 0

            }));


        lastUpdated =
            new Date().toISOString();


        console.log(
            `Global aircraft found: ${aircraftCache.length}`
        );

        console.log(
            `Last updated: ${lastUpdated}`
        );

    } catch (error) {

        console.log(
            "Global update error:",
            error.message
        );

    } finally {

        isFetching = false;

    }
}


/*
    AIRCRAFT API
*/
app.get("/api/aircraft", (req, res) => {

    res.json({

        count:
            aircraftCache.length,

        lastUpdated,

        aircraft:
            aircraftCache

    });

});


/*
    START SERVER
*/
const server =
    app.listen(
        5000,
        "127.0.0.1",
        () => {

            console.log(
                "================================"
            );

            console.log(
                "GLOBAL AIRPLANE TRACKER BACKEND"
            );

            console.log(
                "http://127.0.0.1:5000"
            );

            console.log(
                "================================"
            );

            /*
                Initial data fetch
            */
            updateAircraftData();


            /*
                Refresh every 5 minutes.

                A full global update takes time because
                requests are intentionally spaced out.
            */
            setInterval(
                updateAircraftData,
                5 * 60 * 1000
            );

        }
    );


/*
    SERVER ERROR
*/
server.on("error", error => {

    console.log(
        "SERVER ERROR:",
        error
    );

});