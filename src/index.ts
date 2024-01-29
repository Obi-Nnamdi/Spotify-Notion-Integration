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
    // Clear album element children
    while (albumsElement.firstChild) {
        albumsElement.removeChild(albumsElement.firstChild);
    }
    if (savedAlbums.length === 0) {
        const noAlbumsElement = document.createElement("p");
        noAlbumsElement.textContent = "No albums found.";
        albumsElement.appendChild(noAlbumsElement);
        return;
    }

    // Create table from saved Spotify Albums:
    const table = document.createElement("table");
    table.classList.add("album-table");
    // Build table header
    const headerRow = document.createElement("tr");
    const albumNameHeader = document.createElement("th");
    albumNameHeader.textContent = "Album Name";
    const albumArtistHeader = document.createElement("th");
    albumArtistHeader.textContent = "Artist";
    const albumCoverHeader = document.createElement("th");
    albumCoverHeader.textContent = "Album Cover";
    headerRow.appendChild(albumNameHeader);
    headerRow.appendChild(albumArtistHeader);
    headerRow.appendChild(albumCoverHeader);
    table.appendChild(headerRow);

    // Build table rows
    for (const album of savedAlbums) {
        const row = document.createElement("tr");
        const albumNameCell = document.createElement("td");
        albumNameCell.innerHTML = `<a target="_blank" href="${album.url}">${album.name}</a>`;
        const albumArtistCell = document.createElement("td");
        albumArtistCell.textContent = album.artists.join(", ");
        const albumCoverCell = document.createElement("td");
        const image = document.createElement("img");
        image.src = album.cover_url;
        albumCoverCell.appendChild(image);
        row.appendChild(albumNameCell);
        row.appendChild(albumArtistCell);
        row.appendChild(albumCoverCell);
        table.appendChild(row);
    }
    albumsElement.appendChild(table);
}

const authButton = document.getElementById("AuthButton") ?? assert.fail("Bad ID");
authButton.onclick = async () => { await authSpotify(); await showToken(); };

// Show the spotify access token and user's saved albums once the page is loaded.
window.onload = async (event) => {
    await updatePage();
}

/**
 * Updates the dynamic components of the webpage.
 */
async function updatePage() {
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

// Import the user albums
const importAlbumsButton = document.getElementById("importAlbumsButton") ?? assert.fail("Bad ID");
importAlbumsButton.onclick = async () => {
    const importAlbumResponse = fetch("/importAlbums", { method: "POST" });
    importAlbumsButton.textContent = "Importing...";
    await importAlbumResponse;
    await updatePage();
    importAlbumsButton.textContent = "Import Albums into Notion";
}

// Send post request to "/signout" when signout button is clicked
const signoutButton = document.getElementById("signoutButton") ?? assert.fail("Bad ID");
signoutButton.onclick = async () => {
    await fetch("/signout", { method: "POST" });
    await updatePage();
}