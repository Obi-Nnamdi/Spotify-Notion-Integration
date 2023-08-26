import express, { Express, Request, Response, Application } from 'express';
import HttpStatus from 'http-status-codes';
import path from 'path';
import { Client, collectPaginatedAPI, isFullDatabase, isFullPage } from "@notionhq/client";
import dotenv from "dotenv";
import { strict as assert } from 'assert';
import { PageObjectResponse, QueryDatabaseResponse, RichTextItemResponse, TextRichTextItemResponse } from "@notionhq/client/build/src/api-endpoints";
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import { type } from "os";
import AlbumsEndpoints from "@spotify/web-api-ts-sdk/dist/mjs/endpoints/AlbumsEndpoints";
import { url } from "inspector";

// For env File
dotenv.config();



const app: Application = express();
const port = process.env.PORT || 3000;
const spotifyScopes = ["user-library-read", "user-library-modify"];
let spotify: SpotifyApi | undefined = undefined;

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

// GET: Gets the logged in user's saved spotify albums
app.get('/userAlbums', async (req: Request, res: Response) => {
    if (spotify === undefined) {
        console.log("Redirected since access token wasn't populated!");
        res.redirect("/");
        return;
    }
    const limit = 50;
    const spotifyResponse = await spotify.currentUser.albums.savedAlbums(limit);
    res.status(HttpStatus.OK).send(`User has ${spotifyResponse.total} albums, got ${spotifyResponse.items.length} albums from Spotify!`);
    // Two strategies: either sequentially query the server for each batch of 50 albums, 
    // or query one album and hit the server multiple times concurrently for each offset
});

app.get('/userToken', async (req: Request, res: Response) => {
    if (spotify !== undefined) {
        res.status(HttpStatus.OK).send(await spotify.getAccessToken());
        return;
    }
    res.send({ token: "No Token Populated!" });
});

// GET: Signs out the current user. 
app.get('/signout', async (req: Request, res: Response) => {
});

app.listen(port, () => {
    console.log(`Server is listening at http://localhost:${port}`);
});