# Spotify-Notion Album Database App

#### **[Features](#features) • [Getting Started](#getting-started) • [Importing Spotify Albums into Notion](#importing-spotify-albums-into-notion) • [Running Notion Album Database jobs](#running-notion-album-database-jobs)**

This project links your Spotify album library to a Notion database, and allows you to perform some operations on any album database you may have in Notion.


## Features
This project includes both a web app for importing albums from Spotify to Notion and a CLI (command line interface) app for performing various operations on an album database in Notion. The code for the web app can be found in the [`server.ts`](./src/server.ts) file, and the code for the CLI app can be found in the [`jobs.ts`](./src/jobs.ts) file.

The web app supports the following operations between a linked Spotify library and a Notion Database:
-  Loading albums from a Spotify library
-  Importing loaded albums into a Notion database
   -  The importing job creates columns for an Album's Name, Artist, Spotify ID, Spotify URL, the date it was saved to the user's Spotify libary, and Genre.

The CLI app supports the following cleanup operations on a Notion Album Database:
- Inferring the missing artist names of Albums From their Album Names
- Populating the Spotify Album IDs of albums without them
- Updating Album Pages With Album Art
- Remove Duplicate Albums By Album Properties

## Getting Started

For this project to work, you should have a notion database that has (at least) a title column for an Album Name, and another text column for the album artist.

- Right now, these columns should be called "Album Name" and "Artist" respectively when importing albums from Spotify to Notion, but they can be changed to different names when running the CLI app.
- Each row of the database correspond to an album.
- When running certain jobs, the code will also optionally look for column names:
  - When removing duplicate albums, the code will optionally look for a "Rating" column on an album page and prioritize keeping the same album with a rating.


You should also have [Node](https://nodejs.org/en/download) installed.

To start, create an .env file at the root of your directory and add keys for the following properties:

```
NOTION_TOKEN={Your Notion Integration Secret}
DATABASE_ID={Notion Album Database ID}
SPOTIFY_CLIENT_ID={Spotify App Client ID}
SPOTIFY_CLIENT_SECRET={Spotify App Client Secret}
```

Then, run `npm install` to install dependencies, and depending on what you want to do, execute different commands:

### Importing Spotify Albums into Notion
This is done via a web app, so run `npm run webpack` to bundle the ts code for running the app, run `npm run server` to start the server, and then navigate to http://localhost:3000 to start the web app.

When using the web app, first click the "Sign in with Spotify" button to get a Spotify API token. You'll then see the populated token in the web app. 

From there, click the "Load Spotify Albums" button to load the saved albums from your Spotify library into the app.

After loading the albums, you can execute the "Import Albums into Notion" button to import the loaded albums into your Notion database or click the "Sign Out" button to sign out of the app.


### Running Notion Album Database jobs
Execute `npm run jobs`. You can then select and run the desired job from the command line interface.
