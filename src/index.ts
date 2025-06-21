import path from 'path';
import { Client, collectPaginatedAPI, isFullDatabase, isFullPage } from "@notionhq/client";
import { strict as assert } from 'assert';
import { PageObjectResponse, QueryDatabaseResponse, RichTextItemResponse, TextRichTextItemResponse } from "@notionhq/client/build/src/api-endpoints";
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import { SpotifyAlbum, CronJobSettings, kImportingJob, kUpdatingStaleAlbumsJob, kFilteringSpotifyLibraryJob } from './defs';

const spotifyClientId = process.env.SPOTIFY_CLIENT_ID ?? assert.fail("No Spotify Client ID in env file.");
const spotifyScopes = ["user-library-read", "user-library-modify"];

/**
 * Performs server authentication to get Spotify Token, redirecting back to /populateToken.
 * 
 * Note that this function will fail if not started from a page hosted on an HTTPS server (excluding localhost),
 * since the Web Crypto API is restricted to secure origins.
 * @see https://stackoverflow.com/a/57170494/20791863
 */
async function authSpotify() {

    // TODO: experiment with being redirected to another callback URL that calls performUserAuthorization again to avoid having to click authorize twice
    await SpotifyApi.performUserAuthorization(
        spotifyClientId,
        window.location.origin, // redirect back to the page we started on
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

/**
 * Updates Cron Job Settings based on the server response.
*/
async function updateCronJobSettings() {
    const cronJobResponse = await fetch("/cronJobSettings");
    const cronJobSettings: CronJobSettings = await cronJobResponse.json();
    // Update Cron Job Settings
    const cronJobSettingsElement = document.getElementById("cronJobSettings") ?? assert.fail("Bad ID");
    cronJobSettingsElement.innerHTML = `<pre>Enabled: ${cronJobSettings.enabled}</pre><pre>Interval: ${cronJobSettings.interval} minutes.</pre>`;
    // Update Cron Job Checkboxes
    const cronJobNamesToIDs: Map<keyof CronJobSettings, string> = new Map([
        [kImportingJob, "importAlbumsToggle"], [kUpdatingStaleAlbumsJob, "updateStaleAlbumsToggle"], [kFilteringSpotifyLibraryJob, "filterSpotifyLibraryToggle"]
    ])
    cronJobNamesToIDs.forEach((id, cronJobName) => {
        const checkbox = (document.getElementById(id) as HTMLInputElement) ?? assert.fail("Bad ID");
        if (hasOwnProperty(cronJobSettings, cronJobName)) {
            checkbox.checked = cronJobSettings[cronJobName] as boolean;
        }
    })
}

// Helper function for doing type narrowing on an object's keys
// see: https://fettblog.eu/typescript-hasownproperty/ 
// and https://dev.to/mapleleaf/indexing-objects-in-typescript-1cgi#comment-m263
function hasOwnProperty<O extends object, K extends PropertyKey>(
    obj: O,
    key: K,
): obj is O & Record<K, unknown> {
    return Object.prototype.hasOwnProperty.call(obj, key);
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
    await Promise.all([showToken(), showAlbums(), updateCronJobSettings()]);
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

// Updating stale albums
const updateStaleAlbumsButton = document.getElementById("updateStaleAlbumsButton") ?? assert.fail("Bad ID");
updateStaleAlbumsButton.onclick = async () => {
    const originalButtonText = updateStaleAlbumsButton.textContent;
    const updateStaleAlbumResponse = fetch("/updateStaleAlbums", { method: "POST" });
    updateStaleAlbumsButton.textContent = "Updating...";
    await updateStaleAlbumResponse;
    await updatePage();
    updateStaleAlbumsButton.textContent = originalButtonText;
}

// Filtering Spotify Library
const filterSpotifyLibraryButton = document.getElementById("filterSpotifyLibraryButton") ?? assert.fail("Bad ID");
filterSpotifyLibraryButton.onclick = async () => {
    const originalButtonText = filterSpotifyLibraryButton.textContent;
    const filterSpotifyLibraryResponse = fetch("/filterSpotifyLibrary", { method: "POST" });
    filterSpotifyLibraryButton.textContent = "Filtering...";
    await filterSpotifyLibraryResponse;
    await updatePage();
    filterSpotifyLibraryButton.textContent = originalButtonText;
}

const backfillNotionDatabasePropertiesButton = document.getElementById("backfillNotionDatabasePropertiesButton") ?? assert.fail("Bad ID");
backfillNotionDatabasePropertiesButton.onclick = async () => {
    // TODO: Abstract this logic out into a factory function.
    const originalButtonText = backfillNotionDatabasePropertiesButton.textContent;
    const backfillNotionDatabasePropertiesResponse = fetch("/backfillNotionDatabaseProperties", { method: "POST" });
    backfillNotionDatabasePropertiesButton.textContent = "Backfilling...";
    await backfillNotionDatabasePropertiesResponse;
    await updatePage();
    backfillNotionDatabasePropertiesButton.textContent = originalButtonText;
}

// Buttons for starting/stopping importing Cron Job
const importJobStartButton = document.getElementById("startImportingJob") ?? assert.fail("Bad ID");
importJobStartButton.onclick = async () => {
    await fetch("/startCronJob", { method: "POST" });
    await updateCronJobSettings();
}
const importJobStopButton = document.getElementById("stopImportingJob") ?? assert.fail("Bad ID");
importJobStopButton.onclick = async () => {
    await fetch("/stopCronJob", { method: "POST" });
    await updateCronJobSettings();
}

// Send post request to "/signout" when signout button is clicked
const signoutButton = document.getElementById("signoutButton") ?? assert.fail("Bad ID");
signoutButton.onclick = async () => {
    await fetch("/signout", { method: "POST" });
    await updatePage();
}

// TODO: add dropdown funtionality to use for colum picking. Get columns using the notion SDK and database ID.