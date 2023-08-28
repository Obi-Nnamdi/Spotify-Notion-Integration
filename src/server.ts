import express, { Express, Request, Response, Application, response } from 'express';
import HttpStatus from 'http-status-codes';
import path from 'path';
import { Client, collectPaginatedAPI, isFullDatabase, isFullPage } from "@notionhq/client";
import dotenv from "dotenv";
import { strict as assert } from 'assert';
import { PageObjectResponse, QueryDatabaseResponse, RichTextItemResponse, TextRichTextItemResponse } from "@notionhq/client/build/src/api-endpoints";
import { Page, SavedAlbum, SpotifyApi } from '@spotify/web-api-ts-sdk';
import { importSavedSpotifyAlbums } from './jobs';
import { type } from "os";
import AlbumsEndpoints from "@spotify/web-api-ts-sdk/dist/mjs/endpoints/AlbumsEndpoints";
import { url } from "inspector";

// For env File
dotenv.config();



const app: Application = express();
const port = process.env.PORT || 3000;
const spotifyScopes = ["user-library-read", "user-library-modify"];
let spotify: SpotifyApi | undefined = undefined;
let userSavedAlbums: SavedAlbum[] = [];

app.use(express.json()); // parse request bodies as JSON
app.use(express.static('./')); // allows server to serve static content in this project

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
    console.log(req.body);
    res.status(HttpStatus.OK).type('text').send('Post Request Recieved!')
});

// GET: Gets the logged in user's saved spotify albums, and caches them in the server
app.get('/userAlbums', async (req: Request, res: Response) => {
    if (spotify === undefined) {
        console.log("Redirected since access token wasn't populated!");
        res.redirect("/");
        return;
    }
    const limit = 50;

    // Do a "diagnostic query" to find out how many albums we have, then concurrently hit the server 
    // in blocks of 50 (our limit) until we hit the total (takes ~2 seconds)
    const spotifyResponsePromises: Array<Promise<Page<SavedAlbum>>> = [];
    const diagnosticQueryAlbumLimit = 0; // we don't want to get any albums here, just know how many we have
    const diagnosticQuery = await spotify.currentUser.albums.savedAlbums(diagnosticQueryAlbumLimit);
    const totalAlbums = diagnosticQuery.total;

    // Concurrently hit spotify server for all our albums at once
    for (let offset = 0; offset < totalAlbums; offset += limit) {
        spotifyResponsePromises.push(
            spotify.currentUser.albums.savedAlbums(limit, offset).then(response => {
                // Print range of albums we retrieved
                console.log(`Got saved albums ${offset + 1} - ${Math.min(offset + limit, totalAlbums)}`);
                return response
            })
        );
    }

    const spotifyResponses = await Promise.all(spotifyResponsePromises);

    // Flatten list of spotify responses into a list of saved albums
    const savedAlbums = spotifyResponses.flatMap(response => response.items);
    res.status(HttpStatus.OK).send(`User has ${totalAlbums} albums, got ${savedAlbums.length} albums from Spotify!`);

    // Cache Saved Albums
    userSavedAlbums = savedAlbums;
});

// Imports Albums into Notion.
app.get('/importAlbums', async (req: Request, res: Response) => {
    // TODO: Refactor to be more general
    if (spotify === undefined) {
        console.log("Redirected since access token wasn't populated!");
        res.redirect("/");
        return;
    }

    // TODO: Automatically retrieve albums if we haven't gotten them yet
    const notionDatabaseID = process.env.DATABASE_ID ?? assert.fail("Bad Database ID");
    const artistColumn = "Artist";
    const albumNameColumn = "Album Name";
    const albumIdColumn = "Album ID";
    const albumURLColumn = "URL";
    const albumGenreColumn = "Genre"
    const dateDiscoveredColumn = "Date Discovered";
    await importSavedSpotifyAlbums(
        userSavedAlbums,
        notionDatabaseID,
        albumNameColumn,
        artistColumn,
        albumIdColumn,
        albumURLColumn,
        albumGenreColumn,
        dateDiscoveredColumn,
    );
    res.status(HttpStatus.OK).send(`Imported ${userSavedAlbums.length} Albums Successfully!`);
});

// GET: Retrieves the user token for the currently signed in user.
app.get('/userToken', async (req: Request, res: Response) => {
    if (spotify !== undefined) {
        res.status(HttpStatus.OK).send(await spotify.getAccessToken());
        return;
    }
    res.send({ token: "No Token Populated!" });
});

// POST: Signs out the current user. 
app.post('/signout', async (req: Request, res: Response) => {
    spotify = undefined;
    res.status(HttpStatus.OK).send("Successfully Logged Out!");
});

app.listen(port, () => {
    console.log(`Server is listening at http://localhost:${port}`);
});