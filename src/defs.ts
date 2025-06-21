/**
 * Interface for Spotify Albums sent from the backend to frontend
 */
export interface SpotifyAlbum {
    name: string;
    artists: string[];
    cover_url: string;
    url: string;
}

//  Cron Job Globals
export const kImportingJob = "importAlbums";
export const kUpdatingStaleAlbumsJob = "updateStaleAlbums";
export const kFilteringSpotifyLibraryJob = "filterSpotifyLibrary";

/**
 * Interface for Cron Job Settings.
 */
export interface CronJobSettings {
    enabled: boolean;
    [kImportingJob]: boolean;
    [kUpdatingStaleAlbumsJob]: boolean;
    [kFilteringSpotifyLibraryJob]: boolean;
    interval: number;
    nextRun: string;
}

// Spotify API globals
export const spotifyChunkSizeLimit = 20; // max chunk size for most spotify API endpoints

// Enum for the different types of "album" in the spotify interface.
// NOTE: "compliation" isn't here since it's a bit of a gray area and spotify helps us out there anyways.
export enum SpotifyAlbumType {
    ALBUM, EP, SINGLE
}

// Type for specifying what types of columns are supported in the app.
export type NotionAlbumDBColumnNames = {
    name: string // - Note: Should be Title Column.
    artist: string
    spotifyId: string
    url: string
    genre: string
    dateDiscovered: string
    duration: string
    includeInSpotify?: string
}

// Types for specifying conversion rules for Spotify Genres to Notion Genres
type Matchable = string | RegExp;

// Turns a matched spotify genre into a list of notion Genres
type ForwardGenreConversionRule = {
    spotifyGenre: Matchable
    notionGenres: string[]
}

// Turns all matched spotify genres into a single notion Genre (slightly redundant with Regex)
type BackwardGenreConversionRule = {
    notionGenre: string
    spotifyGenres: Matchable[]
}

type GenreConversionRule = ForwardGenreConversionRule | BackwardGenreConversionRule;
export type GenreConversionModel = {
    expressions: GenreConversionRule[]
}

/**
 * Narrows a GenreConversionRule to a ForwardGenreConversionRule or BackwardGenreConversionRule
 * @param rule 
 */
export function isForwardGenreConversionRule(rule: GenreConversionRule): rule is ForwardGenreConversionRule {
    return (rule as ForwardGenreConversionRule).spotifyGenre !== undefined;
}

/**
 * Convienience function to test a matchable on a string.
 * @param matchable Matchable to test on a string
 * @param string String to be tested on
 * @returns True if a direct match (string) or a regex match (regex).
 */
export function testMatchable(matchable: Matchable, string: string): boolean {
    if (typeof matchable === "string") {
        return matchable.trim().toLowerCase() === string.toLowerCase();
    }
    return matchable.test(string);
}

export const defaultGenreConversionModel: GenreConversionModel = {
    expressions: [
        {
            spotifyGenre: /ambient/gmi,
            notionGenres: ["Ambient", "Chill"] // Usually go hand in hand
        },
        {
            spotifyGenre: /chill/gmi,
            notionGenres: ["Chill"]
        },
        {
            spotifyGenre: /classical/gmi,
            notionGenres: ["Classical", "Instrumental"]
        },
        {
            // Usually a good guess that rock / pop will have lyrics.
            spotifyGenre: /rock/gmi,
            notionGenres: ["Rock", "Singer"]
        },
        {
            spotifyGenre: /pop/gmi,
            notionGenres: ["Pop", "Singer"]
        },
        {
            spotifyGenre: /electronic/gmi,
            notionGenres: ["Electronic"]
        },
        {
            spotifyGenre: /vgm/gmi,
            notionGenres: ["Video Game Music"]
        },
        {
            spotifyGenre: /jazz/gmi,
            notionGenres: ["Jazz", "Instrumental"] // Instrumnetal is (usually) a good guess
        },
        {
            spotifyGenre: /smooth jazz/gmi,
            notionGenres: ["Smooth Jazz"]
        },
        {
            spotifyGenre: /fusion/gmi,
            notionGenres: ["Fusion"]
        },
        {
            spotifyGenre: /guitar/gmi,
            notionGenres: ["Guitar"]
        },
        {
            spotifyGenre: /funk/gmi,
            notionGenres: ["Funk"]
        },
        {
            spotifyGenre: /disco/gmi,
            notionGenres: ["Disco"]
        },
        {
            spotifyGenre: /movie/gmi,
            notionGenres: ["Movie Soundtrack"]
        },
        {
            spotifyGenre: /\wwave/gmi,
            notionGenres: ["Vaporwave"]
        },
        {
            spotifyGenre: /R&B/gmi,
            notionGenres: ["R&B"]
        },
        {
            spotifyGenre: /Latin/gmi,
            notionGenres: ["Latin"]
        },
        {
            spotifyGenre: /Soul/gmi,
            notionGenres: ["Soul"]
        },
        {
            spotifyGenre: /Lo-?fi/gmi,
            notionGenres: ["Lo-Fi"]
        },
        {
            spotifyGenre: /Instrumental/gmi,
            notionGenres: ["Instrumental"]
        },
        {
            notionGenre: "Hip Hop",
            spotifyGenres: [/Hip hop/gmi, /rap/gmi]
        },
        {
            notionGenre: "Beats",
            spotifyGenres: [/beats/gmi]
        },
        {
            spotifyGenre: /metal|grunge/gmi,
            notionGenres: ["Metal", "Rock", "Singer"]
        },
        {
            spotifyGenre: "Trip Hop",
            notionGenres: ["Beats", "Trip Hop"] // I find that Trip Hop labeled stuff is usually not as lyrical
        }
    ]
}