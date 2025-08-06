import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import {defineSecret} from "firebase-functions/params";

setGlobalOptions({maxInstances: 10});
const RAWG_API = defineSecret("RAWG_API");
const STEAM_API = defineSecret("STEAM_API");

/**
 * fetchSuggestions
 * GET function that fetches game suggestions from RAWG based on search query.
 * Expects a 'query' URL parameter. Returns an array of games.
 */
export const fetchSuggestions = onRequest(
  {secrets: [RAWG_API]}, async (req, res) => {
    const searchQuery = req.query.query as string;

    if (!searchQuery) {
      res.status(400).send("Missing search query");
      return;
    }

    try {
      const rawgApiKey = RAWG_API.value();
      const response = await fetch(`https://api.rawg.io/api/games?key=${rawgApiKey}&search=${searchQuery}`);
      if (!response.ok) {
        res.status(response.status).send("Failed to fetch game suggestions");
        return;
      }
      const data = await response.json();
      res.status(200).json(data.results);
    } catch (error) {
      logger.error("API fetch failed:", error);
      res.status(500).send("Failed to fetch game suggestions");
    }
  });

/**
 * fetchSteamGames
 * Resolves a Steam vanity URL to a SteamID, then fetches owned games.
 * Expects a 'vanityurl' URL parameter.
 */
export const fetchSteamGames = onRequest(
  {secrets: [STEAM_API]}, async (req, res) => {
    const steamVanityName = req.query.vanityurl as string;

    if (!steamVanityName) {
      res.status(400).send("Missing Steam vanity URL");
      return;
    }

    try {
      const steamApiKey = STEAM_API.value();
      const response = await fetch(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${steamApiKey}&vanityurl=${steamVanityName}`);
      if (!response.ok) {
        res.status(response.status).send("Failed to fetch Steam user");
        return;
      }
      const data = await response.json();
      if (data.response.success !== 1) {
        res.status(404).send("Steam user not found");
        return;
      }
      const steamID = data.response.steamid;
      const gamesResponse = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${steamApiKey}&steamid=${steamID}&include_appinfo=true&format=json`);
      if (!gamesResponse.ok) {
        res.status(gamesResponse.status).send("Failed to fetch Steam games");
        return;
      }
      const gamesData = await gamesResponse.json();
      res.status(200).json(gamesData.response);
    } catch (error) {
      logger.error("API fetch failed:", error);
      res.status(500).send("Failed to fetch Steam games");
    }
  });
