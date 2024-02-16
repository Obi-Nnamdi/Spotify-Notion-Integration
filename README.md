# Spotify-Notion Album Database App

- [Spotify-Notion Album Database App](#spotify-notion-album-database-app)
  - [Features](#features)
  - [Getting Started](#getting-started)
    - [Running Notion Album Database jobs (CLI App)](#running-notion-album-database-jobs-cli-app)
    - [Importing Spotify Albums into Notion (Web App)](#importing-spotify-albums-into-notion-web-app)
      - [Bundling the Web App](#bundling-the-web-app)
      - [Running the Web App from an HTTP Server](#running-the-web-app-from-an-http-server)
      - [Running the Web App from an HTTPS Server](#running-the-web-app-from-an-https-server)
        - [Installing OpenSSL](#installing-openssl)
        - [Creating the Certificate](#creating-the-certificate)
      - [Using the Web App](#using-the-web-app)


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

<!-- TODO: Explain how to get each .env file property -->

Then, run `npm install` to install dependencies, and depending on what you want to do, execute different commands:


### Running Notion Album Database jobs (CLI App)

To execute various cleanup jobs on a Notion Album Database, use the CLI app.

To run the CLI app, execute `npm run jobs`. You can then select and run the desired job from the command line interface.


### Importing Spotify Albums into Notion (Web App)

Importing Spotify Albums into Notion is done via a web app, because of the need to use a browser to authenticate with the Spotify API. To use the web app, its frontend code needs to be bundled:

#### Bundling the Web App
Run `npm run bundle` to bundle the TypeScript code for running the app.

Once it's finished bundling, you can choose the run the web app from either an HTTP or HTTPS server. Note that if you're trying to run the web app without using `localhost`, you'll need to run the web app from an HTTPS server for Spotify to allow you to authenticate.

#### Running the Web App from an HTTP Server
*NOTE: This is the recommended way to run the web app.*

Running the web app via an HTTP server doesn't require any extra work. Just run `npm run server` to start the server, and then navigate to http://localhost:3000 to start the web app.

#### Running the Web App from an HTTPS Server
*NOTE: I wouldn't recommend trying to run the web app this way unless you're trying to set up the web app on some sort of external device (like a Raspberry Pi) and you want to connect to the app via an IP address.*

Running the web app via an HTTPS server requires you to create a self-signed OpenSSL certificate. 

##### Installing OpenSSL

Installing OpenSSL on Windows may require some extra steps, check out [this stackoverflow answer](https://stackoverflow.com/questions/2355568/create-a-openssl-certificate-on-windows) for details.

On Linux, you should be able to use whatever package manager you have to install OpenSSL if it's not already installed. (i.e. `sudo apt-get install openssl`  for Ubuntu)

On Mac, you should be able to use Homebrew to install OpenSSL if it's not already installed. (i.e. `brew install openssl`)

##### Creating the Certificate
In a new directory called `cert` (made at the root of the project), run 

```
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365
```

and follow the prompts to generate a self-signed certificate that lasts for 365 days (feel free to extend/shorten the duration if you want). This will generate `key.pem` (private key) and `cert.pem` (certificate) files.

Then, in the `.env` file at the root directory, add the certificate password you chose as a key:
```
...
CERT_PASSPHRASE={Your Certificate Password}
```

If done right, when starting the server using `npm run server`, you should be able to navigate to https://localhost:3000 to start the web app. You will likely have to trust the certificate in your browser to be able to access the web app.

#### Using the Web App

When using the web app, first click the "Sign in with Spotify" button to get a Spotify API token. You'll then see the populated token in the web app. 

From there, click the "Load Spotify Albums" button to load the saved albums from your Spotify library into the app.

After loading the albums, you can click the "Import Albums into Notion" button to import the loaded albums into your Notion database or click the "Sign Out" button to sign out of the app.

<!-- TODO: Add "logging" section -->
<!-- TODO: Add explanations about the different types of Cron Jobs -->