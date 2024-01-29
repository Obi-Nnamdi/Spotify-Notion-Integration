import express, { Express, Request, Response, Application, response, NextFunction } from 'express';
import HttpStatus from 'http-status-codes';
import path from 'path';
import dotenv from "dotenv";
import { strict as assert } from 'assert';
import { Page, SavedAlbum, SpotifyApi } from '@spotify/web-api-ts-sdk';
import { importSavedSpotifyAlbums } from './jobs';
import { SpotifyAlbum } from './defs';
import { CronJob } from 'cron';
import { standardFormatDate } from './helpers';
import cliProgress from 'cli-progress';
import { DateTime } from 'luxon';

// Using Chalk v4.1.2 on purpose: it's the only one that works with CommonJS.
import chalk from 'chalk';

// For env File
dotenv.config();

// Globals (I know, I know...)
const app: Application = express();
const port = process.env.PORT || 3000;
const spotifyScopes = ["user-library-read", "user-library-modify"];
let spotify: SpotifyApi | undefined = undefined;
let localSavedAlbums: SavedAlbum[] = [];
const importingJob = new CronJob(
    "0-59/15 * * * *", // Every 15 minutes
    // "* * * * * *", // Every second
    // "* * * * *", // Every Minute
    runImportingJob,
    null, // don't do anything on completion
    false, // don't start automatically
    "America/New_York"
);

const notionDatabaseID = process.env.DATABASE_ID ?? assert.fail("Bad Database ID");
const artistColumn = "Artist";
const albumNameColumn = "Album Name";
const albumIdColumn = "Album ID";
const albumURLColumn = "URL";
const albumGenreColumn = "Genre"
const dateDiscoveredColumn = "Date Discovered";

// Middleware
app.use(express.json()); // parse request bodies as JSON
app.use(express.static('./')); // allows server to serve static content in this project
// Log all requests to the server
app.use((req: Request, res: Response, next: NextFunction) => {
    const dateString = `[${standardFormatDate(DateTime.now())}]`;
    let endpointStringColor;
    const requestMethod = req.method.toUpperCase();
    if (requestMethod === "GET") {
        endpointStringColor = chalk.green;
    }
    else if (requestMethod === "POST") {
        endpointStringColor = chalk.yellow;
    }
    else {
        endpointStringColor = chalk.blue;
    }
    const endpointString = endpointStringColor(`${req.method.toUpperCase()}: ${req.path}`);
    console.log(`${dateString} ${endpointString}`)
    next();
})


// Landing Page for Web APP
app.get('/', (req: Request, res: Response) => {
    res.status(HttpStatus.OK).type('html').sendFile(path.resolve("index.html"));
});

// POST(accessToken: AccessToken). Shouldn't be called by anyone except for 
// Spotify's authentication servers.
// Populates the spotifyApi variable, allowing calls to get user information to be possible.
app.post('/populateToken', (req: Request, res: Response) => {
    spotify = SpotifyApi.withAccessToken(
        process.env.SPOTIFY_CLIENT_ID ?? assert.fail("No Spotify Client ID"),
        req.body
    );
    res.status(HttpStatus.OK).type('text').send('Post Request Recieved!')
});

// POST: Gets the logged in user's saved spotify albums, and caches them in the server
app.post('/loadAlbums', async (req: Request, res: Response) => {
    if (spotify === undefined) {
        console.error("ERROR: Internal spotify access token wasn't populated!");
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).send("Internal Server Error: Spotify Access Token Not Populated");
        return;
    }
    const savedAlbums = await getSavedUserAlbums();
    console.log(`Loaded ${savedAlbums.length} albums from Spotify!`);
    res.status(HttpStatus.OK).send(`Loaded ${savedAlbums.length} albums from Spotify!`);

    // Cache Saved Albums
    localSavedAlbums = savedAlbums;
});

// POST: Imports Albums into Notion.
app.post('/importAlbums', async (req: Request, res: Response) => {
    // TODO: Refactor to be more general
    if (spotify === undefined) {
        console.error("ERROR: Internal spotify access token wasn't populated!");
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).send("Internal Server Error: Spotify Access Token Not Populated");
        return;
    }

    // TODO: Automatically retrieve albums if we haven't gotten them yet
    await importSavedSpotifyAlbums(
        localSavedAlbums,
        notionDatabaseID,
        albumNameColumn,
        artistColumn,
        albumIdColumn,
        albumURLColumn,
        albumGenreColumn,
        dateDiscoveredColumn,
    );
    res.status(HttpStatus.OK).send(`Imported ${localSavedAlbums.length} Albums Successfully!`);
});

// GET: Retrieves the user token for the currently signed in user.
app.get('/userToken', async (req: Request, res: Response) => {
    if (spotify !== undefined) {
        res.status(HttpStatus.OK).send(await spotify.getAccessToken());
        return;
    }
    res.send({ token: "No Token Populated!" });
});

// GET: Retrieves the user's saved albums.
app.get('/userAlbums', async (req: Request, res: Response) => {
    res.send(localSavedAlbums.map(savedAlbum => {
        const album: SpotifyAlbum = {
            name: savedAlbum.album.name,
            artists: savedAlbum.album.artists.map(artist => artist.name),
            cover_url: savedAlbum.album.images[0]?.url || "",
            url: savedAlbum.album.external_urls.spotify
        }
        return album;
    }
    ))
})

// POST: Signs out the current user. 
app.post('/signout', async (req: Request, res: Response) => {
    spotify = undefined;
    localSavedAlbums = [];
    console.log("Logged Out!");
    res.status(HttpStatus.OK).send("Successfully Logged Out!");
});

// POST: Starts cron job for automatically importing spotify albums
app.post('/startImportingJob', (req: Request, res: Response) => {
    importingJob.start();
    console.log(`Importing Cron Job Started! It will next run at ${standardFormatDate(importingJob.nextDate())}`);
    res.status(HttpStatus.OK);
});

// POST: Ends cron job for automatically importing spotify albums
app.post('/stopImportingJob', (req: Request, res: Response) => {
    importingJob.stop();
    console.log("Importing Cron Job Stopped!");
    res.status(HttpStatus.OK);
});

app.listen(port, () => {
    console.log(`Server is listening at http://localhost:${port}`);
});

async function runImportingJob() {
    console.log(`[${standardFormatDate(DateTime.now())}] ${chalk.blue("Running Importing Job...")}`);
    if (spotify === undefined) {
        console.log("Skipping Importing Job because internal Spotify Access Token is not populated.");
        return;
    }
    // Load and import saved spotify albums
    console.log("Importing Loaded Albums from Spotify...");
    // Note that we don't update our cache of userSavedAlbums here, 
    // this process runs separately in the background
    const localSavedAlbums = await getSavedUserAlbums();
    console.log("Importing Loaded Albums into Notion...");
    await importSavedSpotifyAlbums(
        localSavedAlbums,
        notionDatabaseID,
        albumNameColumn,
        artistColumn,
        albumIdColumn,
        albumURLColumn,
        albumGenreColumn,
        dateDiscoveredColumn,
    );
    console.log(`Done! Importing Job will next run at ${standardFormatDate(importingJob.nextDate())}`);
}

/**
 * Gets the saved albums from the signed in spotify user.
 * @returns Array of the saved albums from the currently signed in spotify user.
 * If the spotify user is currently not populated, throws an error.
 */
async function getSavedUserAlbums(showProgressBar = true): Promise<SavedAlbum[]> {
    if (spotify === undefined) {
        throw new Error("Internal spotify access token wasn't populated!");
    }

    console.log("Getting Saved Spotify Albums...")

    const limit = 50; // Max page limit for spotify API

    // Do a "diagnostic query" to find out how many albums we have, then concurrently hit the server 
    // in blocks of 50 (our limit) until we hit the total (takes ~2 seconds)
    const spotifyResponsePromises: Array<Promise<Page<SavedAlbum>>> = [];
    const diagnosticQueryAlbumLimit = 0; // we don't want to get any albums here, just know how many we have
    const diagnosticQuery = await spotify.currentUser.albums.savedAlbums(diagnosticQueryAlbumLimit);
    const totalAlbums = diagnosticQuery.total;

    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    if (showProgressBar) {
        progressBar.start(totalAlbums, 0);
    }

    // Concurrently hit spotify server for all our albums at once
    for (let offset = 0; offset < totalAlbums; offset += limit) {
        spotifyResponsePromises.push(
            spotify.currentUser.albums.savedAlbums(limit, offset).then(response => {
                // Update Progress bar
                if (showProgressBar) {
                    progressBar.increment(response.items.length)
                }
                return response;
            })
        );
    }

    const spotifyResponses = await Promise.all(spotifyResponsePromises);
    if (showProgressBar) {
        progressBar.stop();
    }
    // Flatten list of spotify responses into a list of saved albums
    const savedAlbums = spotifyResponses.flatMap(response => response.items);
    return savedAlbums;
}
