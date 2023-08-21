import { Client, collectPaginatedAPI, isFullDatabase, isFullPage } from "@notionhq/client";
import dotenv from "dotenv";
import { strict as assert } from 'assert';
import { PageObjectResponse, QueryDatabaseResponse, RichTextItemResponse, TextRichTextItemResponse } from "@notionhq/client/build/src/api-endpoints";
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import * as fs from 'node:fs/promises';
import { type } from "os";

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
// TODO: Add feature that "repairs" messed up entries that lack an artist.
// TODO: Auto-Populate Genres
// TODO: Add Album IDs
async function main() {
  // Get all pages in Album Database
  const albumDatabaseResponse = await notion.databases.query({
    database_id: process.env.DATABASE_ID ?? assert.fail("No Database ID"),
  });
  const databasePages = getFullPages(albumDatabaseResponse);

  // Update existing pages with album art for their respective albums
  // TODO: Generalize "Artist" and "Album Name" column names
  await updatePagesWithAlbumArt(
    databasePages,
    "Artist",
    "Album Name",
    /*Overwrite Existing Artwork = */ false,
    /*Output HTML = */ true
  );
}
/**
 * Updates databse pages in `databasePages` to have album art for each database with a non-empty artist.
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
