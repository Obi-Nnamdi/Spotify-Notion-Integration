import path from 'path';
import { Client, collectPaginatedAPI, isFullDatabase, isFullPage } from "@notionhq/client";
import dotenv from "dotenv";
import { strict as assert } from 'assert';
import { PageObjectResponse, QueryDatabaseResponse, RichTextItemResponse, TextRichTextItemResponse } from "@notionhq/client/build/src/api-endpoints";
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import { SpotifyAlbum } from './defs';

const spotifyClientId = "b817fc0a9ff6449aa771389ac2614b49";
const spotifyScopes = ["user-library-read", "user-library-modify"];

/**
 * Performs server authentication to get Spotify Token, redirecting back to /populateToken.
 */
async function authSpotify() {

    await SpotifyApi.performUserAuthorization(
        spotifyClientId,
        "http://localhost:3000",
        spotifyScopes,
        "/populateToken"
    );
}

/**
 * Shows spotify access token on html page.
 */
async function showToken() {
    const tokenInfoElement = document.getElementById("tokenResponse") ?? assert.fail("Bad ID");
    const tokenResponse = await fetch("/userToken");
    const tokenJSON = await tokenResponse.json();
    tokenInfoElement.textContent = `Token Information: ${JSON.stringify(tokenJSON, undefined, "\t")}`;
}

/**
 * Shows user's saved albums on html page.
 */
async function showAlbums() {
    const albumsElement = document.getElementById("loadedAlbums") ?? assert.fail("Bad ID");
    const albumsResponse = await fetch("/userAlbums");
    const savedAlbums: SpotifyAlbum[] = await albumsResponse.json();
    console.log(savedAlbums);
    albumsElement.textContent = `Loaded Albums: ${JSON.stringify(savedAlbums, undefined, "\t")}`;
}

const authButton = document.getElementById("AuthButton") ?? assert.fail("Bad ID");
authButton.onclick = async () => { await authSpotify(); await showToken(); };

// Show the spotify access token once the page is loaded.
window.onload = async (event) => {
    await Promise.all([showToken(), showAlbums()]);
}

// Load the user albums
const loadAlbumsButton = document.getElementById("loadAlbumsButton") ?? assert.fail("Bad ID");
loadAlbumsButton.onclick = async () => {
    const loadAlbumResponse = fetch("/loadAlbums", { method: "POST" });
    loadAlbumsButton.textContent = "Loading...";
    await loadAlbumResponse;
    await showAlbums();
    loadAlbumsButton.textContent = "Load Spotify Albums";
}

// Send post request to "/signout" when signout button is clicked
const signoutButton = document.getElementById("signoutButton") ?? assert.fail("Bad ID");
signoutButton.onclick = async () => {
    await fetch("/signout", { method: "POST" });
    await showToken();
}