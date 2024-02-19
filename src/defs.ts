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