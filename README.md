# Notion Album Database App

This script allows you to perform some operations on any album database you may have in Notion.

For this script to work, you should have a notion database that has a title column for an Album Name, and another text column for the album artist.

- Right now, these columns should be called "Album Name" and "Artist" respectively.

You should also have [Node](https://nodejs.org/en/download) installed.

To start, create an .env file at the root of your directory and add keys for the following properties:

```
NOTION_TOKEN={Your Notion Integration Secret}
DATABASE_ID={Notion Album Database ID}
SPOTIFY_CLIENT_ID={Spotify App Client ID}
SPOTIFY_CLIENT_SECRET={Spotify App Client Secret}
```

Then, run `npm install` to install dependencies, and depending on what you want to do, execute different commands:

Importing Spotify Albums: This is done via a web app, so run `npm run webpack` to bundle the ts code for running the app, run `npm run server`to start the server, and then navigate to http://localhost:3000 to start the web app.

Running Misc Notion Database data importer/fixing jobs: Execute `npm run jobs`.
