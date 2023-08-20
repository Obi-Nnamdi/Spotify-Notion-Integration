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
    const artistProperty = page.properties["Artist"] ?? assert.fail();
    assert(
      artistProperty.type === "rich_text",
      "Artist column name is not a rich_text type."
    );
    return getFullPlainText(artistProperty.rich_text) !== "";
  });

  // Get album artwork for each database

  // Concurrently get all artwork
  const pageArtwork = await Promise.all(
    validDatabasePages.map(async (page) => {
      const artistProperty = page.properties["Artist"] ?? assert.fail();
      const albumNameProperty = page.properties["Album Name"] ?? assert.fail();
      assert(
        artistProperty.type === "rich_text",
        "Artist column name is not a rich_text type."
      );
      assert(
        albumNameProperty.type === "title",
        "Album Name column is not a title type."
      );

      const artistText = getFullPlainText(artistProperty.rich_text);
      const albumText = getFullPlainText(albumNameProperty.title);
      return getAlbumArtwork(artistText, albumText);
    })
  );

  // Construct HTML output
  const HTMLOutput = validDatabasePages.reduce((prevString, page, index) => {
    const artistProperty = page.properties["Artist"] ?? assert.fail();
    const albumNameProperty = page.properties["Album Name"] ?? assert.fail();
    assert(
      artistProperty.type === "rich_text",
      "Artist column name is not a rich_text type."
    );
    assert(
      albumNameProperty.type === "title",
      "Album Name column is not a title type."
    );
    const albumArtURL: string = pageArtwork[index] ?? assert.fail();

    return (
      prevString +
      `Album "${getFullPlainText(
        albumNameProperty.title
      )}" made by "${getFullPlainText(
        artistProperty.rich_text
      )}" has artwork <img src="${albumArtURL}"><br>`
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
