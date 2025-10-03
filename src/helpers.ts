import { isFullPage } from "@notionhq/client";
import { PageObjectResponse, QueryDatabaseResponse, RichTextItemResponse } from "@notionhq/client/build/src/api-endpoints";
import { Album, SimplifiedTrack, SpotifyApi } from "@spotify/web-api-ts-sdk";
import { strict as assert } from "assert";
import { strict } from 'assert';
import { DateTime } from 'luxon';
import { main } from "./jobs";
import { GenreConversionModel, isForwardGenreConversionRule, SpotifyAlbumType, spotifyChunkSizeLimit, testMatchable } from "./defs";

const albumArt = require("album-art");
/**
 * Turn a date object into a standard format string.
 * @param date Date object.
 * @returns A string of the date in `date` formatted in the "Weekday, Month Day, Hour:Minute:Second AM/PM TimeZone" format.
 */
export function standardFormatDate(date: DateTime<boolean>): string {
    return date.toLocaleString(
        {
            weekday: 'short', month: 'short',
            day: '2-digit', hour: '2-digit',
            minute: '2-digit', second: '2-digit',
            timeZoneName: 'short'
        });
}

/**
 * Chunk an array.
 * 
 * @param array Array to chunk.
 * @param chunkSize Size of each chunk. Each chunk is guaranteed to be at least this size.
 * @returns Array split into chunks of size <= chunkSize.
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

/**
 * Intersect two arrays.
 * 
 * @param a First array.
 * @param b Second array.
 * @returns Intersection between a and b. Equality between elements is compared objectively (i.e. with ===).
 */
export function arrayIntersect<T>(a: T[], b: T[]): T[] {
    const bSet = new Set(b);
    return a.filter(x => bSet.has(x));
}

/**
 * Subtract two arrays.
 * 
 * @param a First array.
 * @param b Second array.
 * @returns Difference a - b. Equality between elements is compared objectively (i.e. with ===).
 */
export function arrayDifference<T>(a: T[], b: T[]): T[] {
    const bSet = new Set(b);
    return a.filter(x => !bSet.has(x));
}

/**
 * Union two arrays.
 * 
 * @param a First array.
 * @param b Second array.
 * @returns Union between a and b. Equality between elements is compared objectively (i.e. with ===).
 */
export function arrayUnion<T>(a: T[], b: T[]): T[] {
    return Array.from(new Set([...a, ...b]));
}
/**
 * Gets rich text field contents for `propertyName `from `page`.
 *
 * @param page Page to query property from
 * @param propertyName Property Name to Query from `page`
 * @returns Rich Text Item array from `page`'s rich text field called `propertyName`.
 * @throws AssertionError if `page` has no property called `propertyName`, or `propertyName` is not a rich text field.
 */
export function getRichTextField(page: PageObjectResponse, propertyName: string): RichTextItemResponse[] {
    const richTextProperty = page.properties[propertyName] ?? assert.fail();
    assert(
        richTextProperty.type === "rich_text",
        `Property ${propertyName} is not a rich_text type.`
    );
    return richTextProperty.rich_text;
}
/**
 * Gets title contents for `propertyName `from `page`.
 *
 * @param page Page to query property from
 * @param propertyName Property Name to Query from `page`
 * @returns Rich Text Item array from `page`'s title field called `propertyName`.
 * @throws AssertionError if `page` has no property called `propertyName`, or `propertyName` is not a title field.
 */
export function getTitleField(page: PageObjectResponse, propertyName: string): RichTextItemResponse[] {
    const titleProperty = page.properties[propertyName] ?? assert.fail();
    assert(
        titleProperty.type === "title",
        `Property ${propertyName} is not title type.`
    );
    return titleProperty.title;
}
/**
 * Gets content of a rich text property from a Notion database page as a string.
 *
 * @param page Page to get query `propertyName` from.
 * @param propertyName Property name to query from `page`.
 * @returns string representing the pure text content without any styling information from
 * the rich text column titled `propertyName` in `page`.
 * @throws AssertionError if `page` has no property called `propertyName`, or `propertyName` is not a rich text field.
 */
export function getRichTextFieldAsString(page: PageObjectResponse, propertyName: string): string {
    return getFullPlainText(getRichTextField(page, propertyName));
}
/**
 * Gets content of a title property from a Notion database page as a string.
 *
 * @param page Page to get query `propertyName` from.
 * @param propertyName Property name to query from `page`.
 * @returns string representing the pure text content from  the title column titled `propertyName` in `page`.
 * @throws AssertionError if `page` has no property called `propertyName`, or `propertyName` is not a title field.
 */
export function getTitleFieldAsString(page: PageObjectResponse, propertyName: string): string {
    return getFullPlainText(getTitleField(page, propertyName));
}
/**
 * Gets number contents for `propertyName `from `page`.
 *
 * @param page Page to query property from
 * @param propertyName Property Name to Query from `page`
 * @returns Number from `page`'s number field called `propertyName`, or undefined if `propertyName` is empty in `page`.
 * @throws AssertionError if `page` has no property called `propertyName`, or `propertyName` is not a number field.
 */
export function getNumberField(page: PageObjectResponse, propertyName: string): number | undefined {
    const numberProperty = page.properties[propertyName] ?? assert.fail();
    assert(
        numberProperty.type === "number",
        `Property ${propertyName} is not title type.`
    );

    return numberProperty.number ?? undefined;
}
/**
 * Gets URL contents for `propertyName `from `page`.
 *
 * @param page Page to query property from
 * @param propertyName Property Name to Query from `page`
 * @returns URL from `page`'s URL field called `propertyName`, or the empty string if `propertyName` is empty in `page`.
 * @throws AssertionError if `page` has no property called `propertyName`, or `propertyName` is not a URL field.
 */
export function getURLFieldAsString(page: PageObjectResponse, propertyName: string): string {
    const urlProperty = page.properties[propertyName] ?? assert.fail();
    assert(
        urlProperty.type === "url",
        `Property ${propertyName} is not title type.`
    );

    return urlProperty.url ?? "";
}
/**
 * Gets select field contents from `propertyName` from `page`.
 *
 * @param page Page to query `propertyName` from.
 * @param propertyName Property Name to query from `page`.
 * @returns String representing the name of the select field in `page`'s select field called `propertyName`,
 *  or undefined if `propertyName` is empty in `page`.
 * @throws AssertionError if `page` has no property called `propertyName`, or `propertyName` is not a select field.
 */
export function getSelectFieldAsString(page: PageObjectResponse, propertyName: string): string | undefined {
    const selectProperty = page.properties[propertyName] ?? assert.fail();
    assert(
        selectProperty.type === "select",
        `Property ${propertyName} is not select type.`
    );
    if (selectProperty.select === null) {
        return undefined;
    }
    return selectProperty.select.name;
}
/**
 * Gets the boolean formula field contents of `propertyName` from `page`.
 * If the formula has a boolean return type but has no boolean data, it's automatically treated as false.
 *
 * @param page Page to query property from
 * @param propertyName Property Name to query from `page`.
 * @return boolean value associated with the formula's output on `page`.
 */
// TODO: if I want to try to make this more general and return any sub-type of a formula propery, I could edit the function to use conditional types:
// see https://stackoverflow.com/questions/54165536/typescript-function-return-type-based-on-input-parameter
export function getFormulaPropertyAsBoolean(page: PageObjectResponse, propertyName: string): boolean {
    const formulaProperty = page.properties[propertyName] ?? assert.fail();
    assert(formulaProperty.type === "formula", `Property ${propertyName} is not formula type.`);

    const innerFormulaValue = formulaProperty.formula;
    assert(innerFormulaValue.type === "boolean", `Property ${propertyName} is not boolean type.`);

    return innerFormulaValue.boolean ?? false;
}
/**
 * Make a string from a list of album IDs.
 *
 * @param albumIDs Array of album IDs to join together
 * @param [delim=","] Delimiter to use when parsing album IDs from Notion pages. Defaults to ','.
 * @returns string joining all albumIDs in order using the given delimeter.
 */
export function makeStringFromAlbumIDs(albumIDs: string[], delim = ","): string {
    return albumIDs.join(", ");
}
/**
 * Gets the Spotify Album IDs corresponding to a Notion Page.
 *
 * @param page Page to query `propertyName` from.
 * @param propertyName Property Name to query from `page`.
 * @param delim Delimiter to use when parsing album IDs from Notion pages. Defaults to ','.
 */
export function getSpotifyAlbumIDsFromNotionPage(page: PageObjectResponse, propertyName: string, delim = ","): string[] {
    const albumIDs = getRichTextFieldAsString(page, propertyName);
    return albumIDs.split(delim).map(id => id.trim());
}
/**
 * Gets the full list of pages from a notion database query response, performing
 * type narrowing on the passed in QueryDatabaseResponse to a list of PageObjectResponses.
 *
 * @param response Response from Notion Client
 * @returns list of page responses from `response`.
 * @throws AssertionError if any of the pages aren't full responses.
 */
export function getFullPages(response: QueryDatabaseResponse): PageObjectResponse[] {
    return response.results.map(fullOrPartialPage => isFullPage(fullOrPartialPage) ? fullOrPartialPage : assert.fail('Non-Full Page Responses'));
}
/**
 * Gets a link to the album artwork for `artist`'s album `album`.
 * NOTE: This function really should only be used if you can't do a direct call to the Spotify API, as album artwork
 * can be very finicky and can be very easily incorrect.
 *
 * @param artist Artist who created the album
 * @param album Album to get artwork from
 * @returns link to album artwork associated with `album` (probably)
 */
export async function getAlbumArtwork(artist: string, album: string): Promise<string> {
    // TODO: Replace with direct call to spotify API
    const options = {
        album: album
    };

    return albumArt(artist, options);
}
/**
 * Gets the full plain_text from the given rich text list.
 * @param richText
 * @returns the full plain text of the rich text list, done by concatenating the plain text from
 * each rich text element together
 */
export function getFullPlainText(richText: RichTextItemResponse[]): string {
    return richText.reduce((prevText, textItem) => prevText + textItem.plain_text, "");
}
/**
 * Constructs a basic Notion Text Content block from a single string field.
 * @param content Content to put in the text content block
 * @returns the constructed text content block object with no additional styling.
 */
export function constructNotionTextContentBlock(content: string): {
    type: "text";
    text: {
        content: string;
    };
} {
    return {
        type: "text",
        text: {
            content: content
        }
    };
}
/**
 * Construct a string with the artists of an album.
 * @param album a Spotify Album object.
 * @returns string of the artists in an album with ", " as a separator.
 */
export function getArtistStringFromAlbum(album: Album) {
    const artistNames = album.artists.map((artist) => artist.name);
    return artistNames.join(", ");
}
/**
 * Creates an album key from its artist and name properties to be used for hashing.
 *
 * @param albumName Name of album.
 * @param albumArtist Artist(s) of album.
 * @returns String joining the trimmed and lowercased album name and artist in the format
 * "{albumName} - {albumArtist}".
 */
export function createAlbumKey(albumName: string, albumArtist: string) {
    // TODO: issue with hashing if the artists are written slightly differently between the same albums (i.e. in the wrong order).
    return `${albumName.trim().toLowerCase()} - ${albumArtist.trim().toLowerCase()}`;
}
/**
 * Creates an album key from a saved spotify album
 *
 * @param album Spotify album to create key from.
 * @returns String joining the trimmed and lowercased album name and artist in the format
 * "{albumName} - {albumArtist}".
 */
export function createAlbumKeyFromSpotifyAlbum(album: Album) {
    return createAlbumKey(
        album.name,
        getArtistStringFromAlbum(album)
    );
}

/**
 * Gets the total runtime of a spotify Album in milliseconds. 
 * Note that this is not fully accurate for longer albums that have more tracks than can fit in a single page of the Spotify Api.
 * 
 * @param album Album to get runtime from.
 * @returns length of Album in milliseconds.
 */
function getFastAlbumRuntime(album: Album): number {
    return album.tracks.items.reduce((prev, current) => current.duration_ms + prev, 0)
}

/**
 * Determines the type of an Album based on its runtime and number of tracks.
 * 
 * @param album Album to determine type of
 * @returns Enum value corresponding to the type of `album`.
 */
export function determineAlbumType(album: Album): SpotifyAlbumType {
    // If the album isn't classified as a 'single', it's an album.
    const albumType = album.album_type
    if (albumType === "album" || albumType === "compilation") {
        return SpotifyAlbumType.ALBUM
    }

    // Now, test if the album is an EP or not, going by these rules:
    // The release has four to six (4-6) tracks.
    // The release is under 30 minutes in duration.
    // From https://community.spotify.com/t5/Spotify-for-Developers/How-to-tell-if-a-release-is-an-EP/m-p/5328488/highlight/true#M3942
    const maxEPLen = 30 * 60 * 1000 // milliseconds
    const minEPTracks = 4
    const maxEPTracks = 6
    if ((album.total_tracks >= minEPTracks && album.total_tracks <= maxEPTracks)
        && getFastAlbumRuntime(album) <= maxEPLen) {
        return SpotifyAlbumType.EP
    }

    return SpotifyAlbumType.SINGLE
}

/**
 * Gets all tracks from a Spotify Album, accounting for pagination limitations of Spotify API.
 * @param album Album to get all tracks from.
 * @param spotify SpotifyApi instance to use to get all tracks.
 * @returns SimplifiedTrack[]
 */
export async function getAllAlbumTracks(album: Album, spotify: SpotifyApi): Promise<SimplifiedTrack[]> {
    const totalTracks = album.total_tracks
    // Simple if we know the album has only one page of tracks
    if (totalTracks === album.tracks.total) {
        return album.tracks.items
    }

    // Ingest all album tracks by requesting as many as it takes until we're at the limit
    const trackPagePromises: Promise<SimplifiedTrack[]>[] = []
    for (let i = 0; i < Math.ceil(totalTracks / spotifyChunkSizeLimit); i++) {
        trackPagePromises.push(spotify.albums.tracks(album.id, undefined, spotifyChunkSizeLimit, i * spotifyChunkSizeLimit)
            .then(page => page.items));
    }

    return (await Promise.all(trackPagePromises)).flat()
}
export async function getAlbumDuration(album: Album, spotify: SpotifyApi) {
    return (await getAllAlbumTracks(album, spotify)).reduce((duration, track) => duration + track.duration_ms, 0);
}

export async function getAllArtistGenresFromAlbum(album: Album, spotify: SpotifyApi): Promise<string[]> {
    // TODO: Handle complex case where we're trying to infer the genre of a compliation album (written by "Various Artists").
    // Would likely involve iterating through all songs and getting those artists (but even then the genres might be too broad).
    if (album.album_type === "compilation") {
        return []
    }

    // Get all artists on the album and get their information
    const artistIDs = album.artists.map(artist => artist.id)
    const albumArtists = await Promise.all(artistIDs.map(artistID => spotify.artists.get(artistID)))

    // Get all our artists genres, flatten, then deduplicate.
    const allArtistGenres = albumArtists.flatMap(artist => artist.genres)
    return Array.from(new Set(allArtistGenres))
}

export function convertSpotifyGenresIntoNotionGenres(genres: string[], conversionModel?: Readonly<GenreConversionModel>): string[] {
    // The absence of a rules object means everything passes through like normal.
    if (conversionModel === undefined) {
        return genres;
    }

    // Use rules object to test all produced spotify genres.
    const inferredNotionGenres: Set<string> = new Set()

    for (const spotifyGenre of genres) {
        for (const expression of conversionModel.expressions) {
            if (isForwardGenreConversionRule(expression)) {
                // One spotify matchable -> Many notion genres, so add all of them
                if (testMatchable(expression.spotifyGenre, spotifyGenre)) {
                    expression.notionGenres.forEach(notionGenre => inferredNotionGenres.add(notionGenre))
                }
            }

            else {
                // Many spotify genre matchables -> One notion genre, so test all of them
                if (expression.spotifyGenres.some(matchable => testMatchable(matchable, spotifyGenre))) {
                    inferredNotionGenres.add(expression.notionGenre)
                }
            }
        }
    }
    return Array.from(inferredNotionGenres)
}

export async function getNotionGenresFromAlbum(album: Album, spotify: SpotifyApi,
    conversionModel?: Readonly<GenreConversionModel>): Promise<string[]> {
    return convertSpotifyGenresIntoNotionGenres(
        await getAllArtistGenresFromAlbum(album, spotify), conversionModel)
}

export async function setSpotifyShuffleState(spotify: SpotifyApi, shuffle: boolean) {
    return querySpotifyEndpoint(spotify, "https://api.spotify.com/v1/me/player/shuffle", "PUT", {
        "state": shuffle
    })
}

/**
 * Queries a spotify endpoint with the given method and body.
 * @param spotify SpotifyApi object to use for authentication.
 * @param endpoint Endpoint to query.
 * @param method HTTP method to use (e.g. "PUT", "POST").
 * @param body Body of the request.
 */
export async function querySpotifyEndpoint(spotify: SpotifyApi, endpoint: string, method: string, query: Record<string, any> = {}, body?: Record<string, any>) {
    const spotifyToken = (await spotify.getAccessToken()) ?? assert.fail("No Spotify Token populated!")
    return fetch(endpoint + "?" + new URLSearchParams(query), {
        method: method,
        headers: {
            "Authorization": `${spotifyToken.token_type} ${spotifyToken.access_token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body)
    }
    )
}