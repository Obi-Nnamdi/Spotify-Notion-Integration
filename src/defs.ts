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

/**
 * Interface for Cron Job Settings.
 */
export interface CronJobSettings {
    enabled: boolean;
    [kImportingJob]: boolean;
    [kUpdatingStaleAlbumsJob]: boolean;
    interval: number;
    nextRun: string;
}