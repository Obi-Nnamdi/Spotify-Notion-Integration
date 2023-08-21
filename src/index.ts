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
async function main() {
  const albumDatabaseResponse = await notion.databases.query({
    database_id: process.env.DATABASE_ID ?? assert.fail("No Database ID"),
  });

  const databasePages = getFullPages(albumDatabaseResponse);
  // Only use databse entries that have a non-empty artist value (for now)
  const validDatabasePages = databasePages.filter((page) => {
    const artistProperty = getRichTextField(page, "Artist");
    return getFullPlainText(artistProperty) !== "";
  });

  // Get album artwork for each database

  // Concurrently get all artwork
  const pageArtwork = await Promise.all(
    validDatabasePages.map(async (page) => {
      // Get text for artist and album name property
      // TODO: Generalize "Artist" and "Album Name" column names
      const artistText = getFullPlainText(getRichTextField(page, "Artist"));
      const albumText = getFullPlainText(getTitleField(page, "Album Name"));
      return getAlbumArtwork(artistText, albumText);
    })
  );

  // Construct HTML output
  const HTMLOutput = validDatabasePages.reduce((prevString, page, index) => {
    const artistText = getFullPlainText(getRichTextField(page, "Artist"));
    const albumText = getFullPlainText(getTitleField(page, "Album Name"));
    const albumArtURL: string = pageArtwork[index] ?? assert.fail();

    return (
      prevString +
      `Album "${albumText}" made by "${artistText}" has artwork <img src="${albumArtURL}"><br>`
    );
  }, "");

  await fs.writeFile("output/album_art_list.html", HTMLOutput);

  // Update the icon and cover of each valid page to be its album artwork
  await Promise.all(validDatabasePages.map(async (page, index) => {
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
  }));
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
