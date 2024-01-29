import express, { Express, Request, Response, Application } from 'express';
import HttpStatus from 'http-status-codes';
import path from 'path';
import { Client, collectPaginatedAPI, isFullDatabase, isFullPage } from "@notionhq/client";
import dotenv from "dotenv";
import { strict as assert } from 'assert';
import { PageObjectResponse, QueryDatabaseResponse, RichTextItemResponse, TextRichTextItemResponse, CreatePageParameters } from "@notionhq/client/build/src/api-endpoints";
import { Album, SavedAlbum, SpotifyApi } from '@spotify/web-api-ts-sdk';
import * as fs from 'node:fs/promises';
import inquirer from 'inquirer';
import cliProgress from 'cli-progress';
import { type } from "os";
import AlbumsEndpoints from "@spotify/web-api-ts-sdk/dist/mjs/endpoints/AlbumsEndpoints";
import { url } from "inspector";

// For env File
dotenv.config();

// API Clients
const albumArt = require('album-art');
const spotifyScopes = ["user-library-read", "user-library-modify"];
const spotify = SpotifyApi.withClientCredentials(
  process.env.SPOTIFY_CLIENT_ID ?? assert.fail("No Spotify Client ID"),
  process.env.SPOTIFY_CLIENT_SECRET ?? assert.fail("No Spotify Client Secret"),
  spotifyScopes
);
// To get saved albums, use this:
// SpotifyApi.withUserAuthorization(process.env.SPOTIFY_CLIENT_ID ?? assert.fail("No Spotify Client ID"), "/populateToken", spotifyScopes);
const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// TODO: Abstract out into other files
// TODO: Add other features, like auto-populating artists of albums
// TODO: Auto-Populate DB From "Saved Albums" page
// TODO: Auto-Populate Genres
// TODO: Add Album IDs and Album URL
// TODO: Create "main" file and choose what to run there.
// TODO: Auto-remove albums with ratings of < 2.
async function main() {
  // Get all pages in Album Database
  const databaseID = process.env.DATABASE_ID ?? assert.fail("No Database ID");
  let databasePages = await getAllDatabasePages(databaseID);
  let artistColumn = "Artist";
  let albumNameColumn = "Album Name";
  let albumIdColumn = "Album ID";
  let albumURLColumn = "URL";
  let dateDiscoveredColumn = "Date Discovered";
  let albumRatingColumn = "Rating";
  let albumGenreColumn = "Genre";

  console.log(`Loaded ${databasePages.length} pages. Ready to run jobs.`);
  console.log("Welcome to the Notion Album Database importer job dashboard.");


  // TODO: Add progress bar? Might use CLI-Progress package.
  // TODO: Add info about what columns each job uses.
  // TODO: Add better error handling
  while (true) {
    const answers = await inquirer.prompt({
      type: "rawlist",
      name: "job",
      message: "What job would you like to run?",
      choices: [
        {
          name: "Refresh Database Pages",
          value: "refresh_database_pages",
        },
        {
          name: "Infer Artists From Album Names",
          value: "infer_artists"
        },
        {
          name: "Infer Album IDs",
          value: "infer_album_ids"
        },
        {
          name: "Update Pages With Album Art",
          value: "update_pages_with_album_art"
        },
        {
          name: "Remove Duplicate Albums By Album Properties",
          value: "remove_duplicate_albums_by_album_properties"
        },
        {
          name: "Change Column Names used by Jobs",
          value: "change_column_names" // TODO: create column name changing function.
        },
        {
          name: "Exit",
          value: "exit"
        }
      ]
    });
    if (answers.job === "refresh_database_pages") {
      console.log(`Refreshing pages...`);
      // TODO: add loading bar
      databasePages = await getAllDatabasePages(databaseID);
      console.log(`Loaded ${databasePages.length} pages.`);
    }
    else if (answers.job === "infer_artists") {
      // Infer artists from albums without any artists.
      console.log(`Inferring artists from albums...`);
      await inferArtistsFromAlbums(databasePages, artistColumn, albumNameColumn);
    }
    else if (answers.job === "update_album_ids") {
      // Update Album Ids for each entry
      console.log("Inferring Album IDs...")
      await inferAlbumIDs(databasePages, artistColumn, albumNameColumn, albumIdColumn, albumURLColumn)
    }
    else if (answers.job === "update_pages_with_album_art") {
      // Update existing pages with album art for their respective albums
      // TODO: Once Album IDs are working, stop using the album name and use the spotify API straight up
      // TODO: Generalize "Artist" and "Album Name" column names
      console.log("Updating pages with album art...")
      await updatePagesWithAlbumArt(
        databasePages,
        artistColumn,
        albumNameColumn,
        /*Overwrite Existing Artwork = */ false,
        /*Output HTML = */ true
      );
    }
    else if (answers.job === "remove_duplicate_albums_by_album_properties") {
      // Remove duplicate albums
      console.log("Removing duplicate albums by album properties...");
      await removeDuplicateAlbumsByAlbumProperties(databasePages, artistColumn, albumNameColumn, albumRatingColumn, /* verbose = */ true);
    }
    else if (answers.job === "change_column_names") {
      // Change column names
      // Define Map from column value names to the actual variables they define:
      const columnNameMap: Map<string, string> = new Map([
        ["artist", artistColumn],
        ["album_name", albumNameColumn],
        ["album_id", albumIdColumn],
        ["album_url", albumURLColumn],
        ["date_discovered", dateDiscoveredColumn],
        ["rating", albumRatingColumn],
        ["genre", albumGenreColumn]
      ]);

      const columnChangeAnswer: string = (await inquirer.prompt({
        type: "rawlist",
        name: "column",
        message: "Which column would you like to change?",
        choices: [
          {
            name: "Artist",
            value: "artist"
          },
          {
            name: "Album Name",
            value: "album_name"
          },
          {
            name: "Album ID",
            value: "album_id"
          },
          {
            name: "Album URL",
            value: "album_url"
          },
          {
            name: "Date Discovered",
            value: "date_discovered"
          },
          {
            name: "Rating",
            value: "rating"
          },
          {
            name: "Genre",
            value: "genre"
          }
        ]
      })).column;

      console.log(`Current Column Name: ${columnNameMap.get(columnChangeAnswer)}`);
      const newColumnName: string = (await inquirer.prompt({
        type: "input",
        name: "new_column_name",
        message: "What would you like to change the column name to?"
      })).new_column_name;
      columnNameMap.set(columnChangeAnswer, newColumnName);

      // Update All Column Names based on the columnNameMap.
      // TODO: just use the map for changing variable names in the first place.
      albumNameColumn = columnNameMap.get("album_name") ?? assert.fail();
      artistColumn = columnNameMap.get("artist") ?? assert.fail();
      albumIdColumn = columnNameMap.get("album_id") ?? assert.fail();
      albumURLColumn = columnNameMap.get("album_url") ?? assert.fail();
      dateDiscoveredColumn = columnNameMap.get("date_discovered") ?? assert.fail();
      albumRatingColumn = columnNameMap.get("rating") ?? assert.fail();
      albumGenreColumn = columnNameMap.get("genre") ?? assert.fail();
    }
    else if (answers.job === "exit") {
      console.log("Exiting...");
      break;
    }
    else {
      assert.fail("Invalid job");
    }
  }
}

/**
 * Get all database pages from a Notion Database.
 * 
 * @param database_id Notion Database ID of database to query
 * @returns list of all database pages from `database_id` by querying Notion API
 */
async function getAllDatabasePages(database_id: string): Promise<PageObjectResponse[]> {
  // Create progress bar that's continually updated as we discover we have more page sizes.
  const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  const pageSize = 100; // Max Notion Page size.
  progressBar.start(pageSize, 0);

  // Get first batch of pages from database
  let albumDatabaseResponse = await notion.databases.query({
    database_id: database_id,
    page_size: pageSize,
  });
  const databasePages = getFullPages(albumDatabaseResponse); // turns database query response into a list of notion pages.

  // Keep asking for pages until we run out.
  // This doesn't seem like it can be parallized unfortunately, there's no rhyme or reason to how the next_cursor position works,
  // and there's no easy way to count how many pages are in a database.
  while (albumDatabaseResponse.has_more) {
    progressBar.setTotal(progressBar.getTotal() + pageSize); // Increase the progress bar's limit
    progressBar.increment(pageSize); // Increment progress bar.

    albumDatabaseResponse = await notion.databases.query({
      database_id: database_id,
      start_cursor: albumDatabaseResponse.next_cursor ?? assert.fail("Bad API response."),
      page_size: pageSize,
    });
    databasePages.push(...getFullPages(albumDatabaseResponse));
  }

  // Fully complete progress bar and adjust its total (since we'll always overshoot)
  progressBar.increment(albumDatabaseResponse.results.length);
  progressBar.setTotal(databasePages.length);
  progressBar.stop();

  return databasePages;
}

/**
 * Import all saved Spotify Albums from an account into a notion database, populating its Album Name,
 * Artist Name, Album URL, and Album ID fields. Also populates a "date discovered" column that corresponds 
 * with when the album was added to Spotify, and imports the album's cover art into the notion page's cover and icon.
 * 
 * @param savedAlbums List of spotify saved albums to import into Notion.
 * @param notion_database_id Notion Database ID of database to add imported Spotify Albums to.
 * @param albumNameColumn Name of property in notion database that stores album name information. Should be a "title" type.
 * @param artistColumn Name of property in notion database that stores artist information. Should be a "rich text" type. 
 * @param albumIdColumn Name of property in notion database that stores album id information. Should be "rich text" type.
 * @param albumURLColumn Name of property in notion database that stores album URL information. Should be "rich text" type.
 * @param albumGenreColumn Name of property in notion database that stores album Genre column. Should be multi-select type.
 * @param dateDiscoveredColumn Name of property in notion database that stores date discovered information. Should be "Date" type.
 */
export async function importSavedSpotifyAlbums(
  savedAlbums: SavedAlbum[],
  notion_database_id: string,
  albumNameColumn: string,
  artistColumn: string,
  albumIdColumn: string,
  albumURLColumn: string,
  albumGenreColumn: string,
  dateDiscoveredColumn: string,
): Promise<void> {
  // TODO: Use ConsoleOutput variable
  // TODO: Allow ignoring certain columns on import, and adding columns that don't exist
  // TODO: "Added at" data importer?
  console.log(`Running importing job on ${savedAlbums.length} albums.`);
  // Get set of existing album IDs in our Notion Database to avoid adding duplicate albums
  const existingDatabasePages = await getAllDatabasePages(notion_database_id);
  const existingAlbumIDs: Set<string> = new Set(
    existingDatabasePages.map((page) =>
      getFullPlainText(getRichTextField(page, albumIdColumn)),
    ),
  );

  // Also have set of existing album name and artists to match
  const existingAlbumProperties: Set<string> = new Set(
    existingDatabasePages.map((page) =>
      createAlbumKey(getFullPlainText(getTitleField(page, albumNameColumn)),
        getFullPlainText(getRichTextField(page, artistColumn)))
    ));

  // Filter out the albums we import by removing any albums with album IDs we already have,
  // or album name-artist pairs we already have.
  // TODO: maybe make Album IDs a list and add every new album ID we find to it?
  const albumsToImport = savedAlbums.filter(
    (savedAlbum) =>
      !existingAlbumIDs.has(savedAlbum.album.id) // filter out albums w/ identical ids
      // filter out albums with identical name-artist pairs.
      && !existingAlbumProperties.has(
        createAlbumKey(
          savedAlbum.album.name,
          getArtistStringFromAlbum(savedAlbum.album)),
      ),
  );
  console.log(`Actually Importing ${albumsToImport.length} new albums`);

  // Import all new spotify albums
  const notionUpdatePromises = albumsToImport.map(async savedAlbum => {
    const album = savedAlbum.album;
    const artistNames = album.artists.map(artist => artist.name);
    const artistText = artistNames.join(", ");
    const albumURL = album.external_urls.spotify;
    const albumGenres = album.genres;
    // Per spotify API reference, widest album artwork is always listed first
    const albumArtwork = album.images[0]?.url ?? assert.fail("No album artwork");

    // Add album to Notion
    const notionAPIParams: CreatePageParameters = {
      parent: {
        database_id: notion_database_id,
      },
      properties: {
        [albumNameColumn]: {
          title: [constructRichTextRequestField(album.name)],
        },
        [artistColumn]: {
          rich_text: [constructRichTextRequestField(artistText)]
        },
        [albumIdColumn]: {
          rich_text: [constructRichTextRequestField(album.id)]
        },
        [albumURLColumn]: {
          url: albumURL
        },
        [albumGenreColumn]: {
          multi_select: albumGenres.map(genre => ({
            name: genre
          }))
        },
        [dateDiscoveredColumn]: {
          date: {
            start: savedAlbum.added_at
          }
        }
      },
      // Add cover and icon
      cover: {
        external: {
          url: albumArtwork
        }
      },
      icon: {
        external: {
          url: albumArtwork
        }
      }
    }
    // add URL separately because of type checking issues
    // notionAPIParams.properties[albumURLColumn] = { url: albumURL, name: albumURLColumn };
    notion.pages.create(notionAPIParams);
    console.log(`Imported album ${album.name}`);
  });

  await Promise.all(notionUpdatePromises);
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
 * Updates Notion databse pages in `databasePages` to remove duplicate albums. Duplicate albums are defined as albums with the same name 
 * and artist text (after trimming whitespace and lowercasing all text). Note that two albums with the same name but different order of artists will
 * be read as different albums.
 * 
 * Duplicates are removed via the following strategies, executed in order of ascending number:
 * 
 * 1. Only keep pages that have album ratings. This is done only if `albumRatingColumn` is not `undefined`.
 * 2. Keep the page that was last modified (according to Notion).
 * 
 * @param databasePages List of Database Pages to update.
 * @param artistColumn Name of property in `databasePages` that stores artist information. Should be a "rich text" type.
 * @param albumNameColumn Name of property in `databasePages` that stores album name information. Should be a "title" type.
 * @param albumRatingColumn Name of property in `databasePages` that stores album rating information. If not undefined, it should be a "select" type.
 * @throws Error if any column names are invalid property names in `databasePages`.
 * @returns Notion pageIDs of deleted pages.
 */
async function removeDuplicateAlbumsByAlbumProperties(
  databasePages: PageObjectResponse[],
  artistColumn: string,
  albumNameColumn: string,
  albumRatingColumn: string | undefined,
  verbose: boolean = false): Promise<string[]> {
  // Create map that stores key-value pairs of an album name/artist vs the notion page it belongs to.
  const albumPageMap = new Map<string, PageObjectResponse[]>();
  databasePages.forEach(page => {
    const albumArtist = getRichTextFieldAsString(page, artistColumn);
    const albumName = getTitleFieldAsString(page, albumNameColumn);
    const albumKey = createAlbumKey(albumArtist, albumName);

    if (albumPageMap.has(albumKey)) {
      albumPageMap.get(albumKey)?.push(page);
      console.log(`Found duplicate for album ${albumName} by ${albumArtist}.`); // TODO: control via "verbose" param
    } else {
      albumPageMap.set(albumKey, [page]);
    }
  });

  // Focus on albums with more than one page
  const duplicateAlbums: PageObjectResponse[][] = Array.from(albumPageMap.values()).filter(pages => pages.length > 1);

  // Remove duplicate pages through several heuristics:
  const pagesToRemove: PageObjectResponse[] = [];

  // ---- Strategy 1: Only keep pages that have album ratings. Done only if we have a ratings column. ----

  // We build up a list of remaining albums to filter out for duplicates after this strategy, but we reuse the old duplicate 
  // albums list if we're not even executing this strategy in the first place.
  const remainingAlbumPages: PageObjectResponse[][] = (albumRatingColumn !== undefined) ? [] : duplicateAlbums;

  if (albumRatingColumn !== undefined) {
    duplicateAlbums.forEach(pages => {
      // Get lists of pages that have been given ratings, and pages that don't have ratings.
      const ratedPages: PageObjectResponse[] = [];
      const unratedPages: PageObjectResponse[] = [];
      pages.forEach(page => {
        if (getSelectFieldAsString(page, albumRatingColumn) !== undefined) {
          ratedPages.push(page);
        } else {
          unratedPages.push(page);
        }
      });
      // If there are pages with ratings, keep them and mark the unrated pages for deletion.
      if (ratedPages.length > 0) {
        remainingAlbumPages.push(ratedPages);
        pagesToRemove.push(...unratedPages);
      }
      // If there are no pages with ratings, keep all pages for now (we'll try another technique to remove duplicates)
      else {
        remainingAlbumPages.push(pages);
      }
    });
  }

  // ---- Strategy 2: Keep the page that was last modified. ----
  remainingAlbumPages.forEach(pages => {
    // Get the last modified page
    const lastModifiedPage = pages.reduce((prevPage, currPage) => {
      return new Date(prevPage.last_edited_time) > new Date(currPage.last_edited_time) ? prevPage : currPage;
    });
    // Mark all other pages for deletion
    pagesToRemove.push(...pages.filter(page => page.id !== lastModifiedPage.id));
  });

  if (verbose) {
    console.log(`Removing ${pagesToRemove.length} duplicate pages.`);
  }
  for (const page of pagesToRemove) {
    if (verbose) {
      console.log(`Removing page for ${getTitleFieldAsString(page, albumNameColumn)} last edited at ${new Date(page.last_edited_time).toLocaleString()} at url "${page.url}".`); // TODO: Control via "verbose" param.
    }
  }

  // Delete the pages we've marked for removal
  await Promise.all(pagesToRemove.map(page => notion.pages.update({
    page_id: page.id,
    archived: true,
  })));

  return pagesToRemove.map(page => page.id);
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
 * Gets content of a rich text property from a Notion database page as a string.
 * 
 * @param page Page to get query `propertyName` from.
 * @param propertyName Property name to query from `page`.
 * @returns string representing the pure text content without any styling information from 
 * the rich text column titled `propertyName` in `page`.
 * @throws AssertionError if `page` has no property called `propertyName`, or `propertyName` is not a rich text field.
 */
function getRichTextFieldAsString(page: PageObjectResponse, propertyName: string): string {
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
function getTitleFieldAsString(page: PageObjectResponse, propertyName: string): string {
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
function getNumberField(page: PageObjectResponse, propertyName: string): number | undefined {
  const numberProperty = page.properties[propertyName] ?? assert.fail();
  assert(
    numberProperty.type === "number",
    `Property ${propertyName} is not title type.`
  );

  return numberProperty.number ?? undefined;
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
function getSelectFieldAsString(page: PageObjectResponse, propertyName: string): string | undefined {
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

/**
 * Constructs a Notion RichTextRequest Field from a single string field.
 * @param content Content to put in the rich text request field
 * @returns the constructed richTextRequest field.
 */
function constructRichTextRequestField(content: string): {
  type: "text",
  text: {
    content: string;
  }
} {
  return {
    type: "text",
    text: {
      content: content
    }
  }
}

/**
 * Construct a string with the artists of an album.
 * @param album a Spotify Album object.
 * @returns string of the artists in an album with ", " as a separator.
 */
function getArtistStringFromAlbum(album: Album) {
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
function createAlbumKey(albumName: string, albumArtist: string) {
  // TODO: issue with hashing if the artists are written slightly differently between the same albums (i.e. in the wrong order).
  return `${albumName.trim().toLowerCase()} - ${albumArtist.trim().toLowerCase()}`;
}

if (require.main === module) {
  console.log("Running Misc Notion Jobs:")
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}