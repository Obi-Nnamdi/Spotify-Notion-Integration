import path from 'path';
import { Client, collectPaginatedAPI, isFullDatabase, isFullPage } from "@notionhq/client";
import dotenv from "dotenv";
import { strict as assert } from 'assert';
import { PageObjectResponse, QueryDatabaseResponse, RichTextItemResponse, TextRichTextItemResponse } from "@notionhq/client/build/src/api-endpoints";
import { SpotifyApi } from '@spotify/web-api-ts-sdk';

const spotifyClientId = "b817fc0a9ff6449aa771389ac2614b49";
const spotifyScopes = ["user-library-read", "user-library-modify"];

/**
 * Performs server authentication to get Spotify Token, redirecting back to /populateToken.
 */
async function authSpotify() {

    await SpotifyApi.performUserAuthorization(
        spotifyClientId,
        "http://localhost:3000/userAlbums",
        spotifyScopes,
        "/populateToken"
    );
}

const element = document.getElementById("AuthButton") ?? assert.fail("Bad ID");
element.onclick = authSpotify;