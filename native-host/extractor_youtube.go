package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// extractor_youtube.go implements youtube-dl's method for downloading YouTube
// videos that are served as separate video-only + audio-only adaptive streams.
//
// YouTube does not expose a plain .mpd/.m3u8 in the page. Streams live in
// ytInitialPlayerResponse.streamingData.adaptiveFormats, each a single
// googlevideo URL whose `s` (signature) and `n` (throttle) query params must be
// deciphered via base.js (see youtube_player_decipher.go). youtube-dl then downloads
// each stream in fixed-size byte ranges (`&range=start-end`, 10 MiB chunks) —
// these are the "fragments" — and muxes the two tracks with ffmpeg. TuyulDM's
// existing segment download + mux pipeline handles everything once we hand it a
// VideoManifest with video/audio Segments.

const youtubeChunkSize = 10 << 20 // 10 MiB, matches youtube-dl CHUNK_SIZE

// FORMAT_STREAM_TYPE_OTF streams require init-fragment/emsg parsing; youtube-dl
// skips them and so do we.
const youtubeOTFType = "FORMAT_STREAM_TYPE_OTF"

var (
	youtubeHostRe     = regexp.MustCompile(`(?i)(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$`)
	ytInitialPlayerRe = regexp.MustCompile(`ytInitialPlayerResponse\s*=\s*`)
	ytJSURLRe         = regexp.MustCompile(`"(?:PLAYER_JS_URL|jsUrl)"\s*:\s*"([^"]+)"`)
	ytCodecsRe        = regexp.MustCompile(`codecs="([^"]+)"`)
	ytTitleIllegalRe  = regexp.MustCompile(`[\\/:*?"<>|\x00-\x1f]+`)
)

func isYouTubeURL(rawURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}
	return youtubeHostRe.MatchString(strings.ToLower(parsed.Host))
}

// extractYouTubeVideoID pulls the 11-char video id from the common URL shapes:
// watch?v=ID, youtu.be/ID, /shorts/ID, /embed/ID, /v/ID.
func extractYouTubeVideoID(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return ""
	}
	if v := parsed.Query().Get("v"); isYouTubeID(v) {
		return v
	}
	host := strings.ToLower(parsed.Host)
	segments := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if strings.Contains(host, "youtu.be") && len(segments) >= 1 && isYouTubeID(segments[0]) {
		return segments[0]
	}
	for i, seg := range segments {
		switch seg {
		case "shorts", "embed", "v", "live":
			if i+1 < len(segments) && isYouTubeID(segments[i+1]) {
				return segments[i+1]
			}
		}
	}
	return ""
}

var youtubeIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

func isYouTubeID(s string) bool { return youtubeIDRe.MatchString(s) }

// resolveYouTubeManifest is the entry point used by resolveVideoManifest when
// the request URL is a YouTube page.
func resolveYouTubeManifest(ctx context.Context, req VideoDownloadRequest) (*VideoManifest, error) {
	videoID := extractYouTubeVideoID(req.URL)
	if videoID == "" {
		return nil, fmt.Errorf("youtube: could not determine video id from %q", req.URL)
	}

	// Resolve stream data. Modern YouTube strips stream URLs from the web client
	// (SABR), so — like yt-dlp — we ask the mobile InnerTube clients, which still
	// return direct googlevideo URLs (no signature/n deciphering needed). Only if
	// those fail do we fall back to the web client + base.js cipher path.
	pr, player, usedClient, err := resolveYouTubePlayerResponse(ctx, videoID, req)
	if err != nil {
		return nil, err
	}
	if err := ytCheckPlayable(pr); err != nil {
		return nil, err
	}

	videos, audios := classifyYouTubeFormats(pr.StreamingData.AdaptiveFormats)
	if len(videos) == 0 {
		return nil, fmt.Errorf("youtube: no downloadable video formats (video may be live or DRM-protected)")
	}

	selectedVideo := pickYouTubeVideo(videos, req.SelectedVariantID)
	if req.SelectedVariantID != "" && strconv.Itoa(selectedVideo.Itag) != req.SelectedVariantID {
		return nil, fmt.Errorf("youtube: requested variant %q not found", req.SelectedVariantID)
	}

	manifest := &VideoManifest{
		ManifestType: manifestTypeYouTube,
		// The download pipeline always muxes to an .mp4 output file (ensureVideoFilename
		// + muxVideoSegments), so the container is genuinely mp4 even for vp9/av1 video
		// tracks; labeling it "webm" would only contradict the real file and can trip
		// the offer-refresh container-parity check (offer_refresh.go).
		Container:         "mp4",
		Title:             ytSanitizeTitle(pr.VideoDetails.Title),
		SelectedVariantID: strconv.Itoa(selectedVideo.Itag),
	}
	for _, v := range videos {
		manifest.Variants = append(manifest.Variants, youtubeVariant(v))
	}

	videoURL, err := resolveYouTubeFormatURL(selectedVideo, player)
	if err != nil {
		return nil, err
	}
	if err := appendYouTubeFragments(manifest, videoURL, selectedVideo, "video"); err != nil {
		return nil, err
	}
	// contentLength is known per format, so record the exact total up front rather
	// than leaving it unknown (the &range= fragments carry End=-1, which would
	// otherwise force TotalSize to 0 and stall the progress bar).
	manifest.TotalBytes = selectedVideo.contentLengthBytes()

	if len(audios) > 0 {
		selectedAudio := pickYouTubeAudio(audios, selectedVideo)
		audioURL, err := resolveYouTubeFormatURL(selectedAudio, player)
		if err != nil {
			return nil, err
		}
		if err := appendYouTubeFragments(manifest, audioURL, selectedAudio, "audio"); err != nil {
			return nil, err
		}
		manifest.TotalBytes += selectedAudio.contentLengthBytes()
	}

	if len(manifest.Segments) == 0 {
		return nil, fmt.Errorf("youtube: resolved no segments")
	}
	slog.Info("youtube_manifest_resolved",
		"event", "youtube_manifest_resolved",
		"video_id", videoID,
		"client", usedClient,
		"video_itag", selectedVideo.Itag,
		"segments", len(manifest.Segments),
	)
	return manifest, nil
}

// youtubeClient describes an InnerTube client context. The mobile clients return
// direct stream URLs; the web client returns signature ciphers needing base.js.
type youtubeClient struct {
	Label       string
	Name        string
	Version     string
	NameID      string // X-YouTube-Client-Name header value
	UserAgent   string
	Extra       map[string]any
	NeedsBaseJS bool
}

// youtubeClients is tried in order; the first one that returns an OK playability
// status with usable formats wins.
var youtubeClients = []youtubeClient{
	{
		Label:     "android",
		Name:      "ANDROID",
		Version:   "20.10.38",
		NameID:    "3",
		UserAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
		Extra:     map[string]any{"androidSdkVersion": 34, "osName": "Android", "osVersion": "14"},
	},
	{
		Label:     "ios",
		Name:      "IOS",
		Version:   "20.10.4",
		NameID:    "5",
		UserAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
		Extra:     map[string]any{"deviceMake": "Apple", "deviceModel": "iPhone16,2", "osName": "iPhoneOS", "osVersion": "18.3.2.22D82"},
	},
}

// resolveYouTubePlayerResponse returns a player response with playable formats,
// the (possibly nil) base.js player needed for cipher/n deciphering, and the
// client label that succeeded.
func resolveYouTubePlayerResponse(ctx context.Context, videoID string, req VideoDownloadRequest) (*ytPlayerResponse, *ytPlayer, string, error) {
	var lastReason string
	for _, client := range youtubeClients {
		pr, err := ytCallPlayerAPI(ctx, videoID, client, "", req.Headers, req.Cookies)
		if err != nil {
			lastReason = err.Error()
			slog.Warn("youtube_client_failed", "event", "youtube_client_failed", "client", client.Label, "error", err.Error())
			continue
		}
		status := strings.ToUpper(pr.PlayabilityStatus.Status)
		if status != "" && status != "OK" {
			lastReason = fmt.Sprintf("%s: %s", client.Label, firstNonEmpty(pr.PlayabilityStatus.Reason, status))
			continue
		}
		if hasPlayableFormats(pr.StreamingData.AdaptiveFormats) {
			// Mobile clients hand back direct URLs, but those URLs still carry an
			// `n` throttle param that applies to every client. Best-effort fetch
			// base.js so the URLs can be de-throttled; nil player just means the
			// (throttled) original URL is used.
			return pr, ytBestEffortPlayer(ctx, videoID, req), client.Label, nil
		}
		lastReason = client.Label + ": no playable formats"
	}

	// Fall back to the web client + base.js cipher path (youtube-dl's classic
	// method) when the mobile clients are blocked for this video.
	pr, player, err := resolveYouTubeWebCipher(ctx, videoID, req)
	if err != nil {
		if lastReason != "" {
			return nil, nil, "", fmt.Errorf("youtube: no playable formats (%s); web fallback: %w", lastReason, err)
		}
		return nil, nil, "", err
	}
	return pr, player, "web", nil
}

// resolveYouTubeWebCipher fetches the watch page + base.js and returns a player
// response whose signature-cipher formats can be deciphered via `player`.
func resolveYouTubeWebCipher(ctx context.Context, videoID string, req VideoDownloadRequest) (*ytPlayerResponse, *ytPlayer, error) {
	watchURL := fmt.Sprintf("https://www.youtube.com/watch?v=%s&bpctr=9999999999&has_verified=1&hl=en", videoID)
	html, err := ytFetchText(ctx, watchURL, req.Headers, ytConsentCookies(req.Cookies))
	if err != nil {
		return nil, nil, fmt.Errorf("fetch watch page: %w", err)
	}
	playerURL := ytAbsoluteURL(ytDecodeJSString(extractFirstGroup(ytJSURLRe, html)))
	if playerURL == "" {
		return nil, nil, fmt.Errorf("could not locate base.js player url")
	}
	baseJS, err := ytFetchText(ctx, playerURL, req.Headers, req.Cookies)
	if err != nil {
		return nil, nil, fmt.Errorf("fetch base.js: %w", err)
	}
	player := getYouTubePlayer(baseJS, playerURL)

	pr, err := extractPlayerResponse(html)
	if err != nil {
		return nil, nil, err
	}
	if !hasPlayableFormats(pr.StreamingData.AdaptiveFormats) {
		webClient := youtubeClient{Label: "web", Name: "WEB", Version: "2.20240401.00.00", NameID: "1", NeedsBaseJS: true}
		apiPR, apiErr := ytCallPlayerAPI(ctx, videoID, webClient, player.sts, req.Headers, req.Cookies)
		if apiErr != nil {
			return nil, nil, fmt.Errorf("web player api: %w", apiErr)
		}
		if hasPlayableFormats(apiPR.StreamingData.AdaptiveFormats) {
			pr = apiPR
		}
	}
	if !hasPlayableFormats(pr.StreamingData.AdaptiveFormats) {
		return nil, nil, fmt.Errorf("web client returned no playable formats")
	}
	return pr, player, nil
}

// resolveYouTubeFormatURL returns the final playable URL for a format. Direct
// URLs (mobile clients) are used as-is, with best-effort `n` de-throttling when
// a base.js player is available. Cipher-only formats (web client) require the
// player to decipher the signature.
func resolveYouTubeFormatURL(f ytFormat, player *ytPlayer) (string, error) {
	if f.URL != "" {
		if player != nil {
			return player.applyNParam(f.URL), nil
		}
		return f.URL, nil
	}
	if player == nil {
		return "", fmt.Errorf("youtube: format %d has no direct url and no player for cipher", f.Itag)
	}
	return player.decipherCipherURL(f)
}

// ytFormat is a single entry from streamingData.{formats,adaptiveFormats}.
type ytFormat struct {
	Itag            int    `json:"itag"`
	URL             string `json:"url"`
	MimeType        string `json:"mimeType"`
	Bitrate         int64  `json:"bitrate"`
	AverageBitrate  int64  `json:"averageBitrate"`
	Width           int    `json:"width"`
	Height          int    `json:"height"`
	Fps             int    `json:"fps"`
	ContentLength   string `json:"contentLength"`
	Quality         string `json:"quality"`
	QualityLabel    string `json:"qualityLabel"`
	AudioQuality    string `json:"audioQuality"`
	AudioSampleRate string `json:"audioSampleRate"`
	SignatureCipher string `json:"signatureCipher"`
	Cipher          string `json:"cipher"`
	Type            string `json:"type"`
}

func (f ytFormat) contentLengthBytes() int64 {
	n, _ := strconv.ParseInt(strings.TrimSpace(f.ContentLength), 10, 64)
	return n
}

func (f ytFormat) codecs() string {
	if m := ytCodecsRe.FindStringSubmatch(f.MimeType); m != nil {
		return m[1]
	}
	return ""
}

type ytStreamingData struct {
	Formats         []ytFormat `json:"formats"`
	AdaptiveFormats []ytFormat `json:"adaptiveFormats"`
	DashManifestURL string     `json:"dashManifestUrl"`
	HlsManifestURL  string     `json:"hlsManifestUrl"`
}

type ytPlayerResponse struct {
	StreamingData     ytStreamingData `json:"streamingData"`
	PlayabilityStatus struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	} `json:"playabilityStatus"`
	VideoDetails struct {
		Title   string `json:"title"`
		VideoID string `json:"videoId"`
		IsLive  bool   `json:"isLiveContent"`
	} `json:"videoDetails"`
}

func ytCheckPlayable(pr *ytPlayerResponse) error {
	status := strings.ToUpper(pr.PlayabilityStatus.Status)
	if status != "" && status != "OK" {
		reason := strings.TrimSpace(pr.PlayabilityStatus.Reason)
		if reason == "" {
			reason = status
		}
		return fmt.Errorf("youtube: video not playable: %s", reason)
	}
	if pr.VideoDetails.IsLive {
		return fmt.Errorf("youtube: live streams are not supported")
	}
	return nil
}

// extractPlayerResponse pulls and parses the ytInitialPlayerResponse JSON object
// from the watch-page HTML using brace matching (the trailing `};` inside the
// object makes a plain regex unreliable).
func extractPlayerResponse(html string) (*ytPlayerResponse, error) {
	loc := ytInitialPlayerRe.FindStringIndex(html)
	if loc == nil {
		return nil, fmt.Errorf("youtube: ytInitialPlayerResponse not found in page")
	}
	start := loc[1]
	for start < len(html) && html[start] != '{' {
		start++
	}
	end := matchBrace(html, start)
	if end <= start {
		return nil, fmt.Errorf("youtube: malformed ytInitialPlayerResponse")
	}
	var pr ytPlayerResponse
	if err := json.Unmarshal([]byte(html[start:end+1]), &pr); err != nil {
		return nil, fmt.Errorf("youtube: parse player response: %w", err)
	}
	return &pr, nil
}

// decipherCipherURL builds a playable URL from a signature-cipher format
// (web client), deciphering the signature via base.js and then the `n` param.
func (p *ytPlayer) decipherCipherURL(f ytFormat) (string, error) {
	cipher := firstNonEmpty(f.SignatureCipher, f.Cipher)
	if cipher == "" {
		return "", fmt.Errorf("youtube: format %d has neither url nor cipher", f.Itag)
	}
	values, err := url.ParseQuery(cipher)
	if err != nil {
		return "", fmt.Errorf("youtube: parse cipher: %w", err)
	}
	base := values.Get("url")
	encrypted := values.Get("s")
	if base == "" || encrypted == "" {
		return "", fmt.Errorf("youtube: incomplete cipher for format %d", f.Itag)
	}
	sig, err := p.DecipherSignature(encrypted)
	if err != nil {
		return "", err
	}
	sp := values.Get("sp")
	if sp == "" {
		sp = "signature"
	}
	return p.applyNParam(ytSetQueryParam(base, sp, sig)), nil
}

// applyNParam deciphers the `n` query parameter to avoid throttling. Failure is
// non-fatal: youtube-dl warns and downloads (throttled) with the original URL.
func (p *ytPlayer) applyNParam(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	q := parsed.Query()
	n := q.Get("n")
	if n == "" {
		return rawURL
	}
	decoded, err := p.DecipherN(n)
	if err != nil {
		slog.Warn("youtube_n_decipher_failed",
			"event", "youtube_n_decipher_failed",
			"error", err.Error(),
		)
		return rawURL
	}
	q.Set("n", decoded)
	parsed.RawQuery = q.Encode()
	return parsed.String()
}

// appendYouTubeFragments chunks a stream URL into 10 MiB `&range=` fragments and
// appends them to the manifest as Segments of the given track. This is
// youtube-dl's build_fragments, expressed as TuyulDM Segments.
func appendYouTubeFragments(manifest *VideoManifest, streamURL string, f ytFormat, track string) error {
	clen := f.contentLengthBytes()
	if clen <= 0 {
		return fmt.Errorf("youtube: format %d missing contentLength", f.Itag)
	}
	for start := int64(0); start < clen; start += youtubeChunkSize {
		end := start + youtubeChunkSize - 1
		if end >= clen {
			end = clen - 1
		}
		manifest.Segments = append(manifest.Segments, Segment{
			Index: len(manifest.Segments),
			// Fragment is delivered whole via the `&range=` query param, so the
			// downloader issues a plain GET (Start/End left unset).
			Start: 0,
			End:   -1,
			URL:   ytSetRangeParam(streamURL, start, end),
			Track: track,
		})
	}
	return nil
}

// hasPlayableFormats reports whether at least one adaptive format carries a
// usable stream reference (direct url or a signature cipher).
func hasPlayableFormats(formats []ytFormat) bool {
	for _, f := range formats {
		if f.URL != "" || firstNonEmpty(f.SignatureCipher, f.Cipher) != "" {
			return true
		}
	}
	return false
}

func classifyYouTubeFormats(formats []ytFormat) (videos []ytFormat, audios []ytFormat) {
	for _, f := range formats {
		if f.Type == youtubeOTFType {
			continue // OTF requires init-fragment parsing; unsupported (as in youtube-dl)
		}
		if f.contentLengthBytes() <= 0 {
			continue
		}
		mime := strings.ToLower(f.MimeType)
		switch {
		case strings.HasPrefix(mime, "video/"):
			videos = append(videos, f)
		case strings.HasPrefix(mime, "audio/"):
			audios = append(audios, f)
		}
	}
	return videos, audios
}

// pickYouTubeVideo selects the requested itag, or the best video otherwise:
// highest resolution, then bitrate, preferring mp4 (avc1) for clean muxing.
func pickYouTubeVideo(videos []ytFormat, wantItag string) ytFormat {
	if wantItag != "" {
		for _, v := range videos {
			if strconv.Itoa(v.Itag) == wantItag {
				return v
			}
		}
	}
	sorted := append([]ytFormat(nil), videos...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return youtubeVideoScore(sorted[i]) > youtubeVideoScore(sorted[j])
	})
	return sorted[0]
}

// pickYouTubeAudio selects the best audio, preferring a container that muxes
// cleanly with the chosen video (mp4/m4a with avc1 video).
func pickYouTubeAudio(audios []ytFormat, video ytFormat) ytFormat {
	preferMP4 := strings.Contains(strings.ToLower(video.MimeType), "mp4")
	sorted := append([]ytFormat(nil), audios...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return youtubeAudioScore(sorted[i], preferMP4) > youtubeAudioScore(sorted[j], preferMP4)
	})
	return sorted[0]
}

func youtubeVideoScore(f ytFormat) int64 {
	score := int64(f.Height)*1_000_000 + f.bitrate()
	if strings.Contains(strings.ToLower(f.MimeType), "mp4") {
		score += 500_000 // tie-break toward mp4/avc1
	}
	return score
}

func youtubeAudioScore(f ytFormat, preferMP4 bool) int64 {
	score := f.bitrate()
	if preferMP4 && strings.Contains(strings.ToLower(f.MimeType), "mp4") {
		score += 1_000_000
	}
	return score
}

func (f ytFormat) bitrate() int64 {
	if f.AverageBitrate > 0 {
		return f.AverageBitrate
	}
	return f.Bitrate
}

func youtubeVariant(f ytFormat) VideoVariant {
	resolution := ""
	if f.Width > 0 && f.Height > 0 {
		resolution = fmt.Sprintf("%dx%d", f.Width, f.Height)
	}
	name := f.QualityLabel
	if name == "" {
		name = strconv.Itoa(f.Itag)
	}
	return VideoVariant{
		ID:         strconv.Itoa(f.Itag),
		Name:       name,
		Bandwidth:  f.bitrate(),
		Resolution: resolution,
		Codecs:     f.codecs(),
	}
}

// --- HTTP helpers ---

func ytFetchText(ctx context.Context, rawURL string, headers map[string]string, cookies []RequestCookie) (string, error) {
	merged := ytDefaultHeaders(headers)
	resp, _, err := doRequestWithRedirects(ctx, http.MethodGet, rawURL, merged, cookies, nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// ytInnerTubeKey is YouTube's long-standing public InnerTube key.
const ytInnerTubeKey = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"

// ytCallPlayerAPI hits the InnerTube /youtubei/v1/player endpoint using the
// given client context and returns the parsed player response. `sts` is only
// meaningful for the web client (signature timestamp); mobile clients ignore it.
func ytCallPlayerAPI(ctx context.Context, videoID string, client youtubeClient, sts string, headers map[string]string, cookies []RequestCookie) (*ytPlayerResponse, error) {
	clientCtx := map[string]any{
		"clientName":    client.Name,
		"clientVersion": client.Version,
		"hl":            "en",
		"gl":            "US",
	}
	for k, v := range client.Extra {
		clientCtx[k] = v
	}

	body := map[string]any{
		"videoId":        videoID,
		"context":        map[string]any{"client": clientCtx},
		"contentCheckOk": true,
		"racyCheckOk":    true,
	}
	if client.NeedsBaseJS && sts != "" {
		if n, err := strconv.Atoi(sts); err == nil {
			body["playbackContext"] = map[string]any{
				"contentPlaybackContext": map[string]any{
					"signatureTimestamp": n,
					"html5Preference":    "HTML5_PREF_WANTS",
				},
			}
		}
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	apiURL := "https://www.youtube.com/youtubei/v1/player?key=" + url.QueryEscape(ytInnerTubeKey)
	httpClient, err := newHTTPClient(apiURL, cookies, true)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	// Mobile clients expect their own product User-Agent; forwarded headers must
	// not override it, so apply the client UA after user headers.
	reqHeaders := ytDefaultHeaders(headers)
	if client.UserAgent != "" {
		reqHeaders["User-Agent"] = client.UserAgent
	}
	applyRequestHeaders(req, reqHeaders, cookies)
	req.Header.Set("Content-Type", "application/json")
	if client.NameID != "" {
		req.Header.Set("X-Youtube-Client-Name", client.NameID)
		req.Header.Set("X-Youtube-Client-Version", client.Version)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("player api status %d", resp.StatusCode)
	}
	var pr ytPlayerResponse
	if err := json.NewDecoder(resp.Body).Decode(&pr); err != nil {
		return nil, err
	}
	return &pr, nil
}

func ytDefaultHeaders(headers map[string]string) map[string]string {
	merged := map[string]string{
		"User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
		"Accept-Language": "en-US,en;q=0.9",
	}
	for k, v := range headers {
		merged[k] = v
	}
	return merged
}

// ytConsentCookies adds a consent cookie so the EU consent wall does not hide
// the player response.
func ytConsentCookies(cookies []RequestCookie) []RequestCookie {
	for _, c := range cookies {
		if strings.EqualFold(c.Name, "CONSENT") {
			return cookies
		}
	}
	return append(append([]RequestCookie(nil), cookies...), RequestCookie{
		Name:   "CONSENT",
		Value:  "YES+1",
		Domain: ".youtube.com",
		Path:   "/",
	})
}

func ytAbsoluteURL(ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return ""
	}
	if strings.HasPrefix(ref, "//") {
		return "https:" + ref
	}
	if strings.HasPrefix(ref, "/") {
		return "https://www.youtube.com" + ref
	}
	return ref
}

func ytSetQueryParam(rawURL string, key string, value string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	q := parsed.Query()
	q.Set(key, value)
	parsed.RawQuery = q.Encode()
	return parsed.String()
}

func ytSetRangeParam(rawURL string, start int64, end int64) string {
	return ytSetQueryParam(rawURL, "range", fmt.Sprintf("%d-%d", start, end))
}

func extractFirstGroup(re *regexp.Regexp, s string) string {
	if m := re.FindStringSubmatch(s); m != nil {
		return m[1]
	}
	return ""
}

// ytDecodeJSString decodes a value captured from raw page HTML that is really a
// JSON/JS string literal (e.g. jsUrl is emitted slash-escaped as `\/s\/player`).
// It falls back to a plain `\/`→`/` unescape if the value is not clean JSON.
func ytDecodeJSString(s string) string {
	if s == "" {
		return ""
	}
	var decoded string
	if err := json.Unmarshal([]byte(`"`+s+`"`), &decoded); err == nil {
		return decoded
	}
	return strings.ReplaceAll(s, `\/`, "/")
}

// ytSanitizeTitle turns a video title into a filesystem-safe base name.
func ytSanitizeTitle(title string) string {
	cleaned := ytTitleIllegalRe.ReplaceAllString(strings.TrimSpace(title), " ")
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	if r := []rune(cleaned); len(r) > 150 {
		cleaned = strings.TrimSpace(string(r[:150]))
	}
	return cleaned
}

// ytBestEffortPlayer fetches base.js so direct (mobile-client) URLs can have
// their `n` throttle param descrambled. Every failure is non-fatal: callers
// fall back to the original (throttled) URL when this returns nil.
func ytBestEffortPlayer(ctx context.Context, videoID string, req VideoDownloadRequest) *ytPlayer {
	watchURL := fmt.Sprintf("https://www.youtube.com/watch?v=%s&bpctr=9999999999&has_verified=1&hl=en", videoID)
	html, err := ytFetchText(ctx, watchURL, req.Headers, ytConsentCookies(req.Cookies))
	if err != nil {
		return nil
	}
	playerURL := ytAbsoluteURL(ytDecodeJSString(extractFirstGroup(ytJSURLRe, html)))
	if playerURL == "" {
		return nil
	}
	if p := cachedYouTubePlayer(playerURL); p != nil {
		return p
	}
	baseJS, err := ytFetchText(ctx, playerURL, req.Headers, req.Cookies)
	if err != nil {
		return nil
	}
	return getYouTubePlayer(baseJS, playerURL)
}
