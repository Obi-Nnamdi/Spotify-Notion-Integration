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