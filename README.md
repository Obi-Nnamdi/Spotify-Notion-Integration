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

Then, run `npm install` and `npm start`!
