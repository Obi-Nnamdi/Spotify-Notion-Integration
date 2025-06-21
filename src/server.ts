import express, { Express, Request, Response, Application, response, NextFunction } from 'express';
import expressAsyncHandler from 'express-async-handler';
import HttpStatus from 'http-status-codes';
import path from 'path';
import dotenv from "dotenv";
import { strict as assert } from 'assert';
import { Page, SavedAlbum, SpotifyApi } from '@spotify/web-api-ts-sdk';
import { backfillAlbumDurations, filterSpotifyLibraryUsingIncludeColumn, importSavedSpotifyAlbums, updateStaleNotionAlbumsFromSpotify } from './jobs';
import { SpotifyAlbum, kImportingJob, kUpdatingStaleAlbumsJob, CronJobSettings, kFilteringSpotifyLibraryJob, NotionAlbumDBColumnNames } from './defs';
import { CronJob } from 'cron';
import { getSpotifyAlbumIDsFromNotionPage, standardFormatDate } from './helpers';
import cliProgress from 'cli-progress';
import { DateTime } from 'luxon';;
import * as fs from 'node:fs';
import https from 'node:https';
import { Logtail } from '@logtail/node';
import { LogtailTransport } from '@logtail/winston';
import winston from 'winston';
// Using Chalk v4.1.2 on purpose: it seems to be the most recent one that works with CommonJS.
import chalk from 'chalk';
import * as os from 'node:os'
import { isFullPage } from '@notionhq/client';
import { PageObjectResponse, QueryDatabaseResponse, RichTextItemResponse } from "@notionhq/client/build/src/api-endpoints";

// For env File
dotenv.config();

// Globals (I know, I know...)
let spotify: SpotifyApi | undefined = undefined;
let cachedSavedAlbums: SavedAlbum[] = [];

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

// Cron Job Globals
const cronJobFlags = new Map<string, boolean>([
    [kImportingJob, true],
    [kUpdatingStaleAlbumsJob, false],
    [kFilteringSpotifyLibraryJob, false]
]);
const cronJobInterval = 15; // minutes
const albumDBJobs = new CronJob(
    `0-59/${cronJobInterval} * * * *`, // Every 15 minutes
    // "* * * * * *", // Every second
    // "* * * * *", // Every Minute
    runAlbumDBJobs,
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
const albumDurationColumn = "Duration";
const includeInSpotifyColumn = "Include in Spotify";

const notionColumnNames: NotionAlbumDBColumnNames = {
    artist: artistColumn,
    name: albumNameColumn,
    spotifyId: albumIdColumn,
    url: albumURLColumn,
    dateDiscovered: dateDiscoveredColumn,
    duration: albumDurationColumn,
    genre: albumGenreColumn,
    includeInSpotify: includeInSpotifyColumn
}

// Middleware
app.use(express.json()); // parse request bodies as JSON
app.use(express.urlencoded({ extended: true })); // parse url-encoded content
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
    cachedSavedAlbums = savedAlbums;
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
        cachedSavedAlbums,
        notionDatabaseID,
        albumNameColumn,
        artistColumn,
        albumIdColumn,
        albumURLColumn,
        albumGenreColumn,
        dateDiscoveredColumn,
        albumDurationColumn,
        /* logger = */ logger
    );
    res.status(HttpStatus.OK).send(`Imported ${cachedSavedAlbums.length} Albums Successfully!`);
}));

// POST: Updates Stale Albums in Notion DB based on loaded Spotify Albums
app.post('/updateStaleAlbums', expressAsyncHandler(async (req: Request, res: Response) => {
    // TODO: Automatically retrieve albums if we haven't gotten them yet
    await updateStaleNotionAlbumsFromSpotify(
        cachedSavedAlbums,
        albumNameColumn,
        artistColumn,
        albumIdColumn,
        albumURLColumn,
        /* logger = */ logger
    );
    res.status(HttpStatus.OK).send(`Updated Stale Albums!`);
}))

// POST: Filter's user's spotify library based on the linked notion album database
app.post('/filterSpotifyLibrary', expressAsyncHandler(async (req: Request, res: Response) => {
    // TODO: Automatically retrieve albums if we haven't gotten them yet
    if (spotify === undefined) {
        logger.error("ERROR: Internal spotify access token wasn't populated!");
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).send("Internal Server Error: Spotify Access Token Not Populated");
        return;
    }
    await filterSpotifyLibraryUsingIncludeColumn(
        spotify,
        albumIdColumn,
        includeInSpotifyColumn,
        /* logger = */ logger,
        /* originalSavedAlbums = */ cachedSavedAlbums.length > 0 ? cachedSavedAlbums : undefined
    )
    res.status(HttpStatus.OK).send(`Updated Spotify Album Library!`);
}))

app.post('/backfillNotionDatabaseProperties', expressAsyncHandler(async (req: Request, res: Response) => {
    // TODO: Make use of req parameters to only backfill what the user wants.
    if (spotify === undefined) {
        logger.error("ERROR: Internal spotify access token wasn't populated!");
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).send("Internal Server Error: Spotify Access Token Not Populated");
        return;
    }
    await backfillAlbumDurations(
        spotify,
        notionDatabaseID,
        notionColumnNames,
        /* logger = */ logger
    )
    res.status(HttpStatus.OK).send(`Backfilled Notion Album Library!`);
}))

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
    res.send(cachedSavedAlbums.map(savedAlbum => {
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
    cachedSavedAlbums = [];
    logger.info("Logged Out!");
    res.status(HttpStatus.OK).send("Successfully Logged Out!");
});

// POST: Starts cron jobs that link spotify and notion databases
app.post('/startCronJob', (req: Request, res: Response) => {
    albumDBJobs.start();
    logger.info(`Cron Job Started! It will next run at ${standardFormatDate(albumDBJobs.nextDate())}`);
    res.sendStatus(HttpStatus.OK);
});

// POST: Ends cron job that link spotify and notion databases
app.post('/stopCronJob', (req: Request, res: Response) => {
    albumDBJobs.stop();
    logger.info("Cron Job Stopped!");
    res.sendStatus(HttpStatus.OK);
});

// POST: Changes the jobs that are run in the main Cron Job.
// Takes a form response where every key is a name of a job that should be enabled. The other jobs are disabled.
// TODO: Add functionality to change the cron job interval
app.post('/editCronJob', (req: Request, res: Response) => {
    const newJobs: Set<string> = new Set(Object.keys(req.body));
    newJobs.forEach(jobName => cronJobFlags.set(jobName, true));
    cronJobFlags.forEach((value, key) => {
        if (!newJobs.has(key)) {
            cronJobFlags.set(key, false);
        }
    })
    logger.info(`Updated Cron Job Jobs: ${chalk.blue(Array.from(newJobs).join(", "))}`);
    res.sendStatus(HttpStatus.OK);
});

//GET: Gets Cron Job Settings
app.get('/cronJobSettings', (req: Request, res: Response) => {
    const jobSettings: CronJobSettings = {
        enabled: albumDBJobs.running,
        [kImportingJob]: cronJobFlags.get(kImportingJob) ?? false,
        [kUpdatingStaleAlbumsJob]: cronJobFlags.get(kUpdatingStaleAlbumsJob) ?? false,
        [kFilteringSpotifyLibraryJob]: cronJobFlags.get(kFilteringSpotifyLibraryJob) ?? false,
        interval: cronJobInterval,
        nextRun: standardFormatDate(albumDBJobs.nextDate()),
    };
    res.send(jobSettings);
});

// Try and start an https server using secure credentials if we have them
const ipAdress = os.networkInterfaces().en0?.filter(i => i.family === "IPv4")[0]?.address;
try {
    const certOptions = {
        key: fs.readFileSync(path.resolve("./cert/key.pem")),
        cert: fs.readFileSync(path.resolve("./cert/cert.pem")),
        passphrase: process.env.CERT_PASSPHRASE ?? assert.fail("No Cert Passphrase")
    };
    https.createServer(certOptions, app).listen(port, () => {
        logger.info(`Server is listening at https://localhost:${port}`);
        if (ipAdress !== undefined) {
            logger.info(`Server is also listening at https://${ipAdress}:${port}`);
        }
    });
}
catch (Error) {
    // Start an http server if we can't start an https server
    logger.info("Unable to start https server, moving to http server...");
    app.listen(port, () => {
        logger.info(`Server is listening at http://localhost:${port}`);
        if (ipAdress !== undefined) {
            logger.info(`Server is also listening at http://${ipAdress}:${port}`);
        }
    });
}

/**
 * Endpoint that should be triggered off of a Notion webhook automation with "Album ID" as the property name.
 * TODO: Incomplete. Lots of infrastructure required for this.
 */
app.post('/playAlbum', (req: Request, res: Response) => {
    // Make sure we actually got a page from the post body.
    if (!isFullPage(req.body.data)) {
        res.sendStatus(HttpStatus.BAD_REQUEST);
        return;
    }
    // Get the first album ID from the sent notion page and play it.
    const pageData = req.body.data as PageObjectResponse;
    const albumIds = getSpotifyAlbumIDsFromNotionPage(pageData, albumIdColumn);
    if (albumIds.length == 0) {
        res.sendStatus(HttpStatus.BAD_REQUEST);
        return;
    }
    const playedAlbumID = albumIds[0];

    logger.info(`Playing Album ID: ${chalk.blue(playedAlbumID)}`);
    res.sendStatus(HttpStatus.OK);
})

/**
 * Job that imports saved spotify albums and puts them into the notion database.
 */
async function runImportingJob() {
    logger.info(`[${standardFormatDate(DateTime.now())}] ${chalk.blue("Running Importing Job...")}`);
    if (spotify === undefined) {
        logger.warn("Skipping Importing Job because internal Spotify access token is not populated.");
        return;
    }
    // This will randomly fail sometimes because of a failure to refresh access token
    // See https://community.spotify.com/t5/Spotify-for-Developers/Cannot-refresh-access-token-500-quot-server-error-quot-Failed-to/td-p/5191168
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
            albumDurationColumn,
            /* logger = */ logger
        );
    }
    catch (error) {
        logger.error("Error occurred while running importing job!");
        logger.error(error);
    }
}

/**
 * Job that updates the stale albums in the linked Notion Database. 
 */
async function runStaleAlbumUpdaterJob() {
    logger.info(`[${standardFormatDate(DateTime.now())}] ${chalk.blue("Running Stale Album Updater Job...")}`);
    if (spotify === undefined) {
        logger.warn("Skipping Stale Album Updater Job because internal Spotify access token is not populated.");
        return;
    }
    // This will randomly fail sometimes because of a failure to refresh access token
    // See https://community.spotify.com/t5/Spotify-for-Developers/Cannot-refresh-access-token-500-quot-server-error-quot-Failed-to/td-p/5191168
    try {
        // Load and import saved spotify albums
        logger.info("Importing Loaded Albums from Spotify...");
        // Note that we don't update our cache of userSavedAlbums here, 
        // this process runs separately in the background
        const localSavedAlbums = await getSavedUserAlbums();
        logger.info("Updating Stale Notion Albums based on saved Spotify albums...");
        await updateStaleNotionAlbumsFromSpotify(
            localSavedAlbums,
            albumNameColumn,
            artistColumn,
            albumIdColumn,
            albumURLColumn,
            /* logger = */ logger,
            /* overwriteIDs = */ true
        );
    }
    catch (error) {
        logger.error("Error occurred while running stale album updating job!");
        logger.error(error);
    }
}

/**
 * Job that filters the albums in a user's spotify library based on the linked Notion Database.
 */
async function runSpotifyLibraryFilteringJob() {
    logger.info(`[${standardFormatDate(DateTime.now())}] ${chalk.blue("Running Spotify Library Filtering Job...")}`);
    if (spotify === undefined) {
        logger.warn("Skipping Spotify Library Filtering Job because internal Spotify access token is not populated.");
        return;
    }
    // This will randomly fail sometimes because of a failure to refresh access token
    // See https://community.spotify.com/t5/Spotify-for-Developers/Cannot-refresh-access-token-500-quot-server-error-quot-Failed-to/td-p/5191168
    try {
        // Load and import saved spotify albums
        logger.info("Importing Loaded Albums from Spotify...");
        // Note that we don't update our cache of userSavedAlbums here, 
        // this process runs separately in the background
        const localSavedAlbums = await getSavedUserAlbums();
        logger.info("Filtering Spotify library based on Notion album pages...");
        await filterSpotifyLibraryUsingIncludeColumn(
            spotify,
            albumIdColumn,
            includeInSpotifyColumn,
            /* logger = */ logger,
            /* originalSavedAlbums = */ localSavedAlbums
        );
    }
    catch (error) {
        logger.error("Error occurred while running spotify library filtering job!");
        logger.error(error);
    }
}

/**
 * Main Cron Job function that runs all enabled jobs.
 */
async function runAlbumDBJobs() {
    logger.info(`[${standardFormatDate(DateTime.now())}] ${chalk.blue("Running Jobs...")}`);
    if (cronJobFlags.get(kImportingJob)) {
        await runImportingJob();
    }
    if (cronJobFlags.get(kUpdatingStaleAlbumsJob)) {
        await runStaleAlbumUpdaterJob();
    }
    if (cronJobFlags.get(kFilteringSpotifyLibraryJob)) {
        await runSpotifyLibraryFilteringJob();
    }
    logger.info(`Done! Jobs will next run at ${standardFormatDate(albumDBJobs.nextDate())}`);
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

    const progressBar = new cliProgress.SingleBar({ clearOnComplete: true, hideCursor: true }, cliProgress.Presets.shades_classic);
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
