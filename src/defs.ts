/**
 * Interface for Spotify Albums sent from the backend to frontend
 */
export interface SpotifyAlbum {
    name: string;
    artists: string[];
    cover_url: string;
    url: string;
}