import { Client, collectPaginatedAPI, isFullDatabase } from "@notionhq/client";
import dotenv from "dotenv";
import { strict as assert } from 'assert';
import { PageObjectResponse, TextRichTextItemResponse, CreatePageParameters, UpdatePageParameters } from "@notionhq/client/build/src/api-endpoints";
import { SavedAlbum, SpotifyApi } from '@spotify/web-api-ts-sdk';
import * as fs from 'node:fs/promises';
import inquirer from 'inquirer';
import cliProgress from 'cli-progress';
import { Logger } from 'winston';
import chalk from 'chalk';
import { chunkArray, arrayIntersect, arrayDifference, determineAlbumType, getAllAlbumTracks, getAlbumDuration, getNumberField, getAllArtistGenresFromAlbum, getNotionGenresFromAlbum, convertSpotifyGenresIntoNotionGenres } from "./helpers";
import { defaultGenreConversionModel, NotionAlbumDBColumnNames, SpotifyAlbumType, spotifyChunkSizeLimit } from "./defs";
import { getFullPages, getSpotifyAlbumIDsFromNotionPage, createAlbumKey, getFullPlainText, getTitleField, getRichTextField, getArtistStringFromAlbum, constructNotionTextContentBlock, getTitleFieldAsString, getRichTextFieldAsString, getURLFieldAsString, makeStringFromAlbumIDs, createAlbumKeyFromSpotifyAlbum, getFormulaPropertyAsBoolean, getAlbumArtwork, getSelectFieldAsString } from "./helpers";
import { get } from "node:http";

// For env File
dotenv.config();

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
// TODO: Auto-Populate Genres
// TODO: Create "main" file and choose what to run there.
export async function main() {
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
          value: "change_column_names"
        },
        {
          name: "Exit",
          value: "exit"
        }
      ]
    });
    if (answers.job === "refresh_database_pages") {
      console.log(`Refreshing pages...`);
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
async function getAllDatabasePages(database_id: string, showProgressBar: boolean = true): Promise<PageObjectResponse[]> {
  // Create progress bar that's continually updated as we discover we have more page sizes.
  const pageSize = 100; // Max Notion Page size.
  const progressBar = new cliProgress.SingleBar({ clearOnComplete: true, hideCursor: true }, cliProgress.Presets.shades_classic);
  if (showProgressBar) {
    progressBar.start(pageSize, 0);
  }

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
    if (showProgressBar) {
      progressBar.setTotal(progressBar.getTotal() + pageSize); // Increase the progress bar's limit
      progressBar.increment(pageSize); // Increment progress bar.
    }

    albumDatabaseResponse = await notion.databases.query({
      database_id: database_id,
      start_cursor: albumDatabaseResponse.next_cursor ?? assert.fail("Bad API response."),
      page_size: pageSize,
    });
    databasePages.push(...getFullPages(albumDatabaseResponse));
  }

  // Fully complete progress bar and adjust its total (since we'll always overshoot)
  if (showProgressBar) {
    progressBar.increment(albumDatabaseResponse.results.length);
    progressBar.setTotal(databasePages.length);
    progressBar.stop();
  }

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
 * @param albumDurationColumn Name of property in notion database that stores album duration information. Should be "Number" type.
 * @param logger Logger to use to print information about the importing process. If not specified, console.log is used.
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
  albumDurationColumn: string,
  logger?: Logger | undefined
): Promise<void> {
  const loggingFunc = logger?.verbose ?? console.log;
  // TODO: Allow ignoring certain columns on import, and adding columns that don't exist
  loggingFunc(`Running importing job on ${savedAlbums.length} albums.`);
  // Get set of existing album IDs in our Notion Database to avoid adding duplicate albums
  const existingDatabasePages = await getAllDatabasePages(notion_database_id, /*showProgressBar=*/ false);
  const existingAlbumIDs: Set<string> = new Set(
    existingDatabasePages.flatMap((page) =>
      getSpotifyAlbumIDsFromNotionPage(page, albumIdColumn)
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
  loggingFunc(`Importing ${albumsToImport.length} new albums.`);

  // Import all new spotify albums
  const notionUpdatePromises = albumsToImport.map(async savedAlbum => {
    const album = savedAlbum.album;
    const artistNames = album.artists.map(artist => artist.name);
    const artistText = artistNames.join(", ");
    const albumURL = album.external_urls.spotify;
    const albumDuration = await getAlbumDuration(album, spotify);

    // Infer album genre (using artists)
    const spotifyArtistGenres = await getAllArtistGenresFromAlbum(album, spotify);
    const albumGenres = convertSpotifyGenresIntoNotionGenres(spotifyArtistGenres, defaultGenreConversionModel)
    loggingFunc(`Genre Inferring Result:\nAlbum: ${album.name}\nSpotify Genres: ${spotifyArtistGenres.join(", ")}\nNotion Genres: ${albumGenres.join(", ")}`)

    // Add genre information based on Album Type (EP, Single, and Compilation)
    const spotifyAlbumType: SpotifyAlbumType = determineAlbumType(album)
    if (spotifyAlbumType === SpotifyAlbumType.SINGLE) {
      albumGenres.push("Single")
    }
    else if (spotifyAlbumType === SpotifyAlbumType.EP) {
      albumGenres.push("EP")
    }

    if (album.album_type === "compilation") {
      albumGenres.push("Compilation")
    }
    // Per spotify API reference, widest album artwork is always listed first
    const albumArtwork = album.images[0]?.url ?? assert.fail("No album artwork");

    // Add album to Notion
    const notionAPIParams: CreatePageParameters = {
      parent: {
        database_id: notion_database_id,
      },
      properties: {
        [albumNameColumn]: {
          title: [constructNotionTextContentBlock(album.name)],
        },
        [artistColumn]: {
          rich_text: [constructNotionTextContentBlock(artistText)]
        },
        [albumIdColumn]: {
          rich_text: [constructNotionTextContentBlock(album.id)]
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
        },
        [albumDurationColumn]: {
          number: albumDuration
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
    notion.pages.create(notionAPIParams);
    loggingFunc(`Imported album "${album.name}".`);
  });

  await Promise.all(notionUpdatePromises);
}

/**
 * Updates "stale albums" in a Notion album database with fresh Album ID and URL information from a user's saved Spotify albums.
 * A stale notion album is defined as a Notion album row that has the same artist and album name as a Spotify Album from a user's saved library
 * but has a mismatched Spotify Album ID or URL.
 * These stale albums will have their other properties (specifically ID and URL) updated.
 * If multiple albums with the same artist and name exist in `savedAlbums`, their information is combined to update a stale albums' Album ID 
 * (but only one of them is used for its URL)
 * 
 * @param savedAlbums List of spotify saved albums to use as ground truth when checking against Notion.
 * @param albumNameColumn Name of property in notion database that stores album name information. Should be a "title" type.
 * @param artistColumn Name of property in notion database that stores artist information. Should be a "rich text" type. 
 * @param albumIdColumn Name of property in notion database that stores album id information. Should be "rich text" type.
 * @param albumURLColumn Name of property in notion database that stores album URL information. Should be "rich text" type.
 * @param logger Logger to use to print information about the updating process. If not specified, the console is used.
 * @param overwriteIDs If true, overwrites stale album IDs completely instead of appending new album IDs to the old ones with a ", " separator.
 * @throws Error if any of the column names are invalid or if the database ID is invalid.
 * Will also warn the user if any of the albums in `savedAlbums` are duplicates themselves in terms of album name/artist.
 */
export async function updateStaleNotionAlbumsFromSpotify(
  savedAlbums: SavedAlbum[],
  albumNameColumn: string,
  artistColumn: string,
  albumIdColumn: string,
  albumURLColumn: string,
  logger?: Logger | undefined,
  overwriteIDs: boolean = false
) {
  const loggingFunc = logger?.verbose ?? console.log;
  const warningFunc = logger?.warn ?? console.warn;
  loggingFunc(`Running stale album freshening job using ${savedAlbums.length} saved Spotify albums...`);

  // Create map of album properties to their corresponding spotify album
  const existingAlbumProperties = new Map<string, SavedAlbum[]>();
  savedAlbums.forEach(album => {
    const albumKey = createAlbumKey(
      album.album.name,
      getArtistStringFromAlbum(album.album)
    );
    if (existingAlbumProperties.has(albumKey)) {
      // Warn users about duplicate albums in their spotify DB, adding an extra message if they're planning to overrite IDs
      const warningString = `Duplicate albums found in saved spotify albums for key "${albumKey}".${overwriteIDs ? "The first album will be used for an ID overrite." : ""}
      Album ID of the first album is ${existingAlbumProperties.get(albumKey)![0]?.album.id}.
      Album ID of the second album is ${album.album.id}.`;

      // It's important for users to know this if they're overriting IDs, but not 
      // so important if they're okay with just adding on all album IDs
      if (overwriteIDs) {
        warningFunc(warningString);
      } else {
        loggingFunc(warningString);
      }

      // Add album to map
      existingAlbumProperties.get(albumKey)!.push(album);
    }
    else {
      existingAlbumProperties.set(
        albumKey,
        [album]
      )
    }
  });

  // Get Notion Albums
  const databaseID = process.env.DATABASE_ID ?? assert.fail("No Database ID");
  const databasePages = await getAllDatabasePages(databaseID);
  loggingFunc(`Retrieved ${databasePages.length} pages in Notion album database.`);

  // Get stale albums, as defined above.
  const staleAlbumPages: PageObjectResponse[] = [];
  databasePages.forEach(page => {
    const albumName = getTitleFieldAsString(page, albumNameColumn);
    const artistName = getRichTextFieldAsString(page, artistColumn);
    const albumIDs = getSpotifyAlbumIDsFromNotionPage(page, albumIdColumn);
    const albumURL = getURLFieldAsString(page, albumURLColumn);
    const correspondingSpotifyAlbums = existingAlbumProperties.get(createAlbumKey(albumName, artistName));

    // Don't handle pages that have no "ground truth" saved spotify albums.
    if (correspondingSpotifyAlbums === undefined) {
      return;
    }

    // Check for a mismatched URL or Album ID between the notion page and spotify album
    // across any of the corresponding spotify albums
    const correspondingSpotifyIDs = correspondingSpotifyAlbums.map(spotifyAlbum => spotifyAlbum.album.id) ?? [];
    const correspondingSpotifyURLs = correspondingSpotifyAlbums.map(spotifyAlbum => spotifyAlbum.album.external_urls.spotify) ?? [];
    let isStale = correspondingSpotifyIDs.some(albumID => !albumIDs.includes(albumID)) // Any album IDs that haven't been accounted for?
      || !correspondingSpotifyURLs.includes(albumURL); // Is the page's URL one that belongs to one of the "ground truth" albums?

    // If we're overwriting album IDs, an album becomes stale if there's
    // any difference between the page's album IDs and the ground truth album IDs.
    if (overwriteIDs) {
      const pageAlbumIDSet = new Set(albumIDs);
      isStale ||= !(correspondingSpotifyIDs.every(albumID => pageAlbumIDSet.has(albumID))
        && pageAlbumIDSet.size === correspondingSpotifyIDs.length);
    }

    if (isStale) {
      staleAlbumPages.push(page);
    }
  })

  loggingFunc(`Found ${staleAlbumPages.length} stale albums.`);

  // Update stale albums based on the spotify "ground truth" albums
  // At a high level, what this code is trying to do is essentially update the album IDs/URLs 
  // of notion albums that don't have the full "information"
  await Promise.all(staleAlbumPages.map(async page => {
    const albumName = getTitleFieldAsString(page, albumNameColumn);
    const oldAlbumIDString = getRichTextFieldAsString(page, albumIdColumn);
    const oldAlbumIDs = getSpotifyAlbumIDsFromNotionPage(page, albumIdColumn);
    const oldAlbumURL = getURLFieldAsString(page, albumURLColumn);

    // Get corresponding album of each stale album
    const correspondingSpotifyAlbums = existingAlbumProperties.get(createAlbumKey(
      getTitleFieldAsString(page, albumNameColumn),
      getRichTextFieldAsString(page, artistColumn)
    ))!;
    const newAlbumIDs = correspondingSpotifyAlbums!.map(album => album.album.id);

    // Use the union of the old and new album IDs if we're not overwriting them.
    // Otherwise, only use the new albums.
    const albumIDUnionSet = new Set([oldAlbumIDs, newAlbumIDs].flat());
    const albumsToWrite = overwriteIDs ? newAlbumIDs : [...albumIDUnionSet];

    // Filter albums to choose based on if they're availiable in at least one country:
    // (TODO: This could be done in a "smarter" way, by filtering albums that are within the user's country)
    const availiableAlbums = correspondingSpotifyAlbums.filter(album => album.album.available_markets.length > 0);
    let newAlbumURL: string;
    if (availiableAlbums.length > 0) {
      // Try to get an album URL that's availiable on spotify...
      newAlbumURL = availiableAlbums[0]!.album.external_urls.spotify;
    } else {
      // Otherwise, just get the first non-availiable URL.
      newAlbumURL = correspondingSpotifyAlbums[0]!.album.external_urls.spotify;
    }

    const notionAPIParams: UpdatePageParameters = {
      page_id: page.id,

      properties: {
        [albumIdColumn]: {
          type: "rich_text",
          rich_text: [constructNotionTextContentBlock(makeStringFromAlbumIDs(albumsToWrite))]
        },
        [albumURLColumn]: {
          type: "url",
          url: newAlbumURL
        }
      }
    };

    await notion.pages.update(notionAPIParams); // Update page in Notion

    // If we're not using a logger, display some parts of the changed text in orange for more readability.
    // If we are, just add quotes instead.
    const textHighlight = logger === undefined ? chalk.rgb(253, 147, 83) : (str: string) => `"${str}"`;
    let loggingString = `Updated ${textHighlight(albumName)} with the following properties:`;
    if (oldAlbumIDString !== makeStringFromAlbumIDs(albumsToWrite)) {
      loggingString += `\nAlbum IDs: "${oldAlbumIDString}" --> ${textHighlight(makeStringFromAlbumIDs(albumsToWrite))}`;
    }
    if (oldAlbumURL !== newAlbumURL) {
      loggingString += `\nAlbum URL: "${oldAlbumURL}" --> ${textHighlight(newAlbumURL)}`;
    }
    loggingFunc(loggingString);
  }))
  loggingFunc("Finished updating stale albums.");

}

/**
 * Uses a user-defined function to change a user's list of saved spotify albums.
 * @param spotify SpotifyAPI instance that contains an access token.
 * @param filterFunction A function that takes the list of notion pages in the linked album database and
 * transforms them of a list of IDs to add and remove from a user's library. The lists should be mutually exclusive.
 * @param logger Logger to use to print information about the updating process. If not specified, the console is used.
 * @param originalSavedAlbums Original list of the user's saved albums. If defined, it's used to produce a helpful log output.
 */
async function filterSpotifyLibraryWithNotionPages(
  spotify: SpotifyApi,
  filterFunction: (notionAlbumPages: PageObjectResponse[]) => { add: string[], remove: string[] },
  logger?: Logger | undefined,
  originalSavedAlbums?: SavedAlbum[] | undefined,
): Promise<void> {
  const loggingFunc = logger?.verbose ?? console.log;
  loggingFunc("Filtering saved spotify albums...");

  // Get album IDs that we're saving and removing
  const databaseID = process.env.DATABASE_ID ?? assert.fail("No Database ID");
  loggingFunc(`Getting all pages in Notion Database...`);
  const databasePages = await getAllDatabasePages(databaseID);
  let { add, remove } = filterFunction(databasePages);
  // Confirm mutual exclusivity between add and remove
  if (arrayIntersect(add, remove).length > 0) {
    throw new Error(`Filtering function should produce mutually exclusive lists. The elements [${arrayIntersect(add, remove).join(", ")}] belong to both arrays.`)
  }

  // Using the user's list of saved spotify albums, we can remove albums that are already added/removed from the album library
  if (originalSavedAlbums !== undefined) {
    const originalSavedAlbumIDs = originalSavedAlbums.map(album => album.album.id);
    // The new added IDs are the ones that weren't already in the original saved album IDs
    add = arrayDifference(add, originalSavedAlbumIDs);
    // The new removed IDs are the ones that were in the original saved album IDs
    remove = arrayIntersect(originalSavedAlbumIDs, remove);
  }

  // Print spotify library changelist
  // TODO: should I just automatically get spotify albums?
  if (originalSavedAlbums !== undefined) {
    // Lookup the new added album IDs (don't need to look up the removed album IDs)
    const addDiff = await Promise.all(chunkArray([...add], spotifyChunkSizeLimit)
      .map(chunk => spotify.albums.get(chunk)))
      .then(chunks => chunks.flat());
    const removeDiff = originalSavedAlbums.filter(album => remove.includes(album.album.id)).map(savedAlbum => savedAlbum.album);

    // Construct log output
    const addStringHeader = addDiff.length > 0 ? `${chalk.green(addDiff.length)} albums were ${chalk.green("added")}:` : "No albums were added.";
    const addStringBody = addDiff.map(album => `Added "${createAlbumKeyFromSpotifyAlbum(album)}".`).join("\n");
    const removeStringHeader = removeDiff.length > 0 ? `${chalk.red(removeDiff.length)} albums were ${chalk.red("removed")}:` : "No albums were removed.";
    const removeStringBody = removeDiff.map(album => `Removed "${createAlbumKeyFromSpotifyAlbum(album)}".`).join("\n");
    loggingFunc(`${addStringHeader}\n${addStringBody}`);
    loggingFunc(`${removeStringHeader}\n${removeStringBody}`);
  }
  else {
    loggingFunc(`Putting ${add.length} album pages in spotify library, and excluding ${remove.length} albums.`);
  }

  // Split add and remove lists into chunks of spotify's API limit
  const addChunks = chunkArray(add, spotifyChunkSizeLimit);
  const removeChunks = chunkArray(remove, spotifyChunkSizeLimit);

  // Add Progress Bar
  const libraryEditingBar = new cliProgress.MultiBar(
    {
      format: '{bar} {percentage}% | {name} | {value}/{total}',
      hideCursor: true,
      clearOnComplete: true
    },
    cliProgress.Presets.shades_classic
  )
  // Add "add" and "remove" bars depending on if there's anything to add/remove
  let addBar: cliProgress.SingleBar | undefined;
  let removeBar: cliProgress.SingleBar | undefined;
  if (add.length > 0) {
    addBar = libraryEditingBar.create(add.length, 0, { name: "adding albums" });
  }
  if (remove.length > 0) {
    removeBar = libraryEditingBar.create(remove.length, 0, { name: "removing albums" });
  }

  // Make spotify API calls
  const addPromise = Promise.all(addChunks.map(async chunk => {
    await addSavedAlbums(spotify, chunk);
    addBar?.increment(chunk.length);
  }))
  const removePromise = Promise.all(removeChunks.map(async chunk => {
    await removeSavedAlbums(spotify, chunk);
    removeBar?.increment(chunk.length);
  }))
  await Promise.all([addPromise, removePromise]);

  libraryEditingBar.stop(); // stop progess bar
  loggingFunc("Finished filtering saved spotify albums.");
}

/**
 * Filters a user's saved spotify albums based on a user-defined boolean formula column.
 * 
 * Note that the album filtering process is only effective if the album IDs in the notion pages are up to date.
 * For this reason, it's recommended to run the {@link updateStaleNotionAlbumsFromSpotify} function before running this one.
 * 
 * @param spotify SpotifyAPI instance that contains an access token.
 * @param albumIdColumn Name of property in notion database that stores album id information. Should be "rich text" type.
 * @param includeInSpotifyColumn Formula column with a boolean return value. 
 * Column should be true if the album represented by a notion page should be included in the user's spotify library,
 * and false if the album should be removed from/not added to the library.
 * @param logger Logger to use to print information about the updating process. If not specified, the console is used.
 * @param originalSavedAlbums Original list of the user's saved albums. If defined, it's used to produce a helpful log output.
 */
export async function filterSpotifyLibraryUsingIncludeColumn(
  spotify: SpotifyApi,
  albumIdColumn: string,
  includeInSpotifyColumn: string,
  logger?: Logger | undefined,
  originalSavedAlbums?: SavedAlbum[] | undefined
): Promise<void> {
  const loggingFunc = logger?.verbose ?? console.log;
  loggingFunc(`Reading column "${includeInSpotifyColumn}" to filter spotify library...`);

  // Define function for filtering albums
  const includeColumnFilteringFunction = (notionAlbumPages: PageObjectResponse[]) => {
    const add: string[] = [];
    const remove: string[] = [];
    // If page's formula evaluates to true, add its album IDs to the add list, and vice versa for the remove list.
    notionAlbumPages.forEach(page => {
      const includeProperty = getFormulaPropertyAsBoolean(page, includeInSpotifyColumn);
      const albumIDs = getSpotifyAlbumIDsFromNotionPage(page, albumIdColumn)

      // Before continuing, skip the album if its album ID is completely empty
      if (albumIDs.join().trim() === "") {
        return
      }

      if (includeProperty) {
        add.push(...albumIDs);
      }
      else {
        remove.push(...albumIDs);
      }
    })
    return { add, remove };
  }
  await filterSpotifyLibraryWithNotionPages(spotify, includeColumnFilteringFunction, logger, originalSavedAlbums);
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
      console.log(`Found duplicate for album ${albumName} by ${albumArtist}.`);
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
      console.log(`Removing page for ${getTitleFieldAsString(page, albumNameColumn)} last edited at ${new Date(page.last_edited_time).toLocaleString()} at url "${page.url}".`);
    }
  }

  // Delete the pages we've marked for removal
  await Promise.all(pagesToRemove.map(page => notion.pages.update({
    page_id: page.id,
    archived: true,
  })));

  return pagesToRemove.map(page => page.id);
}

if (require.main === module) {
  console.log("Running Misc Notion Jobs:");
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}


/**
 * Add albums to user's spotify library.
 * 
 * @param spotify Spotify API Instance
 * @param albumIDs album IDs to add to user's saved library. Limit of 50.
 */
async function addSavedAlbums(spotify: SpotifyApi, albumIDs: string[]): Promise<void> {
  return changeUserAlbums(spotify, albumIDs, "PUT");
}


/**
 * Delete albums from user's spotify library.
 * 
 * @param spotify Spotify API Instance
 * @param albumIDs album IDs to remove from user's saved library. Limit of 50.
 */
async function removeSavedAlbums(spotify: SpotifyApi, albumIDs: string[]): Promise<void> {
  return changeUserAlbums(spotify, albumIDs, "DELETE");
}
/**
 * Uses fetch API to change albums in signed-in user's library.
 * 
 * @param spotify Spotify API Instance
 * @param albumIDs album IDs to change status in user's saved library. Limit of 50.
 * @param method HTTP method to use when calling endpoint. "PUT" addds albums, "DELETE" removes albums.
 */
async function changeUserAlbums(spotify: SpotifyApi, albumIDs: string[], method: "PUT" | "DELETE"): Promise<void> {
  // Get access token
  const token = (await spotify.getAccessToken())?.access_token;
  if (token === undefined) {
    throw Error("Unpopulated access token in Spotify API instance.");
  }

  const myHeaders = new Headers();
  myHeaders.append("Content-Type", "application/json");
  myHeaders.append("Authorization", `Bearer ${token}`);

  // Make request body
  const requestBody = {
    "ids": albumIDs
  };

  const requestOptions: {
    redirect: "follow" | "error" | "manual",
    method: "PUT" | "DELETE",
    headers: Headers,
    body: string;
  } = {
    redirect: "follow",
    method: method,
    headers: myHeaders,
    body: JSON.stringify(requestBody),
  };

  // Make request
  try {
    // There should be no API response.
    const response = await fetch("https://api.spotify.com/v1/me/albums", requestOptions);
    const result = await response.text();
  } catch (error) {
    // Immediately throw whatever error we get.
    throw (error);
  };
}

/**
 * /**
 * Backfills album durations for Notion database pages that have an album ID but no duration.
 * 
 * @param spotify Spotify API Instance
 * @param notion_database_id ID for Notion Database
 * @param notionColumns Record of notion column names for each property.
 * @param logger 
 */
export async function backfillAlbumDurations(
  spotify: SpotifyApi,
  notion_database_id: string,
  notionColumns: Readonly<NotionAlbumDBColumnNames>,
  logger?: Logger | undefined
): Promise<void> {
  const loggingFunc = logger?.verbose ?? console.log;
  loggingFunc("Backfilling album durations...")
  const existingDatabasePages = await getAllDatabasePages(notion_database_id, /*showProgressBar=*/ false);

  const validDatabasePages = existingDatabasePages.filter(page => {
    // Filter out albums with no ID / already filled durations
    const albumID = getSpotifyAlbumIDsFromNotionPage(page, notionColumns.spotifyId).filter(id => id !== "")[0];
    if (albumID === undefined) {
      return false;
    }
    if (getNumberField(page, notionColumns.duration) !== undefined) {
      return false;
    }
    return true;
  })

  const validDatabaseAlbumIDs = validDatabasePages.map(page => getSpotifyAlbumIDsFromNotionPage(page, notionColumns.spotifyId).filter(id => id !== "")[0] ?? assert.fail())
  const spotifyAlbums = (await Promise.all(chunkArray(validDatabaseAlbumIDs, spotifyChunkSizeLimit).map(chunk => spotify.albums.get(chunk)))).flat();

  loggingFunc("Got all spotify albums.")
  // TODO: Error here - "Client network socket disconnected before secure TLS connection was established"
  const backfillPromises = spotifyAlbums.map((album, index) => {
    const notionPage = validDatabasePages[index] ?? assert.fail();

    return getAlbumDuration(album, spotify).then(albumDuration => {
      const albumName = getTitleFieldAsString(notionPage, notionColumns.name)
      loggingFunc(`Album ${albumName} has duration ${albumDuration} ms.`)

      return notion.pages.update({
        page_id: notionPage.id,
        properties: {
          [notionColumns.duration]: {
            number: albumDuration
          }
        }

      })

    }
    )
  })

  loggingFunc("Got all album durations and updated Notion pages.")

  await Promise.all(backfillPromises);

}
