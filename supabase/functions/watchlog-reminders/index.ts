import "./regional-releases.js";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import {
  generateVAPIDKeys,
  sendNotification,
  type PushSubscription,
  type VapidDetails,
} from "npm:web-push-neo@0.1.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-watchlog-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// Deployment-status requests authenticate by verifying the completed run against GitHub Actions below.
// Deploy this function with platform JWT verification disabled; other actions enforce their own session/cron checks.
const enc = new TextEncoder();
const VAPID_SUBJECT = "mailto:push@watched-logger.app";
const MAX_PUSH_ATTEMPTS = 5;
const EPISODE_SCHEDULE_REFRESH_MS = 6 * 60 * 60 * 1000;
const ALLOWED_PUSH_HOSTS = new Set([
  "web.push.apple.com",
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
]);

type PushRow = {
  id: string;
  account_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration_time: number | null;
  time_zone: string;
  locale: string;
  enabled: boolean;
};

type PushConfig = {
  vapid_public_key: string | null;
  vapid_private_key: string | null;
  cron_secret: string;
  last_scan_at: string | null;
};

type LibraryRow = {
  account_id: string;
  items: unknown;
  revision: number;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function validTimeZone(value: unknown) {
  const candidate = String(value || "UTC").slice(0, 80);
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

function validPushEndpoint(value: unknown) {
  const endpoint = String(value || "").trim();
  if (!endpoint || endpoint.length > 4096) return "";
  try {
    const url = new URL(endpoint);
    const allowed =
      url.protocol === "https:" &&
      (ALLOWED_PUSH_HOSTS.has(url.hostname) ||
        url.hostname.endsWith(".push.apple.com") ||
        url.hostname.endsWith(".push.services.mozilla.com"));
    return allowed ? endpoint : "";
  } catch {
    return "";
  }
}

async function getSession(req: Request) {
  const bearer = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  const token = req.headers.get("x-watchlog-session")?.trim() || bearer || "";
  if (!token) return null;

  const tokenHash = await sha256(token);
  const { data, error } = await db
    .from("watchlog_pin_sessions")
    .select("account_id,expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  return { accountId: String(data.account_id) };
}

async function readConfig(generateIfMissing = false): Promise<PushConfig> {
  const load = async () => {
    const { data, error } = await db
      .from("watchlog_push_config")
      .select("vapid_public_key,vapid_private_key,cron_secret,last_scan_at")
      .eq("singleton", true)
      .single();
    if (error) throw error;
    return data as PushConfig;
  };

  let config = await load();
  if (
    generateIfMissing &&
    (!config.vapid_public_key || !config.vapid_private_key)
  ) {
    const keys = await generateVAPIDKeys();
    const { error } = await db
      .from("watchlog_push_config")
      .update({
        vapid_public_key: keys.publicKey,
        vapid_private_key: keys.privateKey,
        updated_at: new Date().toISOString(),
      })
      .eq("singleton", true);
    if (error) throw error;
    config = await load();
  }
  return config;
}

function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const requestedAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = requestedAsUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let pass = 0; pass < 3; pass++) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    ) as Record<string, number>;
    const displayedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const correction = displayedAsUtc - requestedAsUtc;
    if (correction === 0) break;
    guess -= correction;
  }
  return guess;
}

function scheduledEventTime(rawValue: unknown, timeZone: string) {
  const raw = String(rawValue || "").trim();
  if (!raw) return Number.NaN;

  if (/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    return new Date(raw).getTime();
  }

  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?$/,
  );
  if (!match) return new Date(raw).getTime();

  const [, year, month, day, hour, minute] = match;
  // A date without a time is treated as noon locally, avoiding midnight alerts.
  return zonedLocalToUtc(
    Number(year),
    Number(month),
    Number(day),
    hour === undefined ? 12 : Number(hour),
    minute === undefined ? 0 : Number(minute),
    timeZone,
  );
}

function episodeUtcValue(episode) {
  const raw = String(episode?.airstamp || "").trim();
  if (raw) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(String(episode?.airdate || ""))
    ? String(episode.airdate)
    : "";
}

function episodeReleaseTime(episode) {
  const value = episodeUtcValue(episode);
  if (!value) return 0;
  const time = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59Z` : value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function buildServerEpisodeSchedule(item, episodesRaw, now = Date.now()) {
  const episodes = (Array.isArray(episodesRaw) ? episodesRaw : [])
    .filter((episode) => Number.isInteger(Number(episode?.season)) && Number(episode.season) > 0 && Number.isInteger(Number(episode?.number)) && Number(episode.number) > 0)
    .map((episode) => ({ ...episode, season: Number(episode.season), number: Number(episode.number) }));
  const episodeCounts = {}, airedEpisodeCounts = {}, releasedEpisodes = {};
  for (const episode of episodes) {
    episodeCounts[episode.season] = Math.max(Number(episodeCounts[episode.season] || 0), episode.number);
    const time = episodeReleaseTime(episode);
    if (time > 0 && time <= now) {
      airedEpisodeCounts[episode.season] = Math.max(Number(airedEpisodeCounts[episode.season] || 0), episode.number);
      (releasedEpisodes[episode.season] ||= []).push(episode.number);
    }
  }
  for (const season of Object.keys(releasedEpisodes)) releasedEpisodes[season] = [...new Set(releasedEpisodes[season])].sort((a, b) => a - b);
  const released = episodes.filter((episode) => episodeReleaseTime(episode) > 0 && episodeReleaseTime(episode) <= now).sort((a, b) => episodeReleaseTime(a) - episodeReleaseTime(b));
  const future = episodes.filter((episode) => episodeReleaseTime(episode) > now).sort((a, b) => episodeReleaseTime(a) - episodeReleaseTime(b) || a.season - b.season || a.number - b.number);
  const latest = released.at(-1) || null, next = future[0] || null;
  const latestSeason = Number(latest?.season || 0), nextSeason = Number(next?.season || 0), highest = Math.max(0, ...episodes.map((episode) => episode.season));
  return {
    ...item,
    totalSeasons: Math.max(Number(item?.totalSeasons || 0), highest) || null,
    episodeCounts,
    airedEpisodeCounts,
    releasedEpisodes,
    // Persist a short release window independently of the mutable "next"
    // pointer, so the release just passed is still eligible for its alert.
    scheduledEpisodeReleases: episodes.filter(episode => {
      const time = episodeReleaseTime(episode);
      return time > 0 && time >= now - 2 * 86400000 && time <= now + 8 * 86400000;
    }).map(episode => ({ season: episode.season, number: episode.number, raw: episodeUtcValue(episode) })),
    serverScheduleUpdatedAt: new Date(now).toISOString(),
    episodeScheduleVerified: true,
    airingSeason: latestSeason || null,
    latestEpisodeNum: latest?.number ?? null,
    latestEpisodeTitle: String(latest?.name || ""),
    latestEpisodeDate: episodeUtcValue(latest),
    nextEpisodeNum: next?.number ?? null,
    nextEpisodeTitle: String(next?.name || ""),
    nextEpisodeDate: episodeUtcValue(next),
    nextSeasonNum: nextSeason > latestSeason ? nextSeason : "",
    nextSeasonDate: nextSeason > latestSeason ? episodeUtcValue(next) : "",
    metadataUpdatedAt: new Date(now).toISOString(),
  };
}

function serverScheduleRefreshDue(item: Record<string, unknown>, now = Date.now()) {
  if (!["Series", "Anime"].includes(String(item?.type || "")) || !item?.tvmazeShowId) return false;
  const next = scheduledEventTime(item.nextEpisodeDate, "UTC"), refreshed = new Date(String(item.serverScheduleUpdatedAt || "")).getTime();
  return !Array.isArray(item.scheduledEpisodeReleases) || !Number.isFinite(refreshed) || now - refreshed >= EPISODE_SCHEDULE_REFRESH_MS || (Number.isFinite(next) && next <= now);
}

async function readLibraries(accountIds: string[]) {
  const {data,error}=await db.rpc("watchlog_read_libraries",{p_accounts:accountIds});
  if(error)throw error;return data||[];
}
async function privateLibrary(accountId: string) {
  try{return {data:(await readLibraries([accountId]))[0]||null,error:null};}
  catch(error){return {data:null,error};}
}

async function refreshServerEpisodeSchedules(libraries: LibraryRow[], now = Date.now()) {
  const requests = new Map<string, Promise<unknown[] | null>>();
  const load = (showId: unknown) => {
    const key = String(showId);
    if (!/^[1-9]\d*$/.test(key)) return Promise.resolve(null);
    if (!requests.has(key)) requests.set(key, fetch(`https://api.tvmaze.com/shows/${key}/episodes`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) }).then(async (response) => { if (!response.ok) return null; const data = await response.json(); return Array.isArray(data) ? data : null; }).catch(() => null));
    return requests.get(key)!;
  };
  // Bound work on cold scans and rotate through larger catalogues fairly.
  const due = [...new Set(libraries.flatMap(library => (Array.isArray(library.items) ? library.items : []).filter(item => serverScheduleRefreshDue(item, now)).map(item => String(item.tvmazeShowId))))].sort();
  const offset = due.length ? (Math.floor(now / 60000) * 60) % due.length : 0;
  const queue = [...due.slice(offset), ...due.slice(0, offset)].slice(0, 60);
  const results = new Map<string, unknown[]>();
  let cursor = 0;
  const deadline = Date.now() + 25000;
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (cursor < queue.length && Date.now() < deadline) {
      const key = queue[cursor++], episodes = await load(key);
      if (episodes !== null) results.set(key, episodes);
    }
  }));
  const refreshed = [];
  for (const library of libraries || []) {
    const source = (Array.isArray(library.items) ? library.items : []) as Record<string, unknown>[], items = [...source];
    let changed = false;
    for (let index = 0; index < items.length; index++) {
      if (!serverScheduleRefreshDue(items[index], now)) continue;
      const episodes = results.get(String(items[index].tvmazeShowId));
      if (!episodes) continue;
      const updated = buildServerEpisodeSchedule(items[index], episodes, now);
      if (JSON.stringify(updated) !== JSON.stringify(items[index])) { items[index] = updated; changed = true; }
    }
    if (changed) {
      const revision = Math.max(0, Number(library.revision || 0));
      const changes=items.flatMap((item,index)=>item===source[index]?[]:[{id:String(item.id),set:Object.fromEntries(Object.entries(item).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(source[index][key])))}]);
      const { data: result, error } = await db.rpc("watchlog_patch_library",{p_account:library.account_id,p_revision:revision,p_changes:changes});
      const saved=result?.ok===true;
      if (error) console.error("Server episode schedule save failed", error.code || error.message);
      if (!saved) {
        // A user edited/deleted a title while the catalogue request was in
        // flight. Do not send alerts using that stale library snapshot.
        const latest=(await readLibraries([library.account_id]))[0];
        if (latest) refreshed.push(latest);
        continue;
      }
    }
    refreshed.push({ ...library, items });
  }
  return refreshed;
}

function plannedEvent(item: Record<string, unknown>) {
  const nextEpisodeDate = String(item.nextEpisodeDate || "");
  const nextSeasonDate = String(item.nextSeasonDate || "");
  const filmReleaseDate =
    String(item.type || "") === "Film" ? String(item.filmReleaseDate || "") : "";

  if (nextEpisodeDate) {
    return {
      kind: "episode",
      raw: nextEpisodeDate,
      number: item.nextEpisodeNum,
    };
  }
  if (nextSeasonDate) {
    return {
      kind: "season",
      raw: nextSeasonDate,
      number: item.nextSeasonNum,
    };
  }
  if (filmReleaseDate) {
    return { kind: "film", raw: filmReleaseDate, number: null };
  }
  return null;
}

function reminderEvents(item: Record<string, unknown>) {
  // Weekly Releases opt-out is also the per-show reminder opt-out. Reminders
  // are derived from the current library on each scan, so returning no events
  // cancels pending eligibility without deleting the show or its episode
  // schedule. Clearing the preference makes its events eligible again.
  if (item.hideFromWeeklyReleases === true) return [];
  if (!["Series", "Anime"].includes(String(item.type))) {
    const fallback = plannedEvent(item);
    return fallback ? [fallback] : [];
  }
  // The mutable next pointer can advance before a scheduled scan, and a
  // provider refresh can fail or leave an empty schedule. Keep all confirmed
  // sources, preferring the current provider schedule for each episode.
  const activeSeason = Number(item.airingSeason || item.curSeason || 0);
  const confirmed = [...(Array.isArray(item.scheduledEpisodeReleases) ? item.scheduledEpisodeReleases : []), ...(Array.isArray(item.recurringWeeklySchedule?.episodes) ? item.recurringWeeklySchedule.episodes : [])];
  const match = confirmed.find(episode => Number(episode?.number) === Number(item.nextEpisodeNum) && episode?.raw === item.nextEpisodeDate);
  const nextSeason = Number(match?.season || (Number(item.nextEpisodeNum) === 1 ? item.nextSeasonNum || activeSeason : activeSeason));
  const rows = [
    ...(Array.isArray(item.recurringWeeklySchedule?.episodes) ? item.recurringWeeklySchedule.episodes : []),
    { season: activeSeason, number: item.latestEpisodeNum, raw: item.latestEpisodeDate },
    { season: nextSeason, number: item.nextEpisodeNum, raw: item.nextEpisodeDate },
    ...(Array.isArray(item.scheduledEpisodeReleases) ? item.scheduledEpisodeReleases : []),
  ];
  const byEpisode = new Map();
  for (const episode of rows) {
    const raw = String(episode?.raw || "").trim(), number = Number(episode?.number), season = Number(episode?.season || 0);
    if (!raw || !Number.isInteger(number) || number < 1 || !Number.isInteger(season) || season < 0) continue;
    byEpisode.set(`${season}:${number}`, { kind: "episode", raw, number, season });
  }
  const events = [...byEpisode.values()];
  if (item.nextSeasonDate && !events.some(event => event.season === Number(item.nextSeasonNum) && event.number === 1)) {
    events.push({ kind: "season", raw: String(item.nextSeasonDate), number: Number(item.nextSeasonNum), season: Number(item.nextSeasonNum) });
  }
  return events;
}

function reminderCopy(
  item: Record<string, unknown>,
  event: { kind: string; number: unknown },
  leadHours: number,
) {
  const title = String(item.title || "").replace(/\s+/g, " ").trim() || "Watched Logger";
  const timing = leadHours === 24 ? "in 1 day" : leadHours === 1 ? "in 1 hour" : `in ${leadHours} hours`;
  const label = event.kind === "episode" ? "New episode"
    : event.kind === "season" ? (event.number ? `Season ${event.number}` : "New season") : "";
  const body = leadHours === 0 ? (label ? `${label} now available` : "Now available")
    : label ? `${label} ${timing}` : `Available ${timing}`;
  return { title, body };
}

function toPushSubscription(row: PushRow): PushSubscription {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  };
}

function statusCodeFor(error: unknown) {
  const candidate = error as { statusCode?: unknown; status?: unknown };
  const value = Number(candidate?.statusCode ?? candidate?.status ?? 0);
  return Number.isFinite(value) ? value : 0;
}

async function sendPush(
  row: PushRow,
  config: PushConfig,
  payload: Record<string, unknown>,
) {
  if (!config.vapid_public_key || !config.vapid_private_key) {
    throw new Error("VAPID keys are not configured");
  }

  const vapidDetails: VapidDetails = {
    subject: VAPID_SUBJECT,
    publicKey: config.vapid_public_key,
    privateKey: config.vapid_private_key,
  };

  await sendNotification(
    toPushSubscription(row),
    JSON.stringify(payload),
    {
      vapidDetails,
      TTL: 86400,
      urgency: "high",
      signal: AbortSignal.timeout(12000),
    },
  );
}

async function disableExpiredSubscription(row: PushRow) {
  await db
    .from("watchlog_push_subscriptions")
    .update({
      enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
}

async function claimDelivery(
  row: PushRow,
  accountId: string,
  itemId: string,
  eventKey: string,
  scheduledFor: string,
  legacyKeys: string[] = [],
) {
  if (legacyKeys.length) {
    const { data: sent, error } = await db.from("watchlog_push_deliveries").select("id").eq("subscription_id", row.id).in("event_key", legacyKeys).eq("status", "sent").limit(1);
    if (error) throw error;
    if (sent?.length) return null;
  }
  const nowIso = new Date().toISOString();
  const { data: existing } = await db
    .from("watchlog_push_deliveries")
    .select("id,status,attempts,next_attempt_at")
    .eq("subscription_id", row.id)
    .eq("event_key", eventKey)
    .maybeSingle();

  if (existing) {
    if (existing.status === "sent" || existing.status === "expired") return null;
    if (Number(existing.attempts || 0) >= MAX_PUSH_ATTEMPTS) return null;
    if (
      existing.next_attempt_at &&
      new Date(existing.next_attempt_at).getTime() > Date.now()
    ) {
      return null;
    }
    const attempts = Number(existing.attempts || 0) + 1;
    const { data, error } = await db
      .from("watchlog_push_deliveries")
      .update({
        status: "pending",
        attempts,
        next_attempt_at: null,
        updated_at: nowIso,
      })
      .eq("id", existing.id)
      .select("id,attempts")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await db
    .from("watchlog_push_deliveries")
    .insert({
      subscription_id: row.id,
      account_id: accountId,
      item_id: itemId,
      event_key: eventKey,
      scheduled_for: scheduledFor,
      status: "pending",
      attempts: 1,
    })
    .select("id,attempts")
    .single();

  if (error?.code === "23505") return null;
  if (error) throw error;
  return data;
}

async function finishDelivery(
  delivery: { id: string; attempts: number },
  row: PushRow,
  error?: unknown,
) {
  const now = new Date();
  if (!error) {
    await db
      .from("watchlog_push_deliveries")
      .update({
        status: "sent",
        sent_at: now.toISOString(),
        next_attempt_at: null,
        last_error: null,
        updated_at: now.toISOString(),
      })
      .eq("id", delivery.id);
    return;
  }

  const code = statusCodeFor(error);
  if (code === 404 || code === 410) {
    await disableExpiredSubscription(row);
    await db
      .from("watchlog_push_deliveries")
      .update({
        status: "expired",
        last_error: `Push subscription expired (${code})`,
        updated_at: now.toISOString(),
      })
      .eq("id", delivery.id);
    return;
  }

  const exhausted = Number(delivery.attempts || 0) >= MAX_PUSH_ATTEMPTS;
  const retryMinutes = Math.min(60, Math.max(5, Number(delivery.attempts || 1) * 5));
  await db
    .from("watchlog_push_deliveries")
    .update({
      status: exhausted ? "expired" : "retry",
      next_attempt_at: exhausted
        ? null
        : new Date(now.getTime() + retryMinutes * 60000).toISOString(),
      last_error: String((error as Error)?.message || error || "Push failed").slice(
        0,
        500,
      ),
      updated_at: now.toISOString(),
    })
    .eq("id", delivery.id);
}

async function processPlannedReminders(
  subscriptions: PushRow[],
  config: PushConfig,
) {
  const accountIds = [...new Set(subscriptions.map((row) => row.account_id))];
  if (!accountIds.length) return { sent: 0, failed: 0 };

  const libraryRows=await readLibraries(accountIds);
  const libraries = await refreshServerEpisodeSchedules(libraryRows || [], Date.now());

  const byAccount = new Map(
    (libraries || []).map((row) => [
      String(row.account_id),
      Array.isArray(row.items) ? row.items : [],
    ]),
  );
  if(globalThis.WatchLogRegionalReleases)await Promise.all([...new Set(subscriptions.map(row=>row.locale+':'+row.time_zone))].map(key=>{
    const row=subscriptions.find(row=>row.locale+':'+row.time_zone===key)!;
    let country='';try{country=new Intl.Locale(row.locale).region||'';}catch(_){}
    return globalThis.WatchLogRegionalReleases.refresh([...byAccount.values()].flat(),{country,timeZone:row.time_zone,locale:row.locale});
  }));
  const now = Date.now();
  let sent = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    const items = byAccount.get(subscription.account_id) || [];
    for (const original of items as Record<string, unknown>[]) {
      const item = globalThis.WatchLogRegionalReleases?.resolve(original, {country: (()=>{try{return new Intl.Locale(subscription.locale).region||"";}catch{return"";}})(),timeZone:subscription.time_zone,locale:subscription.locale}) || original;
      const status = String(item?.status || "");
      for (const originalEvent of reminderEvents(item)) {
      let country="";try{country=new Intl.Locale(subscription.locale).region||"";}catch(_){}
      const event=globalThis.WatchLogRegionalReleases?.resolveEvent(item,originalEvent,{country,timeZone:subscription.time_zone,locale:subscription.locale})||originalEvent;
      if(event.streamingUnconfirmed || (globalThis.WatchLogRegionalReleases && !item.releaseSchedule && !event.releaseSchedule))continue; // Never substitute a broadcast for streaming availability.
      const isPlanned = status === "Planned" || status === "Saved";
      // Every dated episode gets advance and release-time alerts regardless of
      // whether the tracked title is Planned, Watching, or Watched.
      if (!isPlanned && event.kind !== "episode") continue;
      const eventTime = scheduledEventTime(event.raw, subscription.time_zone);
      if (!Number.isFinite(eventTime)) continue;

      const leadTimes = [24, 6, 0];
      for (const leadHours of leadTimes) {
        if(/^\d{4}-\d{2}-\d{2}$/.test(event.raw))continue; // A date alone does not confirm an availability time.
        const reminderTime = eventTime - leadHours * 60 * 60 * 1000;
        // Catch up only the current stage. Reconnecting a device must not
        // deliver "in 1 day" and "in 6 hours" after the episode has released.
        if (!reminderStageIsDue(eventTime, leadHours, now)) {
          continue;
        }

        const itemId = String(item.id || (await sha256(String(item.title || ""))));
        const identity = event.kind === "episode" ? `episode:s${"season" in event ? event.season : Number(item.airingSeason || item.nextSeasonNum || 0)}e${event.number}` : event.kind;
        const eventKey = `${itemId}:${identity}:${event.raw}:lead-${leadHours}h`;
        const legacyKeys = event.kind === "episode" && Number(event.number) === Number(item.nextEpisodeNum)
          ? [...new Set([event.raw, String(item.nextEpisodeDate || "")].filter(Boolean))].map(raw => `${itemId}:episode:${raw}:lead-${leadHours}h`) : [];
        const delivery = await claimDelivery(
          subscription,
          subscription.account_id,
          itemId,
          eventKey,
          new Date(reminderTime).toISOString(),
          legacyKeys,
        );
        if (!delivery) continue;

        const copy = reminderCopy(item, event, leadHours);
        if(event.releaseSchedule||item.releaseSchedule)copy.body += ` on ${(event.releaseSchedule||item.releaseSchedule).platform}`;
        const payload = {
          title: copy.title,
          body: copy.body,
          tag: `watchlog-${await sha256(eventKey).then((v) => v.slice(0, 24))}`,
          data: { url: "./", itemId, eventKey, kind: "reminder" },
        };

        try {
          await sendPush(subscription, config, payload);
          await finishDelivery(delivery, subscription);
          sent++;
        } catch (pushError) {
          console.error("Planned reminder push failed", statusCodeFor(pushError));
          await finishDelivery(delivery, subscription, pushError);
          failed++;
        }
      }
      }
    }
  }

  return { sent, failed };
}

function reminderStageIsDue(eventTime: number, leadHours: number, now: number) {
  const hour = 3600000;
  const due = eventTime - leadHours * hour;
  const expires = leadHours === 24 ? eventTime - 6 * hour
    : leadHours === 6 ? eventTime : eventTime + 24 * hour;
  return Number.isFinite(eventTime) && now >= due && now < expires;
}

async function processCron(req: Request) {
  const config = await readConfig(false);
  const supplied = req.headers.get("x-watchlog-cron") || "";
  if (!supplied || !safeEqual(supplied, config.cron_secret)) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!config.vapid_public_key || !config.vapid_private_key) {
    return json({ ok: true, skipped: "push_not_enabled_yet" });
  }

  // Atomically claim the scan window. A read-then-write guard lets two cron
  // invocations pass at once; the conditional UPDATE permits only one winner.
  const claimTime = new Date();
  const staleBefore = new Date(claimTime.getTime() - 45000).toISOString();
  const { data: scanClaim, error: scanClaimError } = await db
    .from("watchlog_push_config")
    .update({
      last_scan_at: claimTime.toISOString(),
      updated_at: claimTime.toISOString(),
    })
    .eq("singleton", true)
    .or(`last_scan_at.is.null,last_scan_at.lt.${staleBefore}`)
    .select("singleton")
    .maybeSingle();
  if (scanClaimError) throw scanClaimError;
  if (!scanClaim) {
    return json({ ok: true, skipped: "scan_already_running" });
  }

  const { data, error } = await db
    .from("watchlog_push_subscriptions")
    .select(
      "id,account_id,endpoint,p256dh,auth,expiration_time,time_zone,locale,enabled",
    )
    .eq("enabled", true);
  if (error) throw error;

  const subscriptions = (data || []) as PushRow[];
  const planned = await processPlannedReminders(subscriptions, config);
  console.log(
    JSON.stringify({
      activeSubscriptions: subscriptions.length,
      planned,
    }),
  );
  return json({
    ok: true,
    activeSubscriptions: subscriptions.length,
    planned,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  const action = String(body.action || "");
  try {
    if (action === "public_key") {
      const config = await readConfig(true);
      return json({ ok: true, publicKey: config.vapid_public_key });
    }

    if (action === "deployment_status") {
      const runId = String(body.runId || "").slice(0, 24);
      const runNumber = String(body.runNumber || "").slice(0, 24);
      const runAttempt = String(body.runAttempt || "1").slice(0, 12);
      const failureSummary = String(body.failureSummary || "").replace(/[\r\n]+/g, " ").slice(0, 600);
      // Verify the displayed run identity and attempt against GitHub below.
      const sha = String(body.sha || "");
      const status = String(body.status || "");
      const commitUrl = String(body.commitUrl || "");
      const allowedStatuses = new Set(["success", "failure", "cancelled", "skipped"]);
      if (!/^\d+$/.test(runId) || !/^\d+$/.test(runNumber) || !/^\d+$/.test(runAttempt) || !/^[a-f0-9]{40}$/.test(sha) || !allowedStatuses.has(status)) return json({ error: "Invalid workflow status payload" }, 400);
      // Keep the GitHub credential server-side; never forward the workflow token.
      const githubToken = Deno.env.get("WATCHLOG_GITHUB_TOKEN") || "";
      if (!githubToken) return json({ error: "Run verification is not configured" }, 503);
      const githubHeaders = {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "WatchLogger-Run-Status",
      };
      const verification = await fetch(`https://api.github.com/repos/Cryptic011/Watched-Tracker/actions/runs/${runId}`, {
        headers: githubHeaders,
        signal: AbortSignal.timeout(10000),
      });
      if (!verification.ok) {
        console.error("Run-status GitHub verification request failed", verification.status);
        return json({ error: "Workflow run could not be verified", verificationStatus: verification.status }, 502);
      }
      const verifiedRun = await verification.json();
      const mismatch = {
        id: String(verifiedRun.id) !== runId,
        runNumber: Number(verifiedRun.run_number) !== Number(runNumber),
        runAttempt: Number(verifiedRun.run_attempt) !== Number(runAttempt),
        sha: String(verifiedRun.head_sha || "").toLowerCase() !== sha.toLowerCase(),
        active: verifiedRun.status !== "in_progress",
        // The workflow is still executing this always() step, so GitHub has
        // not published its conclusion yet. The scoped token proves run access.
        conclusion: verifiedRun.conclusion !== null && verifiedRun.conclusion !== undefined,
        workflow: Number(verifiedRun.workflow_id) !== 344533582,
      };
      if (Object.values(mismatch).some(Boolean)) {
        console.error("Run-status verification mismatch", JSON.stringify({ mismatch, runId, runNumber, sha, status, verified: { id: verifiedRun.id, run_number: verifiedRun.run_number, head_sha: verifiedRun.head_sha, status: verifiedRun.status, conclusion: verifiedRun.conclusion, workflow_id: verifiedRun.workflow_id } }));
        return json({ error: "Workflow status did not match GitHub", mismatch }, 403);
      }
      const ownerEmail = normalizeEmail(Deno.env.get("WATCHLOG_OWNER_EMAIL") || "");
      if (!ownerEmail) return json({ ok: true, delivered: 0, reason: "owner_account_not_configured" });
      const { data: account, error: accountError } = await db.from("watchlog_pin_accounts").select("id,email").ilike("email", ownerEmail).maybeSingle();
      if (accountError) throw accountError;
      if (!account || normalizeEmail(account.email) !== ownerEmail) return json({ ok: true, delivered: 0, reason: "owner_account_not_found" });
      const config = await readConfig(false);
      if (!config.vapid_public_key || !config.vapid_private_key) return json({ ok: true, delivered: 0, reason: "push_not_configured" });
      const { data: subscriptions, error: subscriptionError } = await db.from("watchlog_push_subscriptions").select("id,account_id,endpoint,p256dh,auth,expiration_time,time_zone,locale,enabled").eq("account_id", account.id).eq("enabled", true);
      if (subscriptionError) throw subscriptionError;
      const outcome = status === "success" ? "has passed" : status === "failure" ? "has failed" : status === "cancelled" ? "was cancelled" : status === "skipped" ? "was skipped" : status === "queued" ? "is queued" : "is in progress";
      const title = String(verifiedRun.head_commit?.message || verifiedRun.display_title || "Watch Logger Change").split("\n")[0].trim().slice(0, 120) || "Watch Logger Change";
      const detail = status === "failure" ? ` ${failureSummary || "Review the failed workflow check logs and rerun after fixing the issue."}` : "";
      const bodyText = `Run #${runNumber}, attempt ${runAttempt} (${sha.slice(0, 7)}) ${outcome}.${detail}`.slice(0, 900);
      let delivered = 0, failed = 0;
      for (const row of (subscriptions || []) as PushRow[]) {
        const eventKey = `workflow-status:${runId}:${runAttempt}:${sha}:${status}`;
        const delivery = await claimDelivery(row, account.id, `workflow-run-${runId}`, eventKey, new Date().toISOString());
        if (!delivery) continue;
        try {
          await sendPush(row, config, { title, body: bodyText, tag: `watchlog-change-${runId}-${runAttempt}`, data: { url: "./", workflowRunNumber: runNumber, runAttempt, failureSummary, sha, status, commitUrl } });
          await finishDelivery(delivery, row);
          delivered++;
        } catch (pushError) {
          await finishDelivery(delivery, row, pushError);
          failed++;
          console.error("Owner push-status delivery failed", statusCodeFor(pushError) || String((pushError as Error)?.message || pushError).slice(0, 200));
        }
      }
      const duplicate = (subscriptions || []).length > 0 && delivered === 0 && failed === 0;
      return json({ ok: true, delivered, failed, status, duplicate });
    }

    if (action === "process") return await processCron(req);

    const session = await getSession(req);
    if (!session) {
      return json(
        { error: "Session expired. Sign in again.", code: "session_expired" },
        401,
      );
    }

    if (action === "subscribe") {
      const input = (body.subscription || {}) as Record<string, unknown>;
      const keys = (input.keys || {}) as Record<string, unknown>;
      const endpoint = validPushEndpoint(input.endpoint);
      const p256dh = String(keys.p256dh || "");
      const auth = String(keys.auth || "");
      if (
        !endpoint ||
        !p256dh ||
        !auth ||
        p256dh.length > 512 ||
        auth.length > 256
      ) {
        return json({ error: "Invalid push subscription." }, 400);
      }

      const { data, error } = await db
        .from("watchlog_push_subscriptions")
        .upsert(
          {
            account_id: session.accountId,
            endpoint,
            p256dh,
            auth,
            expiration_time:
              input.expirationTime === null ||
              input.expirationTime === undefined
                ? null
                : Number(input.expirationTime),
            time_zone: validTimeZone(body.timeZone),
            locale: String(body.locale || "en").slice(0, 40),
            enabled: true,
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "endpoint" },
        )
        .select("id")
        .single();
      if (error) throw error;
      return json({ ok: true, subscriptionId: data.id });
    }

    if (action === "unsubscribe") {
      const endpoint = String(body.endpoint || "");
      if (endpoint) {
        const { error } = await db
          .from("watchlog_push_subscriptions")
          .delete()
          .eq("account_id", session.accountId)
          .eq("endpoint", endpoint);
        if (error) throw error;
      }
      return json({ ok: true });
    }

    if (action === "status") {
      const endpoint = String(body.endpoint || "");
      const { data, error } = endpoint
        ? await db
            .from("watchlog_push_subscriptions")
            .select("enabled")
            .eq("account_id", session.accountId)
            .eq("endpoint", endpoint)
            .maybeSingle()
        : { data: null, error: null };
      if (error) throw error;
      return json({ ok: true, enabled: Boolean(data?.enabled) });
    }

    if (action === "private_history") {
      // Authorize the session's account before reading any activity. Never
      // accept an account ID from the request body or expose push credentials.
      const [deliveries, library, subscriptions] = await Promise.all([
        db.from("watchlog_push_deliveries").select("item_id,event_key,scheduled_for,status,attempts,next_attempt_at,sent_at,last_error,updated_at").eq("account_id", session.accountId).order("updated_at", { ascending: false }).limit(50),
        privateLibrary(session.accountId),
        db.from("watchlog_push_subscriptions").select("time_zone,locale").eq("account_id", session.accountId).eq("enabled", true),
      ]);
      for (const result of [deliveries, library, subscriptions]) if (result.error) throw result.error;
      const items = (Array.isArray(library.data?.items) ? library.data.items : []) as Record<string, unknown>[];
      const titles = new Map(items.map(item => [String(item.id), String(item.title || "Tracked title")]));
      const history = [
        ...(deliveries.data || []).filter(row => !String(row.event_key).startsWith("workflow-status:")).map(row => ({ ...row, title: titles.get(String(row.item_id)) || "Removed title", label: String(row.event_key).match(/episode:s\d+e\d+/)?.[0].replace("episode:", "") || "Release reminder", event_key: undefined })),
      ].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 50);
      const now = Date.now(), upcoming = [], seen = new Set<string>();
      for (const subscription of subscriptions.data || []) for (const original of items) {
        let country="";try{country=new Intl.Locale(subscription.locale).region||"";}catch(_){}
        const viewer={country,timeZone:subscription.time_zone,locale:subscription.locale};
        const item=globalThis.WatchLogRegionalReleases?.resolve(original,viewer)||original;
        for (const originalEvent of reminderEvents(item)) {
        const event=globalThis.WatchLogRegionalReleases?.resolveEvent(item,originalEvent,viewer)||originalEvent;
        if(event.streamingUnconfirmed||(globalThis.WatchLogRegionalReleases&&!item.releaseSchedule&&!event.releaseSchedule))continue;
        if (event.kind !== "episode" && !["Planned", "Saved"].includes(String(item.status))) continue;
        const release = scheduledEventTime(event.raw, subscription.time_zone);
        for (const lead of [24, 6, 0]) {
          const due = release - lead * 3600000;
          if(/^\d{4}-\d{2}-\d{2}$/.test(event.raw))continue;
          if (!Number.isFinite(due) || due <= now || due >= now + 7 * 86400000) continue;
          const key = `${item.id}:${event.kind}:${event.raw}:${event.number}:${due}`;
          if (seen.has(key)) continue; seen.add(key);
          upcoming.push({title: String(item.title || "Tracked title"), scheduled_for: new Date(due).toISOString(), label: `${event.kind === "episode" ? "Episode " + event.number : event.kind === "season" ? "Season " + event.number : "Film"} · ${lead ? lead + " hours before" : "At release"}`});
        }
      }
      }
      upcoming.sort((a,b) => Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for));
      const suppressed = items.filter(item => item.hideFromWeeklyReleases === true).map(item => ({title:String(item.title||"Tracked title"),status:"suppressed",label:"Weekly Releases exclusion"}));
      return json({ok: true, history, upcoming: upcoming.slice(0, 100), suppressed, enabledDevices: subscriptions.data?.length || 0});
    }

    if (action === "test_reminder") {
      const endpoint = String(body.endpoint || "");
      const requestId = String(body.requestId || "");
      if (!/^https:\/\//.test(endpoint) || !/^[a-f0-9-]{36}$/i.test(requestId)) return json({ error: "Invalid reminder test request." }, 400);
      const { data: row, error } = await db.from("watchlog_push_subscriptions").select("id,account_id,endpoint,p256dh,auth,expiration_time,time_zone,locale,enabled").eq("account_id", session.accountId).eq("endpoint", endpoint).eq("enabled", true).maybeSingle();
      if (error) throw error;
      if (!row) return json({ error: "Enable reminders on this device before sending a test." }, 409);
      const config = await readConfig(false);
      const eventKey = `test-reminder:${requestId}`;
      const delivery = await claimDelivery(row as PushRow, session.accountId, "test-reminder", eventKey, new Date().toISOString());
      if (!delivery) return json({ ok: true, duplicate: true, status: "already_sent" });
      try {
        await sendPush(row as PushRow, config, { title: "Test reminder", body: "Notifications are connected.", tag: `watchlog-test-${requestId}`, data: { url: "./", test: true } });
        await finishDelivery(delivery, row as PushRow);
        return json({ ok: true, status: "sent" });
      } catch (error) {
        await finishDelivery(delivery, row as PushRow, error);
        const code = statusCodeFor(error);
        return code === 404 || code === 410
          ? json({ error: "This device's notification connection expired. Reconnect reminders.", code: "push_subscription_expired" }, 410)
          : json({ error: "The push service could not accept the test. Try again shortly.", code: "push_delivery_failed" }, 502);
      }
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: "WatchLog reminder service error." }, 500);
  }
});
