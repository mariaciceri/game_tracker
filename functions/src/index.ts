import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import {defineSecret} from "firebase-functions/params";
import {exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  getUserPlayedGames,
  makeUniversalSearch} from "psn-api";

setGlobalOptions({maxInstances: 10});
const RAWG_API = defineSecret("RAWG_API");
const STEAM_API = defineSecret("STEAM_API");
const PS_API = defineSecret("PS_API");
const XBOX_API = defineSecret("XBOX_API");

type Game = {
    appid: number;
    name: string;
}

type SteamAPIResponse = {
  response : {
    total_count: number;
    games: Game[];}
}

type SteamVanity = {
  response: {
    steamid: string;
    success: number;
  }
}

type RawgGame = {
  id: number;
  name: string;
  background_image?: string;
}

type RawgApiResponse = {
  count: number;
  results: RawgGame[];
}

type PsGame = {
  appid: string;
  name: string;
  logo?: string; // Optional logo field for PS games
}

type PsnSearchResponse = {
  domainResponses: {
    results: {
      socialMetadata: {
        accountId: string;
      };
    }[];
  }[];
}

type PsnPlayedGames = {
  titleId: string;
  name: string;
  category: string;
  imageUrl?: string;
}

type PsnPlayedResponse = {
  titles: PsnPlayedGames[];
  nextOffset?: number;
}

type XboxGame = {
  titleId: string;
  name: string;
  displayImage?: string;
};

type XboxApiResponse = {
  xuid: string;
  titles: XboxGame[];
};

type XboxUserSearchResponse = {
  people: {
    xuid: string;
    gamertag: string;
  }[];
}

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
      const data: RawgApiResponse = await response.json();
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
      const data: SteamVanity = await response.json();
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
      const gamesData: SteamAPIResponse = await gamesResponse.json();
      const simplifiedGames: Game[] = gamesData.response.games.map((game) => ({
        appid: game.appid,
        name: game.name,
      }));
      res.status(200).json({games: simplifiedGames});
    } catch (error) {
      logger.error("API fetch failed:", error);
      res.status(500).send("Failed to fetch Steam games");
    }
  });

export const fetchPSGames = onRequest(
  {secrets: [PS_API], timeoutSeconds: 300},
  async (req, res) => {
    const psnUsername = req.query.username as string;
    if (!psnUsername) {
      res.status(400).send("Missing PSN username");
      return;
    }
    try {
      const myNpsso = PS_API.value();
      const accessCode = await exchangeNpssoForAccessCode(myNpsso);
      const authorization = await exchangeAccessCodeForAuthTokens(accessCode);

      const accountSearch: PsnSearchResponse = await makeUniversalSearch(
        authorization,
        psnUsername,
        "SocialAllAccounts");
      const accountId = accountSearch
        .domainResponses[0]
        .results[0]
        .socialMetadata
        .accountId;

      const psGames: PsGame[] = [];
      let offset = 0;
      let hasNextPage = true;

      while (hasNextPage) {
        const playedGames: PsnPlayedResponse = await getUserPlayedGames(
          authorization,
          accountId,
          {limit: 100, offset});

        playedGames.titles.forEach((game) => {
          if (game.category === "ps4_game" ||
            game.category === "ps5_native_game"
          ) {
            psGames.push({
              appid: game.titleId,
              name: game.name,
              logo: game.imageUrl,
            });
          }
        });

        if (!playedGames.nextOffset || playedGames.nextOffset === 0) {
          hasNextPage = false;
        }

        offset = playedGames.nextOffset ?? 0;
      }

      res.status(200).json({total: psGames.length, games: psGames});
    } catch (error) {
      logger.error("Error fetching PS games:", error);
      res.status(500).send("Failed to fetch PS games");
    }
  }
);

export const fetchXboxGames = onRequest(
  {secrets: [XBOX_API]}, async (req, res) => {
    const xboxKey = XBOX_API.value();
    const username = req.query.username as string;

    try {
      const usernameResp = await fetch(
        `https://xbl.io/api/v2/search/${username}`,
        {
          method: "GET",
          headers: {
            "X-Authorization": xboxKey,
          },
        });

      if (!usernameResp.ok) {
        res.status(usernameResp.status).send("Failed to fetch Xbox XUID");
        return;
      }

      const xuidData: XboxUserSearchResponse = await usernameResp.json();
      const numericId = String(xuidData.people[0].xuid).trim();
      if (!numericId) {
        res.status(404).send("Xbox user not found");
        return;
      }

      const url = `https://xbl.io/api/v2/player/titleHistory/${numericId}`;

      const resp = await fetch(url, {
        method: "GET",
        headers: {
          "X-Authorization": xboxKey,
          "Accept-Language": "en-US",
        },
      });

      if (!resp.ok) {
        res.status(resp.status).send("Failed to fetch Xbox games, resp not ok");
        return;
      }

      const data: XboxApiResponse = await resp.json();
      const titles: XboxGame[] = data.titles || [];
      const gamesInfo = titles.map((game) => {
        return {
          appid: game.titleId,
          name: game.name,
          logo: game.displayImage,
        };
      });

      res.json({
        games: gamesInfo,
        total: titles.length,
      });
    } catch (error) {
      logger.error("Error fetching Xbox games:", error);
      res.status(500).send("Failed to fetch Xbox games");
    }
  });
