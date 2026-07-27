const http = require("http");
const url = require("url");
const crypto = require("crypto");
const { execSync } = require("child_process");

const GML_BACKEND = { host: "127.0.0.1", port: 5003 };
const PROXY_PORT = 5004;
const ACCESS_TOKEN_ZEROED = "00000000000000000000000000000000000000000000000000";
const SECURITY_KEY = "SuperSecretPolitEmpireKey2026WithLotsOfNumbers12345";
const PROFILE_DETAILS_PATH = "/api/v1/profiles/details";
const SIGNIN_PATHS = ["/api/v1/integrations/auth/signin", "/api/v1/users/signin"];
const UPGRADE_PATHS = ["/api/v1/integrations/authlib/minecraft/sessionserver/session/minecraft/join"];
const HASJOINED_PATH = "/api/v1/integrations/authlib/minecraft/sessionserver/session/minecraft/hasJoined";
const NEWS_PATH = "/api/v1/integrations/news";
const NEWS_DATA = JSON.stringify({
  data: [
    {
      id: 1,
      title: "Polit Empire - Добро пожаловать!",
      description: "Сервер в разработке. Следите за обновлениями!",
      content: "Добро пожаловать на сервер Polit Empire! Мы активно разрабатываем новые механики и контент. Присоединяйтесь к нашему Discord серверу, чтобы быть в курсе всех обновлений.",
      date: "2026-07-27T10:00:00+03:00",
      imageUrl: "",
      type: 0,
    },
  ],
  totalCount: 1,
});
const DB_PATH = "/opt/polit-empire/data/GmlBackend/data.db";
const PROFILE_TEMPLATE_TTL_MS = 60_000; // 1 minute
const profileTemplateCache = new Map(); // key -> { json, expiresAt }

function getProfileTemplateKey(bodyJson) {
  return JSON.stringify({
    ProfileName: bodyJson.ProfileName,
    OsType: bodyJson.OsType,
    OsArchitecture: bodyJson.OsArchitecture,
    IsFullScreen: bodyJson.IsFullScreen,
    GameAddress: bodyJson.GameAddress,
    GamePort: bodyJson.GamePort,
    WindowWidth: bodyJson.WindowWidth,
    WindowHeight: bodyJson.WindowHeight,
    RamSize: bodyJson.RamSize,
  });
}

function getCachedProfileTemplate(bodyJson) {
  const key = getProfileTemplateKey(bodyJson);
  const entry = profileTemplateCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.json;
  }
  return null;
}

function setCachedProfileTemplate(bodyJson, json) {
  const key = getProfileTemplateKey(bodyJson);
  profileTemplateCache.set(key, { json, expiresAt: Date.now() + PROFILE_TEMPLATE_TTL_MS });
  for (const [k, v] of profileTemplateCache) {
    if (v.expiresAt <= Date.now()) profileTemplateCache.delete(k);
  }
}

function saveAccessTokenToDb(userUuid, accessToken) {
  try {
    const escapedUuid = userUuid.replace(/'/g, "''");
    const escapedToken = accessToken.replace(/'/g, "''");
    execSync(`sqlite3 "${DB_PATH}" "UPDATE UserStorageItem SET AccessToken='${escapedToken}' WHERE Uuid='${escapedUuid}';"`);
  } catch (e) {
    console.log(`[gml-proxy] DB update error: ${e.message}`);
  }
}

function base64url(str) {
  return Buffer.from(str).toString("base64url");
}

function base64urlDecode(str) {
  return Buffer.from(str, "base64url").toString("utf8");
}

function signJwt(payload) {
  const h = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = base64url(JSON.stringify(payload));
  const s = crypto.createHmac("sha256", SECURITY_KEY).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

function makeAdminJwt() {
  const now = Math.floor(Date.now() / 1000);
  const roleKey = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
  const nameIdKey = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier";
  const nameKey = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name";
  const payload = {
    [nameIdKey]: "gml-proxy-admin",
    [nameKey]: "GmlProxyAdmin",
    [roleKey]: "Admin",
    permissions: [
      "launcher.view", "launcher.manage", "launcher.create", "launcher.update", "launcher.delete",
      "integrations.sentry.manage", "integrations.discord.update", "integrations.textures.update",
      "integrations.textures.view", "integrations.auth.view", "integrations.auth.create",
      "integrations.auth.update", "integrations.auth.delete", "integrations.news.manage",
      "integrations.news.view", "profiles.view", "profiles.create", "profiles.update",
      "profiles.delete", "players.manage", "players.view", "players.delete", "players.ban",
      "players.pardon", "servers.manage", "notifications.manage"
    ],
    nbf: now - 60,
    exp: now + 86400,
    iss: "gml-api",
    aud: "gml-clients"
  };
  return signJwt(payload);
}

function upgradeJwtToAdmin(jwt) {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(base64urlDecode(parts[1]));
    const roleKey = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
    const currentRole = payload[roleKey];
    if (currentRole === "Admin") return jwt;
    console.log(`[gml-proxy] upgrade JWT role: "${currentRole}" → "Admin"`);
    payload[roleKey] = "Admin";
    payload.permissions = [
      "launcher.view", "launcher.manage", "launcher.create", "launcher.update", "launcher.delete",
      "integrations.sentry.manage", "integrations.discord.update", "integrations.textures.update",
      "integrations.textures.view", "integrations.auth.view", "integrations.auth.create",
      "integrations.auth.update", "integrations.auth.delete", "integrations.news.manage",
      "integrations.news.view", "profiles.view", "profiles.create", "profiles.update",
      "profiles.delete", "players.manage", "players.view", "players.delete", "players.ban",
      "players.pardon", "servers.manage", "notifications.manage"
    ];
    payload.exp = Math.floor(Date.now() / 1000) + 86400;
    payload.jti = crypto.randomUUID();
    return signJwt(payload);
  } catch (e) {
    console.log(`[gml-proxy] upgradeJwtToAdmin error: ${e.message}`);
    return null;
  }
}

function cleanHeaders(headers) {
  const h = { ...headers };
  delete h["transfer-encoding"];
  delete h["content-length"];
  delete h["connection"];
  delete h["keep-alive"];
  // Тело здесь уже собрано и отдаётся как есть, а часть ответов пересобирается
  // (profiles/details, join). Заголовок сжатия от бэкенда к такому телу больше
  // не относится: клиент по нему пытается распаковать несжатые байты и падает
  // с "error decoding response body" вместо показа ошибки входа.
  delete h["content-encoding"];
  return h;
}

function normalizeArch(arch) {
  if (!arch) return arch;
  const a = String(arch).toLowerCase();
  if (a === "x64" || a === "amd64") return "64";
  if (a === "x86" || a === "i386" || a === "i686") return "32";
  if (a === "aarch64") return "arm64";
  return arch;
}

function normalizeProfileBody(bodyBuf) {
  try {
    const body = JSON.parse(bodyBuf.toString("utf8"));
    if (body.OsArchitecture) {
      const normalized = normalizeArch(body.OsArchitecture);
      if (normalized !== body.OsArchitecture) {
        console.log(`[gml-proxy] normalize OsArchitecture: ${body.OsArchitecture} -> ${normalized}`);
        body.OsArchitecture = normalized;
      }
    }
    return Buffer.from(JSON.stringify(body), "utf8");
  } catch (e) {
    return bodyBuf;
  }
}

function requestBackend(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    if (body && body.length > 0) req.write(body);
    req.end();
  });
}

function extractJwtPayload(jwt) {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(base64urlDecode(parts[1]));
  } catch (e) {
    return null;
  }
}

function patchProfileArguments(args, realAccessToken) {
  if (!args) return args;
  const accessTokenRegex = /(--accessToken\s+)\S+/;
  return args.replace(accessTokenRegex, `$1${realAccessToken}`);
}

function getUserFromDb(userUuid) {
  try {
    const escapedUuid = userUuid.replace(/'/g, "''");
    const value = execSync(`sqlite3 "${DB_PATH}" "SELECT Value FROM UserStorageItem WHERE Uuid='${escapedUuid}';"`).toString("utf8").trim();
    if (!value) return null;
    const userJson = JSON.parse(value);
    return {
      uuid: userUuid,
      name: userJson.Name,
      accessToken: userJson.AccessToken,
    };
  } catch (e) {
    console.log(`[gml-proxy] DB lookup error: ${e.message}`);
    return null;
  }
}

function extractRealAccessToken(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const payload = extractJwtPayload(token);
  if (!payload) return null;
  const nameIdKey = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier";
  const userUuid = payload[nameIdKey] || payload.sub || payload.uuid || payload.userId || payload.nameid;
  if (!userUuid) return null;
  const user = getUserFromDb(userUuid);
  if (!user) return null;
  return user.accessToken;
}

function extractUserFromSignin(body) {
  try {
    const json = JSON.parse(body.toString("utf8"));
    return { accessToken: json.accessToken, uuid: json.uuid, userName: json.userName || json.login };
  } catch (e) {
    return null;
  }
}

function getUserByNameFromDb(userName) {
  try {
    const escapedName = userName.replace(/'/g, "''");
    const value = execSync(`sqlite3 "${DB_PATH}" "SELECT Uuid, Value FROM UserStorageItem WHERE Login='${escapedName}' COLLATE NOCASE;"`).toString("utf8").trim();
    if (!value) return null;
    const parts = value.split("|");
    if (parts.length < 2) return null;
    const uuid = parts[0];
    const userJson = JSON.parse(parts.slice(1).join("|"));
    return {
      uuid,
      name: userJson.Name,
      accessToken: userJson.AccessToken,
      isBanned: userJson.IsBanned || false,
      serverExpiredDate: userJson.ServerExpiredDate ? new Date(userJson.ServerExpiredDate) : null,
    };
  } catch (e) {
    console.log(`[gml-proxy] DB lookup error: ${e.message}`);
    return null;
  }
}

async function handleHasJoined(req, res, query) {
  const userName = query.username;
  const serverId = query.serverId;
  if (!userName) {
    res.writeHead(204);
    res.end();
    return;
  }
  const user = getUserByNameFromDb(userName);
  if (!user) {
    console.log(`[gml-proxy] hasJoined: user not found ${userName}`);
    res.writeHead(204);
    res.end();
    return;
  }
  if (user.isBanned) {
    console.log(`[gml-proxy] hasJoined: user banned ${userName}`);
    res.writeHead(204);
    res.end();
    return;
  }
  console.log(`[gml-proxy] hasJoined: ok for ${userName}, fetching profile`);
  const backendRes = await requestBackend(
    {
      host: GML_BACKEND.host,
      port: GML_BACKEND.port,
      path: `/api/v1/integrations/authlib/minecraft/sessionserver/session/minecraft/profile/${user.uuid}`,
      method: "GET",
      headers: {
        "Host": req.headers["host"] || "localhost",
      },
    },
    Buffer.alloc(0)
  );
  if (backendRes.statusCode !== 200) {
    console.log(`[gml-proxy] hasJoined: backend profile returned ${backendRes.statusCode}`);
    res.writeHead(backendRes.statusCode, cleanHeaders(backendRes.headers));
    res.end(backendRes.body);
    return;
  }
  res.writeHead(200, {
    ...cleanHeaders(backendRes.headers),
    "content-type": "application/json",
    "content-length": backendRes.body.length,
  });
  res.end(backendRes.body);
}

async function proxy(req, res, body) {
  const parsed = url.parse(req.url, true);
  const isSignin = SIGNIN_PATHS.includes(parsed.pathname);
  const isUpgrade = UPGRADE_PATHS.includes(parsed.pathname);
  const isProfileDetails = parsed.pathname === PROFILE_DETAILS_PATH;
  const isHasJoined = parsed.pathname === HASJOINED_PATH;
  const isNews = parsed.pathname === NEWS_PATH;
  const isApiV1 = parsed.pathname.startsWith("/api/v1/");

  if (isHasJoined) {
    return handleHasJoined(req, res, parsed.query);
  }
  if (isNews && req.method === "GET") {
    const newsBuf = Buffer.from(NEWS_DATA, "utf8");
    res.writeHead(200, { "content-type": "application/json", "content-length": newsBuf.length });
    res.end(newsBuf);
    return;
  }

  let authHeader = req.headers["authorization"] || "";
  let realAccessToken = null;
  let userName = null;
  let userUuid = null;

  if (isSignin) {
    const info = extractUserFromSignin(body);
    if (info && info.uuid && info.accessToken) {
      saveAccessTokenToDb(info.uuid, info.accessToken);
    }
  } else if (isApiV1 && authHeader) {
    const payload = extractJwtPayload(authHeader.replace(/^Bearer\s+/i, ""));
    if (payload) {
      realAccessToken = extractRealAccessToken(authHeader);
      const nameKey = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name";
      const nameIdKey = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier";
      userName = payload[nameKey];
      userUuid = payload[nameIdKey] || payload.sub;
      console.log(`[gml-proxy] ${parsed.pathname}: user=${userName} uuid=${userUuid}`);
    }
  }

  if (isUpgrade) {
    try {
      const json = JSON.parse(body.toString("utf8"));
      if (json.selectedProfile && (json.selectedProfile.id === "0000000000000000000000000000000" || json.selectedProfile.name === "GmlAdmin")) {
        if (userUuid) {
          json.selectedProfile = { id: userUuid.replace(/-/g, ""), name: userName };
          body = Buffer.from(JSON.stringify(json), "utf8");
          console.log(`[gml-proxy] join: fixed selectedProfile ${userName} / ${userUuid}`);
        }
      }
    } catch (e) {}
  }

  if (isProfileDetails && authHeader) {
    const adminJwt = upgradeJwtToAdmin(authHeader.replace(/^Bearer\s+/i, ""));
    if (adminJwt) {
      authHeader = `Bearer ${adminJwt}`;
    } else {
      authHeader = `Bearer ${makeAdminJwt()}`;
    }
    body = normalizeProfileBody(body);
  }

  let responseBody = null;
  let statusCode = 200;
  let backendHeaders = {};

  if (isProfileDetails && authHeader && realAccessToken) {
    const bodyJson = JSON.parse(body.toString("utf8"));
    let templateJson = getCachedProfileTemplate(bodyJson);
    if (templateJson) {
      console.log(`[gml-proxy] profile/details: using cached template for ${bodyJson.ProfileName}`);
    } else {
      console.log(`[gml-proxy] profile/details: fetching backend template for ${bodyJson.ProfileName}`);
      const backendRes = await requestBackend(
        {
          host: GML_BACKEND.host,
          port: GML_BACKEND.port,
          path: PROFILE_DETAILS_PATH,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": authHeader,
          },
        },
        body
      );
      if (backendRes.statusCode >= 200 && backendRes.statusCode < 300) {
        try {
          const backendJson = JSON.parse(backendRes.body.toString("utf8"));
          setCachedProfileTemplate(bodyJson, backendJson);
          templateJson = backendJson;
        } catch (e) {
          console.log(`[gml-proxy] profile/details: cache parse error ${e.message}`);
        }
      }
      if (!templateJson) {
        statusCode = backendRes.statusCode;
        responseBody = backendRes.body;
        backendHeaders = backendRes.headers;
      }
    }
    if (templateJson) {
      const patched = JSON.parse(JSON.stringify(templateJson));
      if (patched.data && patched.data.accessToken === ACCESS_TOKEN_ZEROED) {
        patched.data.accessToken = realAccessToken;
      }
      if (patched.data && typeof patched.data.profile?.arguments === "string") {
        patched.data.profile.arguments = patchProfileArguments(patched.data.profile.arguments, realAccessToken);
      }
      responseBody = Buffer.from(JSON.stringify(patched), "utf8");
      backendHeaders = { "content-type": "application/json" };
      console.log(`[gml-proxy] profile/details: replaced zeroed token for ${userName}`);
    }
  } else {
    const headers = { ...req.headers };
    delete headers["host"];
    // Просим бэкенд не сжимать: тело читается и местами пересобирается здесь,
    // а распаковки gzip в прокси нет.
    headers["accept-encoding"] = "identity";
    if (authHeader) headers["authorization"] = authHeader;
    const backendRes = await requestBackend(
      {
        host: GML_BACKEND.host,
        port: GML_BACKEND.port,
        path: req.url,
        method: req.method,
        headers,
      },
      body
    );
    responseBody = backendRes.body;
    statusCode = backendRes.statusCode;
    backendHeaders = backendRes.headers;
  }

  const outHeaders = cleanHeaders(backendHeaders);
  outHeaders["content-length"] = responseBody.length;
  res.writeHead(statusCode, outHeaders);
  res.end(responseBody);
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    try {
      await proxy(req, res, body);
    } catch (e) {
      console.log(`[gml-proxy] error: ${e.message}`);
      // JSON, а не text/plain: клиенты (лаунчер, authlib, GML) разбирают ответы
      // как JSON, и текстовое тело выглядело для них как повреждённый ответ.
      const errBody = Buffer.from(
        JSON.stringify({ status: "BadGateway", statusCode: 502, message: "Сервис авторизации недоступен", errors: [] }),
        "utf8"
      );
      res.writeHead(502, { "content-type": "application/json; charset=utf-8", "content-length": errBody.length });
      res.end(errBody);
    }
  });
  req.on("error", (e) => {
    console.log(`[gml-proxy] request error: ${e.message}`);
    res.writeHead(400);
    res.end();
  });
});

server.listen(PROXY_PORT, "127.0.0.1", () => {
  console.log(`[gml-proxy] listening on 127.0.0.1:${PROXY_PORT}`);
});
