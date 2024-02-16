import express, { Express, Request, Response, Application, response, NextFunction } from 'express';
import expressAsyncHandler from 'express-async-handler';
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
import { DateTime } from 'luxon';;
import * as fs from 'node:fs';
import https from 'node:https';
import { Logtail } from '@logtail/node';
import { LogtailTransport } from '@logtail/winston';
import winston from 'winston';
// Using Chalk v4.1.2 on purpose: it's the only one that works with CommonJS.
import chalk from 'chalk';

// For env File
dotenv.config();

// Globals (I know, I know...)
const spotifyScopes = ["user-library-read", "user-library-modify"];
let spotify: SpotifyApi | undefined = undefined;
let localSavedAlbums: SavedAlbum[] = [];

// Logging Globals
const MiBSize = 1024 * 1024;
const maxFileSize = 50 * MiBSize; // 50 MiB
const maxLogFiles = 3; // 3 log files max are created when logging.
const loggingTransports: winston.transport[] = [
    new winston.transports.File({ filename: path.resolve('logs/error.log'), level: 'error', maxFiles: maxLogFiles, maxsize: maxFileSize }),
    new winston.transports.File({ filename: path.resolve('logs/combined.log'), maxFiles: maxLogFiles, maxsize: maxFileSize }),
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }),
];

// If we have a Logtail Source Token, add it as another logging transport
if (process.env.LOGTAIL_SOURCE_TOKEN !== undefined) {
    console.log("Sending logs using Logtail...");
    const logtail = new Logtail(process.env.LOGTAIL_SOURCE_TOKEN);
    loggingTransports.push(new LogtailTransport(logtail));
}
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(winston.format.errors({ stack: true }), winston.format.timestamp(), winston.format.json()),
    transports: loggingTransports
})

// Server Globals
const app: Application = express();
const port = process.env.PORT || 3000;
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
    // console.log(`${dateString} ${endpointString}`);
    logger.info(`${dateString} ${endpointString}`);
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
    logger.verbose(JSON.stringify(req.body));
    spotify = SpotifyApi.withAccessToken(
        process.env.SPOTIFY_CLIENT_ID ?? assert.fail("No Spotify Client ID"),
        req.body
    );
    res.status(HttpStatus.OK).type('text').send('Post Request Recieved!')
});

// POST: Gets the logged in user's saved spotify albums, and caches them in the server
app.post('/loadAlbums', expressAsyncHandler(async (req: Request, res: Response) => {
    if (spotify === undefined) {
        logger.error("ERROR: Internal spotify access token wasn't populated!");
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).send("Internal Server Error: Spotify Access Token Not Populated");
        return;
    }
    const savedAlbums = await getSavedUserAlbums();
    logger.info(`Loaded ${savedAlbums.length} albums from Spotify!`);
    res.status(HttpStatus.OK).send(`Loaded ${savedAlbums.length} albums from Spotify!`);

    // Cache Saved Albums
    localSavedAlbums = savedAlbums;
}));

// POST: Imports Albums into Notion.
app.post('/importAlbums', expressAsyncHandler(async (req: Request, res: Response) => {
    // TODO: Refactor to be more general
    if (spotify === undefined) {
        logger.error("ERROR: Internal spotify access token wasn't populated!");
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
        /* logger = */ logger
    );
    res.status(HttpStatus.OK).send(`Imported ${localSavedAlbums.length} Albums Successfully!`);
}));

// GET: Retrieves the user token for the currently signed in user.
app.get('/userToken', async (req: Request, res: Response) => {
    if (spotify !== undefined) {
        res.status(HttpStatus.OK).send(await spotify.getAccessToken());
        return;
    }
    res.send({ token: "No Token Populated!" });
});

// GET: Retrieves the user's saved albums.
app.get('/userAlbums', (req: Request, res: Response) => {
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
app.post('/signout', (req: Request, res: Response) => {
    spotify = undefined;
    localSavedAlbums = [];
    logger.info("Logged Out!");
    res.status(HttpStatus.OK).send("Successfully Logged Out!");
});

// POST: Starts cron job for automatically importing spotify albums
app.post('/startImportingJob', (req: Request, res: Response) => {
    importingJob.start();
    logger.info(`Importing Cron Job Started! It will next run at ${standardFormatDate(importingJob.nextDate())}`);
    res.status(HttpStatus.OK);
});

// POST: Ends cron job for automatically importing spotify albums
app.post('/stopImportingJob', (req: Request, res: Response) => {
    importingJob.stop();
    logger.info("Importing Cron Job Stopped!");
    res.status(HttpStatus.OK);
});

// Try and start an https server using secure credentials if we have them
try {
    const certOptions = {
        key: fs.readFileSync(path.resolve("./cert/key.pem")),
        cert: fs.readFileSync(path.resolve("./cert/cert.pem")),
        passphrase: process.env.CERT_PASSPHRASE ?? assert.fail("No Cert Passphrase")
    };
    https.createServer(certOptions, app).listen(port, () => {
        logger.info(`Server is listening at https://localhost:${port}`);
    });
}
catch (Error) {
    // Start an http server if we can't start an https server
    logger.info("Unable to start https server, moving to http server...");
    app.listen(port, () => {
        logger.info(`Server is listening at http://localhost:${port}`);
    });
}

async function runImportingJob() {
    logger.info(`[${standardFormatDate(DateTime.now())}] ${chalk.blue("Running Importing Job...")}`);
    if (spotify === undefined) {
        logger.warn("Skipping Importing Job because internal Spotify Access Token is not populated.");
        return;
    }
    try {
        // Load and import saved spotify albums
        logger.info("Importing Loaded Albums from Spotify...");
        // Note that we don't update our cache of userSavedAlbums here, 
        // this process runs separately in the background
        const localSavedAlbums = await getSavedUserAlbums();
        logger.info("Importing Loaded Albums into Notion...");
        await importSavedSpotifyAlbums(
            localSavedAlbums,
            notionDatabaseID,
            albumNameColumn,
            artistColumn,
            albumIdColumn,
            albumURLColumn,
            albumGenreColumn,
            dateDiscoveredColumn,
            /* logger = */ logger
        );
    }
    catch (error) {
        logger.error("Error occurred while running importing job!");
        logger.error(error);
    }
    logger.info(`Done! Importing Job will next run at ${standardFormatDate(importingJob.nextDate())}`);
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
