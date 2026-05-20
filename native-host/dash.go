package main

import (
	"encoding/xml"
	"fmt"
	"strings"
	"time"
)

type dashManifestDocument struct {
	XMLName                   xml.Name                `xml:"MPD"`
	Type                      string                  `xml:"type,attr"`
	MediaPresentationDuration string                  `xml:"mediaPresentationDuration,attr"`
	BaseURL                   string                  `xml:"BaseURL"`
	ContentProtection         []dashContentProtection `xml:"ContentProtection"`
	Periods                   []dashPeriod            `xml:"Period"`
}

type dashPeriod struct {
	ID                string                  `xml:"id,attr"`
	Duration          string                  `xml:"duration,attr"`
	BaseURL           string                  `xml:"BaseURL"`
	SegmentTemplate   *dashSegmentTemplate    `xml:"SegmentTemplate"`
	SegmentList       *dashSegmentList        `xml:"SegmentList"`
	ContentProtection []dashContentProtection `xml:"ContentProtection"`
	AdaptationSets    []dashAdaptationSet     `xml:"AdaptationSet"`
}

type dashAdaptationSet struct {
	ID                string                  `xml:"id,attr"`
	ContentType       string                  `xml:"contentType,attr"`
	MimeType          string                  `xml:"mimeType,attr"`
	Codecs            string                  `xml:"codecs,attr"`
	Lang              string                  `xml:"lang,attr"`
	BaseURL           string                  `xml:"BaseURL"`
	SegmentTemplate   *dashSegmentTemplate    `xml:"SegmentTemplate"`
	SegmentList       *dashSegmentList        `xml:"SegmentList"`
	ContentProtection []dashContentProtection `xml:"ContentProtection"`
	Representations   []dashRepresentation    `xml:"Representation"`
}

type dashRepresentation struct {
	ID                string                  `xml:"id,attr"`
	Bandwidth         int64                   `xml:"bandwidth,attr"`
	Width             int64                   `xml:"width,attr"`
	Height            int64                   `xml:"height,attr"`
	MimeType          string                  `xml:"mimeType,attr"`
	Codecs            string                  `xml:"codecs,attr"`
	BaseURL           string                  `xml:"BaseURL"`
	SegmentTemplate   *dashSegmentTemplate    `xml:"SegmentTemplate"`
	SegmentList       *dashSegmentList        `xml:"SegmentList"`
	ContentProtection []dashContentProtection `xml:"ContentProtection"`
}

type dashSegmentTemplate struct {
	Media          string               `xml:"media,attr"`
	Initialization string               `xml:"initialization,attr"`
	StartNumber    int64                `xml:"startNumber,attr"`
	Duration       int64                `xml:"duration,attr"`
	Timescale      int64                `xml:"timescale,attr"`
	Timeline       *dashSegmentTimeline `xml:"SegmentTimeline"`
}

type dashSegmentTimeline struct {
	Segments []dashTimelineSegment `xml:"S"`
}

type dashTimelineSegment struct {
	StartTime   *int64 `xml:"t,attr"`
	Duration    int64  `xml:"d,attr"`
	RepeatCount *int   `xml:"r,attr"`
}

type dashSegmentList struct {
	Duration       int64            `xml:"duration,attr"`
	Timescale      int64            `xml:"timescale,attr"`
	Initialization *dashURLRef      `xml:"Initialization"`
	SegmentURLs    []dashSegmentURL `xml:"SegmentURL"`
}

type dashSegmentURL struct {
	Media      string `xml:"media,attr"`
	MediaRange string `xml:"mediaRange,attr"`
}

type dashURLRef struct {
	SourceURL string `xml:"sourceURL,attr"`
	Range     string `xml:"range,attr"`
}

type dashContentProtection struct {
	SchemeIDURI string `xml:"schemeIdUri,attr"`
	Value       string `xml:"value,attr"`
}

type dashRepresentationRef struct {
	period       *dashPeriod
	adaptation   *dashAdaptationSet
	representation *dashRepresentation
	kind         string
	variant      VideoVariant
}

func parseDASHManifest(manifestURL string, rawManifest string, req VideoDownloadRequest) (*VideoManifest, error) {
	var document dashManifestDocument
	if err := xml.Unmarshal([]byte(rawManifest), &document); err != nil {
		return nil, err
	}

	if strings.EqualFold(document.Type, "dynamic") {
		return nil, fmt.Errorf("live dash manifests are not supported yet")
	}
	if hasProtectedDASHContent(document) {
		return nil, fmt.Errorf("refusing drm-protected dash stream")
	}
	if len(document.Periods) == 0 {
		return nil, fmt.Errorf("dash manifest had no periods")
	}

	period := &document.Periods[0]
	videoRefs := collectDashRepresentationRefs(&document, period, manifestURL, "video")
	if len(videoRefs) == 0 {
		return nil, fmt.Errorf("dash manifest had no video representations")
	}
	audioRefs := collectDashRepresentationRefs(&document, period, manifestURL, "audio")

	manifest := &VideoManifest{
		ManifestType: manifestTypeDASH,
		Container:    "mp4",
	}

	selectedVideo := videoRefs[0]
	for _, ref := range videoRefs {
		manifest.Variants = append(manifest.Variants, ref.variant)
		if req.SelectedVariantID != "" && ref.variant.ID == req.SelectedVariantID {
			selectedVideo = ref
		}
		if req.SelectedVariantID == "" && ref.variant.Bandwidth > selectedVideo.variant.Bandwidth {
			selectedVideo = ref
		}
	}

	if req.SelectedVariantID != "" && selectedVideo.variant.ID != req.SelectedVariantID {
		return nil, fmt.Errorf("requested dash variant %q not found", req.SelectedVariantID)
	}
	manifest.SelectedVariantID = selectedVideo.variant.ID

	videoSegments, err := buildDASHRepresentationSegments(&document, selectedVideo, manifestURL)
	if err != nil {
		return nil, err
	}
	manifest.Segments = append(manifest.Segments, videoSegments...)

	if len(audioRefs) > 0 {
		selectedAudio := audioRefs[0]
		for _, ref := range audioRefs[1:] {
			if ref.variant.Bandwidth > selectedAudio.variant.Bandwidth {
				selectedAudio = ref
			}
		}

		audioSegments, err := buildDASHRepresentationSegments(&document, selectedAudio, manifestURL)
		if err != nil {
			return nil, err
		}
		for _, segment := range audioSegments {
			segment.Index = len(manifest.Segments)
			manifest.Segments = append(manifest.Segments, segment)
		}
	}

	if len(manifest.Segments) == 0 {
		return nil, fmt.Errorf("dash manifest resolved no segments")
	}

	return manifest, nil
}

func collectDashRepresentationRefs(document *dashManifestDocument, period *dashPeriod, manifestURL string, desiredKind string) []dashRepresentationRef {
	refs := make([]dashRepresentationRef, 0)
	for adaptationIndex := range period.AdaptationSets {
		adaptation := &period.AdaptationSets[adaptationIndex]
		for representationIndex := range adaptation.Representations {
			representation := &adaptation.Representations[representationIndex]
			kind := dashRepresentationKind(adaptation, representation)
			if kind != desiredKind {
				continue
			}

			variantID := representation.ID
			if strings.TrimSpace(variantID) == "" {
				variantID = fmt.Sprintf("dash-%s-%d-%d", kind, adaptationIndex, representationIndex)
			}

			resolution := ""
			if representation.Width > 0 && representation.Height > 0 {
				resolution = fmt.Sprintf("%dx%d", representation.Width, representation.Height)
			}

			refs = append(refs, dashRepresentationRef{
				period:         period,
				adaptation:     adaptation,
				representation: representation,
				kind:           kind,
				variant: VideoVariant{
					ID:         variantID,
					Name:       variantID,
					Bandwidth:  representation.Bandwidth,
					Resolution: resolution,
					Codecs:     firstNonEmpty(representation.Codecs, adaptation.Codecs),
					URL:        resolveNestedVideoURL(manifestURL, document.BaseURL, period.BaseURL, adaptation.BaseURL, representation.BaseURL),
				},
			})
		}
	}
	return refs
}

func dashRepresentationKind(adaptation *dashAdaptationSet, representation *dashRepresentation) string {
	values := []string{
		strings.ToLower(strings.TrimSpace(representation.MimeType)),
		strings.ToLower(strings.TrimSpace(adaptation.MimeType)),
		strings.ToLower(strings.TrimSpace(adaptation.ContentType)),
	}

	for _, value := range values {
		switch {
		case strings.HasPrefix(value, "video/") || value == "video":
			return "video"
		case strings.HasPrefix(value, "audio/") || value == "audio":
			return "audio"
		}
	}

	codecs := strings.ToLower(firstNonEmpty(representation.Codecs, adaptation.Codecs))
	if strings.Contains(codecs, "mp4a") || strings.Contains(codecs, "opus") {
		return "audio"
	}
	if codecs != "" {
		return "video"
	}

	return ""
}

func buildDASHRepresentationSegments(document *dashManifestDocument, ref dashRepresentationRef, manifestURL string) ([]Segment, error) {
	baseURL := resolveNestedVideoURL(manifestURL, document.BaseURL, ref.period.BaseURL, ref.adaptation.BaseURL, ref.representation.BaseURL)
	segmentTemplate := firstDashSegmentTemplate(ref.representation.SegmentTemplate, ref.adaptation.SegmentTemplate, ref.period.SegmentTemplate)
	segmentList := firstDashSegmentList(ref.representation.SegmentList, ref.adaptation.SegmentList, ref.period.SegmentList)

	segments := make([]Segment, 0)
	if segmentList != nil {
		if segmentList.Initialization != nil && strings.TrimSpace(segmentList.Initialization.SourceURL) != "" {
			start, end, err := parseHyphenRange(segmentList.Initialization.Range)
			if err != nil {
				return nil, err
			}
			segments = append(segments, Segment{
				Index: len(segments),
				Start: start,
				End:   end,
				URL:   resolveVideoURL(baseURL, segmentList.Initialization.SourceURL),
				Track: ref.kind,
			})
		}

		segmentDuration := dashSegmentDuration(segmentList.Duration, segmentList.Timescale)
		for _, item := range segmentList.SegmentURLs {
			if strings.TrimSpace(item.Media) == "" {
				continue
			}
			start, end, err := parseHyphenRange(item.MediaRange)
			if err != nil {
				return nil, err
			}
			segments = append(segments, Segment{
				Index:    len(segments),
				Start:    start,
				End:      end,
				URL:      resolveVideoURL(baseURL, item.Media),
				Track:    ref.kind,
				Duration: segmentDuration,
			})
		}

		return segments, nil
	}

	if segmentTemplate != nil {
		if strings.TrimSpace(segmentTemplate.Initialization) != "" {
			segments = append(segments, Segment{
				Index: len(segments),
				URL:   resolveVideoURL(baseURL, fillDashTemplate(segmentTemplate.Initialization, ref.variant, segmentTemplate.startNumber(), 0)),
				Track: ref.kind,
			})
		}

		trackSegments, err := buildDASHTemplateSegments(document, ref, baseURL, segmentTemplate)
		if err != nil {
			return nil, err
		}
		for _, segment := range trackSegments {
			segment.Index = len(segments)
			segments = append(segments, segment)
		}
		return segments, nil
	}

	if strings.TrimSpace(baseURL) != "" {
		segments = append(segments, Segment{
			Index: len(segments),
			URL:   baseURL,
			Track: ref.kind,
		})
		return segments, nil
	}

	return nil, fmt.Errorf("dash representation %q had no segment information", ref.variant.ID)
}

func buildDASHTemplateSegments(document *dashManifestDocument, ref dashRepresentationRef, baseURL string, template *dashSegmentTemplate) ([]Segment, error) {
	if strings.TrimSpace(template.Media) == "" {
		return nil, fmt.Errorf("dash segment template missing media pattern")
	}

	if template.Timeline != nil && len(template.Timeline.Segments) > 0 {
		return buildDASHTimelineSegments(ref, baseURL, template), nil
	}

	segmentDuration := dashSegmentDuration(template.Duration, template.Timescale)
	if segmentDuration <= 0 {
		return nil, fmt.Errorf("dash segment template missing duration")
	}

	totalDuration, err := firstAvailableDashDuration(ref.period.Duration, document.MediaPresentationDuration)
	if err != nil {
		return nil, err
	}
	segmentCount := ceilDurationSegments(totalDuration, segmentDuration)
	if segmentCount <= 0 {
		return nil, fmt.Errorf("dash segment template resolved zero segments")
	}

	segments := make([]Segment, 0, segmentCount)
	for offset := 0; offset < segmentCount; offset++ {
		number := template.startNumber() + int64(offset)
		segments = append(segments, Segment{
			Index:    len(segments),
			URL:      resolveVideoURL(baseURL, fillDashTemplate(template.Media, ref.variant, number, 0)),
			Track:    ref.kind,
			Duration: segmentDuration,
		})
	}
	return segments, nil
}

func buildDASHTimelineSegments(ref dashRepresentationRef, baseURL string, template *dashSegmentTemplate) []Segment {
	segments := make([]Segment, 0)
	number := template.startNumber()
	currentTime := int64(0)
	timescale := template.normalizedTimescale()

	for _, timelineSegment := range template.Timeline.Segments {
		if timelineSegment.StartTime != nil {
			currentTime = *timelineSegment.StartTime
		}

		repeatCount := 0
		if timelineSegment.RepeatCount != nil && *timelineSegment.RepeatCount > 0 {
			repeatCount = *timelineSegment.RepeatCount
		}

		durationSeconds := float64(timelineSegment.Duration) / float64(timescale)
		for repeatIndex := 0; repeatIndex <= repeatCount; repeatIndex++ {
			segments = append(segments, Segment{
				Index:    len(segments),
				URL:      resolveVideoURL(baseURL, fillDashTemplate(template.Media, ref.variant, number, currentTime)),
				Track:    ref.kind,
				Duration: durationSeconds,
			})
			number++
			currentTime += timelineSegment.Duration
		}
	}

	return segments
}

func hasProtectedDASHContent(document dashManifestDocument) bool {
	if dashContentProtectionsProtected(document.ContentProtection) {
		return true
	}
	for _, period := range document.Periods {
		if dashContentProtectionsProtected(period.ContentProtection) {
			return true
		}
		for _, adaptation := range period.AdaptationSets {
			if dashContentProtectionsProtected(adaptation.ContentProtection) {
				return true
			}
			for _, representation := range adaptation.Representations {
				if dashContentProtectionsProtected(representation.ContentProtection) {
					return true
				}
			}
		}
	}
	return false
}

func dashContentProtectionsProtected(values []dashContentProtection) bool {
	for _, value := range values {
		scheme := strings.ToLower(strings.TrimSpace(value.SchemeIDURI))
		switch scheme {
		case "", "urn:mpeg:dash:mp4protection:2011":
			continue
		default:
			return true
		}
	}
	return false
}

func firstDashSegmentTemplate(values ...*dashSegmentTemplate) *dashSegmentTemplate {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstDashSegmentList(values ...*dashSegmentList) *dashSegmentList {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func dashSegmentDuration(duration int64, timescale int64) float64 {
	if duration <= 0 {
		return 0
	}
	if timescale <= 0 {
		timescale = 1
	}
	return float64(duration) / float64(timescale)
}

func firstAvailableDashDuration(values ...string) (time.Duration, error) {
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			continue
		}
		return parseISODuration(value)
	}
	return 0, fmt.Errorf("dash manifest missing presentation duration")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func (template *dashSegmentTemplate) startNumber() int64 {
	if template.StartNumber <= 0 {
		return 1
	}
	return template.StartNumber
}

func (template *dashSegmentTemplate) normalizedTimescale() int64 {
	if template.Timescale <= 0 {
		return 1
	}
	return template.Timescale
}