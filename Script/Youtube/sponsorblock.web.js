const defaultConfig = {
  server: "https://sponsor.ajay.app",
  categories: ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "music_offtopic", "filler"],
  actionTypes: ["skip"],
  minSegmentDuration: 0,
  debug: false
};

function parseConfig() {
  if (typeof $argument !== "string" || !$argument) return defaultConfig;
  try {
    const input = JSON.parse($argument);
    return Object.assign({}, defaultConfig, input, {
      categories: Array.isArray(input.categories) && input.categories.length ? input.categories : defaultConfig.categories,
      actionTypes: Array.isArray(input.actionTypes) && input.actionTypes.length ? input.actionTypes : defaultConfig.actionTypes
    });
  } catch (error) {
    return defaultConfig;
  }
}

function getHeaderValue(headers, name) {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : "";
}

function deleteHeader(headers, name) {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
  if (key) delete headers[key];
}

function createClientScript(config) {
  const payload = JSON.stringify({
    server: config.server,
    categories: config.categories,
    actionTypes: config.actionTypes,
    minSegmentDuration: Number(config.minSegmentDuration) || 0,
    debug: !!config.debug
  });

  return `(() => {
  const config = ${payload};
  const state = { videoId: "", segments: [], fetching: false, lastSkipAt: 0 };
  const log = (...args) => config.debug && console.log("[Surge SponsorBlock]", ...args);
  const normalizeServer = (server) => String(server || "https://sponsor.ajay.app").replace(/\\/+$/, "");
  const getVideoId = () => {
    const url = new URL(location.href);
    const watchId = url.searchParams.get("v");
    if (watchId) return watchId;
    const shorts = url.pathname.match(/^\\/shorts\\/([^/?#]+)/);
    if (shorts) return shorts[1];
    const embed = url.pathname.match(/^\\/embed\\/([^/?#]+)/);
    if (embed) return embed[1];
    return "";
  };
  const loadSegments = async (videoId) => {
    if (!videoId || state.fetching) return;
    state.fetching = true;
    state.segments = [];
    const categories = encodeURIComponent(JSON.stringify(config.categories));
    const actionTypes = encodeURIComponent(JSON.stringify(config.actionTypes));
    const url = normalizeServer(config.server) + "/api/skipSegments?videoID=" + encodeURIComponent(videoId) + "&categories=" + categories + "&actionTypes=" + actionTypes;
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.status === 404) {
        state.segments = [];
        log("no segments", videoId);
        return;
      }
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      state.segments = Array.isArray(data) ? data.filter((item) => Array.isArray(item.segment) && item.segment.length >= 2 && item.segment[1] - item.segment[0] >= config.minSegmentDuration).sort((a, b) => a.segment[0] - b.segment[0]) : [];
      log("loaded", videoId, state.segments);
    } catch (error) {
      log("load failed", error);
    } finally {
      state.fetching = false;
    }
  };
  const ensureVideo = () => {
    const videoId = getVideoId();
    if (videoId && videoId !== state.videoId) {
      state.videoId = videoId;
      loadSegments(videoId);
    }
  };
  const getVideo = () => document.querySelector("video");
  const applySkip = () => {
    ensureVideo();
    const video = getVideo();
    if (!video || !state.segments.length || video.paused && video.readyState < 2) return;
    const now = video.currentTime;
    const segment = state.segments.find((item) => now >= item.segment[0] && now < item.segment[1] - 0.05);
    if (!segment) return;
    if (Date.now() - state.lastSkipAt < 500) return;
    state.lastSkipAt = Date.now();
    video.currentTime = Math.min(segment.segment[1], Number.isFinite(video.duration) ? video.duration : segment.segment[1]);
    log("skipped", segment.category, segment.segment);
  };
  const hookHistory = () => {
    ["pushState", "replaceState"].forEach((name) => {
      const original = history[name];
      history[name] = function (...args) {
        const result = original.apply(this, args);
        setTimeout(ensureVideo, 0);
        return result;
      };
    });
    window.addEventListener("popstate", () => setTimeout(ensureVideo, 0));
    window.addEventListener("yt-navigate-finish", () => setTimeout(ensureVideo, 0));
  };
  hookHistory();
  ensureVideo();
  setInterval(applySkip, 250);
  document.addEventListener("timeupdate", applySkip, true);
})();`;
}

const headers = Object.assign({}, $response.headers || {});
let body = $response.body || "";
const config = parseConfig();
const contentType = getHeaderValue(headers, "content-type");

if (/text\/html/i.test(contentType) && /<\/body>/i.test(body)) {
  const nonceMatch = body.match(/<script[^>]+nonce=["']([^"']+)["']/i) || body.match(/nonce=["']([^"']+)["']/i);
  const nonce = nonceMatch ? ` nonce="${nonceMatch[1]}"` : "";
  const script = `<script${nonce}>${createClientScript(config).replace(/<\/script/gi, "<\\/script")}</script>`;
  body = body.replace(/<\/body>/i, `${script}</body>`);
  deleteHeader(headers, "content-security-policy");
  deleteHeader(headers, "content-security-policy-report-only");
  deleteHeader(headers, "content-length");
}

$done({ headers, body });
