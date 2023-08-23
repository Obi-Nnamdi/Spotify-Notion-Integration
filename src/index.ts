import { Client, collectPaginatedAPI, isFullDatabase, isFullPage } from "@notionhq/client";
import dotenv from "dotenv";
import { strict as assert } from 'assert';
import { PageObjectResponse, QueryDatabaseResponse, RichTextItemResponse, TextRichTextItemResponse } from "@notionhq/client/build/src/api-endpoints";
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import * as fs from 'node:fs/promises';
import { type } from "os";
import AlbumsEndpoints from "@spotify/web-api-ts-sdk/dist/mjs/endpoints/AlbumsEndpoints";
import { url } from "inspector";

dotenv.config();

// API Clients
const albumArt = require('album-art');
const spotify = SpotifyApi.withClientCredentials(
  process.env.SPOTIFY_CLIENT_ID ?? assert.fail("No Spotify Client ID"),
  process.env.SPOTIFY_CLIENT_SECRET ?? assert.fail("No Spotify Client Secret")
);
const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// TODO: Abstract out into other files
// TODO: Add other features, like auto-populating artists of albums
// TODO: Auto-Populate DB From "Saved Albums" page
// TODO: Auto-Populate Genres
// TODO: Add Album IDs and Album URL
// TODO: Create "main" file and choose what to run there.
async function main() {
  // Get all pages in Album Database
  const databaseID = process.env.DATABASE_ID ?? assert.fail("No Database ID");
  let databasePages = await getAllDatabasePages(databaseID);
  const artistColumn = "Artist";
  const albumNameColumn = "Album Name";
  const albumIdColumn = "Album ID";
  const albumURLColumn = "URL";

  // Infer artists from albums without any artists
  await inferArtistsFromAlbums(databasePages, artistColumn, albumNameColumn);

  // Refresh all Database Page Info Now
  databasePages = await getAllDatabasePages(databaseID);

  // Update Album Ids for each entry
  await inferAlbumIDs(databasePages, artistColumn, albumNameColumn, albumIdColumn, albumURLColumn)

  // Update existing pages with album art for their respective albums
  // TODO: Once Album IDs are working, stop using the album name and use the spotify API straight up
  // TODO: Generalize "Artist" and "Album Name" column names
  await updatePagesWithAlbumArt(
    databasePages,
    artistColumn,
    albumNameColumn,
    /*Overwrite Existing Artwork = */ false,
    /*Output HTML = */ true
  );
}

/**
 * Get all database pages from a Notion Database.
 * 
 * @param database_id Notion Database ID of database to query
 * @returns list of all database pages from `database_id` by querying Notion API
 */
async function getAllDatabasePages(database_id: string): Promise<PageObjectResponse[]> {
  const albumDatabaseResponse = await notion.databases.query({
    database_id: database_id,
  });
  const databasePages = getFullPages(albumDatabaseResponse);
  return databasePages;
}

/**
 * Updates Notion database pages without a filled Artist Column with an inferred artist based on the Album Name.
 * 
 * @param databasePages List of Database Pages to update.
 * @param artistColumn Name of property in `databasePages` that stores artist information. Should be a "rich text" type. 
 * @param albumNameColumn Name of property in `databasePages` that stores album name information. Should be a "title" type.
 * @param consoleOutput controls whether list of inferred artist names are printed to console.
 * @throws Error if either of `artistColumn` or `albumNameColumn` are invalid property names in `databasePages`.
 */
async function inferArtistsFromAlbums(
  databasePages: PageObjectResponse[],
  artistColumn: string,
  albumNameColumn: string,
  consoleOutput: boolean = true
): Promise<void> {
  // Only use pages that have no artist
  const pagesToUpdate = databasePages.filter((page) => {
    const artistProperty = getRichTextField(page, artistColumn);
    return getFullPlainText(artistProperty) === ""; // does the page not have an artist?
  });

  // Use Spotify API to infer artist name and update it in Notion.
  await Promise.all(
    pagesToUpdate.map(async (page) => {
      // Search spotify for "albumName" and get its first response
      const albumName = getFullPlainText(getTitleField(page, albumNameColumn));
      const spotifyResponse = await spotify.search(
        albumName,
        ["album"],
        /* Market = */ undefined,
        /* Limit = */ 1
      );
      const inferredAlbum =
        spotifyResponse.albums.items[0] ??
        assert.fail("Bad Spotify API Response");

      // Spotify gives us a list of artists who made the album, so we join them with commas to update Notion.
      const artistNames = inferredAlbum.artists.map((artist) => artist.name);
      const artistText = artistNames.join(", ");

      if (consoleOutput) {
        console.log(`Album "${albumName}" has inferred artist "${artistText}"`);
      }

      // Update Notion page with inferred artist name
      await notion.pages.update({
        page_id: page.id,
        properties: {
          // Update `artistColumn` with updated artist text
          [artistColumn]: {
            type: "rich_text",
            rich_text: [{
              text: {
                content: artistText
              }
            }]
          }
        }
      });
    })
  );
}

/**
 * Updates Notion database pages without a filled artist_id with an inferred artist_id based on the album information.
 * Creates a new column housing artist_id and url information for all elements without valid artist_ids.
 * 
 * @param databasePages List of Database Pages to update.
 * @param artistColumn Name of property in `databasePages` that stores artist information. Should be a "rich text" type. 
 * @param albumNameColumn Name of property in `databasePages` that stores album name information. Should be a "title" type.
 * @param albumIdColumn Name of property in `databasePages` that stores album id information.
 * @param albumURLColumn Name of property in `databasePages` that stores album URL information.
 * @param consoleOutput controls whether list of inferred artist names are printed to console.
 * @throws Error if either of `artistColumn` or `albumNameColumn` are invalid property names in `databasePages`.
 */
async function inferAlbumIDs(
  databasePages: PageObjectResponse[],
  artistColumn: string,
  albumNameColumn: string,
  albumIdColumn: string,
  albumURLColumn: string,
  consoleOutput: boolean = true
): Promise<void> {
  const database_properties = (await notion.databases.retrieve({
    database_id: process.env.DATABASE_ID ?? assert.fail("No Database ID")
  })).properties;

  // Do we have an albumIdColumn? Add one to the notion database if not.
  if (database_properties[albumIdColumn] === undefined) {
    await notion.databases.update({
      database_id: process.env.DATABASE_ID ?? assert.fail("No Database ID"),
      properties: {
        [albumIdColumn]: {
          type: "rich_text",
          rich_text: {}
        }
      }
    })
    if (consoleOutput) {
      console.log("Added Album Id Column.")
    }
  }

  //...likewise for the album URL Column.
  if (database_properties[albumURLColumn] === undefined) {
    await notion.databases.update({
      database_id: process.env.DATABASE_ID ?? assert.fail("No Database ID"),
      properties: {
        [albumURLColumn]: {
          type: "url",
          url: {}
        }
      }
    })
    if (consoleOutput) {
      console.log("Added Album Url Column.")
    }
  }

  // Only update pages that have no album id.
  const pagesToUpdate =
    // If we have an album id column, only do inference on pages missing an album id 
    database_properties[albumIdColumn] !== undefined
      ? databasePages.filter((page) => {
        const albumIdProperty = getRichTextField(page, albumIdColumn);
        return getFullPlainText(albumIdProperty) === "";
      })
      // if we don't have an album id column, populate everything.
      : databasePages;

  // Use Spotify API to get album ID and album URL
  await Promise.all(
    pagesToUpdate.map(async (page) => {
      // Search spotify for "albumName" and get its first response
      const albumName = getFullPlainText(getTitleField(page, albumNameColumn));
      const artistName = getFullPlainText(getRichTextField(page, artistColumn));
      const spotifyResponse = await spotify.search(
        `${albumName} - ${artistName}`, // Intentionally not using narrowing filters to account for human error in album documenting (i.e. if the artist/album name is misspelled)
        ["album"],
        /* Market = */ undefined,
        /* Limit = */ 1
      );
      const inferredAlbum =
        spotifyResponse.albums.items[0] ??
        assert.fail("Bad Spotify API Response");

      // Update Notion with the inferred album ID and URL.
      const albumID = inferredAlbum.id;
      const albumURL = inferredAlbum.external_urls.spotify;

      if (consoleOutput) {
        console.log(`Album "${albumName}" has id "${albumID} and URL ${albumURL}."`);
      }

      // Update Notion page with inferred artist name
      await notion.pages.update({
        page_id: page.id,
        properties: {
          // Update `artistColumn` with updated artist text
          [albumIdColumn]: {
            type: "rich_text",
            rich_text: [{
              text: {
                content: albumID
              }
            }]
          },
          [albumURLColumn]: {
            type: "url",
            url: albumURL
          },
        }
      });
    })
  );
}


/**
 * Updates Notion databse pages in `databasePages` to have album art for each database with a non-empty artist.
 * 
 * @param databasePages List of Database Pages to update.
 * @param artistColumn Name of property in `databasePages` that stores artist information. Should be a "rich text" type. 
 * @param albumNameColumn Name of property in `databasePages` that stores album name information. Should be a "title" type.
 * @param overwriteExistingArtwork Controls whether pages that already have both a cover and icon are potentially updated.
 * @param outputHTML Controls whether an HTML file in 'output' directory is produced with album artwork for each database page that's updated.
 * @throws Error if either of `artistColumn` or `albumNameColumn` are invalid property names in `databasePages`.
 */
async function updatePagesWithAlbumArt(
  databasePages: PageObjectResponse[],
  artistColumn: string,
  albumNameColumn: string,
  overwriteExistingArtwork: boolean = false,
  outputHTML: boolean = false
): Promise<void> {
  // Only use databse entries that have a non-empty artist value, and use the user's input on including pages with existing artwork.
  const validDatabasePages = databasePages.filter((page) => {
    const artistProperty = getRichTextField(page, artistColumn);
    const filled = page.cover !== null && page.icon !== null; // does the page have a cover or icon?
    const hasArtist = getFullPlainText(artistProperty) !== ""; // does the page have an artist?

    if (filled && overwriteExistingArtwork) {
      return hasArtist
    } else if (!filled) {
      return hasArtist
    } else {
      return false
    }
  });

  // Get album artwork for each database
  // Concurrently get all artwork
  const pageArtwork = await Promise.all(
    validDatabasePages.map(async (page) => {
      // Get text for artist and album name property
      const artistText = getFullPlainText(getRichTextField(page, artistColumn));
      const albumText = getFullPlainText(getTitleField(page, albumNameColumn));
      return getAlbumArtwork(artistText, albumText);
    })
  );

  // Construct HTML output
  if (outputHTML) {
    const HTMLOutput = validDatabasePages.reduce((prevString, page, index) => {
      const artistText = getFullPlainText(getRichTextField(page, artistColumn));
      const albumText = getFullPlainText(getTitleField(page, albumNameColumn));
      const albumArtURL: string = pageArtwork[index] ?? assert.fail();

      return (
        prevString +
        `Updated Album "${albumText}" made by "${artistText}" with artwork<br><img src="${albumArtURL}"><br>`
      );
    }, "");

    await fs.writeFile("output/album_art_list.html", HTMLOutput);
  }

  // Update the icon and cover of each valid page to be its album artwork
  await Promise.all(
    validDatabasePages.map(async (page, index) => {
      const albumArtURL: string = pageArtwork[index] ?? assert.fail();
      // Update each valid page
      return notion.pages.update({
        page_id: page.id,
        icon: {
          external: { url: albumArtURL },
          type: "external",
        },
        cover: {
          external: { url: albumArtURL },
          type: "external",
        },
      });
    })
  );
}

/**
 * Gets rich text field contents for `propertyName `from `page`.
 * 
 * @param page Page to query property from
 * @param propertyName Property Name to Query from `page`
 * @returns Rich Text Item array from `page`'s rich text field called `propertyName`.
 * @throws AssertionError if `page` has no property called `propertyName`, or `propertyName` is not a rich text field.
 */
function getRichTextField(page: PageObjectResponse, propertyName: string): RichTextItemResponse[] {
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
function getTitleField(page: PageObjectResponse, propertyName: string): RichTextItemResponse[] {
  const titleProperty = page.properties[propertyName] ?? assert.fail();
  assert(
    titleProperty.type === "title",
    `Property ${propertyName} is not title type.`
  );
  return titleProperty.title;
}

/**
 * Gets number contents for `propertyName `from `page`.
 * 
 * @param page Page to query property from
 * @param propertyName Property Name to Query from `page`
 * @returns Number from `page`'s number field called `propertyName`, or null if `propertyName` is empty in `page`.
 * @throws AssertionError if `page` has no property called `propertyName`, or `propertyName` is not a number field.
 */
function getNumberField(page: PageObjectResponse, propertyName: string): number | null {
  const numberProperty = page.properties[propertyName] ?? assert.fail();
  assert(
    numberProperty.type === "number",
    `Property ${propertyName} is not title type.`
  );
  return numberProperty.number;
}

/**
 * Gets the full list of pages from a notion database query response, performing
 * type narrowing on the passed in QueryDatabaseResponse to a list of PageObjectResponses.
 * 
 * @param response Response from Notion Client
 * @returns list of page responses from `response`.
 * @throws AssertionError if any of the pages aren't full responses.
 */
function getFullPages(response: QueryDatabaseResponse): PageObjectResponse[] {
  return response.results.map(fullOrPartialPage => isFullPage(fullOrPartialPage) ? fullOrPartialPage : assert.fail('Non-Full Page Responses'));
}

/**
 * Gets a link to the album artwork for `artist`'s album `album`.
 * 
 * @param artist Artist who created the album
 * @param album Album to get artwork from
 * @returns link to album artwork associated with `album` (probably)
 */
async function getAlbumArtwork(artist: string, album: string): Promise<string> {
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
function getFullPlainText(richText: RichTextItemResponse[]): string {
  return richText.reduce((prevText, textItem) => prevText + textItem.plain_text, "");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
