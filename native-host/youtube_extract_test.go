package main

import (
	"strings"
	"testing"
)

func TestExtractYouTubeVideoID(t *testing.T) {
	cases := map[string]string{
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ":       "dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ?t=10":                 "dQw4w9WgXcQ",
		"https://www.youtube.com/shorts/abcdefghijk":        "abcdefghijk",
		"https://www.youtube.com/embed/dQw4w9WgXcQ":         "dQw4w9WgXcQ",
		"https://m.youtube.com/watch?v=dQw4w9WgXcQ&foo=bar": "dQw4w9WgXcQ",
		"https://example.com/watch?v=dQw4w9WgXcQ":           "dQw4w9WgXcQ", // has v= but not yt
	}
	for in, want := range cases {
		if got := extractYouTubeVideoID(in); got != want {
			t.Errorf("extractYouTubeVideoID(%q)=%q want %q", in, got, want)
		}
	}
}

func TestIsYouTubeURL(t *testing.T) {
	yes := []string{"https://www.youtube.com/watch?v=x", "https://youtu.be/x", "https://music.youtube.com/watch?v=x"}
	no := []string{"https://vimeo.com/1", "https://notyoutube.com.evil.com/x", "https://example.com"}
	for _, u := range yes {
		if !isYouTubeURL(u) {
			t.Errorf("expected youtube: %s", u)
		}
	}
	for _, u := range no {
		if isYouTubeURL(u) {
			t.Errorf("expected NOT youtube: %s", u)
		}
	}
}

// Emulated base.js: a signature function using a helper object (reverse/splice/
// swap) plus a global var, and an n function with a global lookup array.
const fakeBaseJS = `
var _gv='abc'.split('');
var Xh={
  AA:function(a){a.reverse()},
  BB:function(a,b){a.splice(0,b)},
  CC:function(a,b){var c=a[0];a[0]=a[b%a.length];a[b%a.length]=c}
};
sigfn=function(a){a=a.split("");Xh.CC(a,2);Xh.AA(a);Xh.BB(a,1);return a.join("")};
var nlut=["1","2","3"];
nfn=function(a){var b=a.split("");b.reverse();return nlut[0]+b.join("")+"x_ok"};
var junk=1;
signatureTimestamp:19999,
`

func TestRunSignatureFunction(t *testing.T) {
	// input "0123456": split -> swap idx0<->2 -> reverse -> splice(1)
	got, err := runPlayerFunction(fakeBaseJS, "sigfn", "0123456")
	if err != nil {
		t.Fatalf("sig err: %v", err)
	}
	// compute expected in Go
	a := []rune("0123456")
	a[0], a[2%len(a)] = a[2%len(a)], a[0] // swap
	// reverse
	for i, j := 0, len(a)-1; i < j; i, j = i+1, j-1 {
		a[i], a[j] = a[j], a[i]
	}
	a = a[1:] // splice(0,1)
	want := string(a)
	if got != want {
		t.Errorf("sig got %q want %q", got, want)
	}
}

func TestRunNFunctionWithGlobalArray(t *testing.T) {
	got, err := runPlayerFunction(fakeBaseJS, "nfn", "hello")
	if err != nil {
		t.Fatalf("n err: %v", err)
	}
	if !strings.HasPrefix(got, "1") || !strings.HasSuffix(got, "x_ok") {
		t.Errorf("n got %q", got)
	}
}

func TestFindFunctionNames(t *testing.T) {
	if n := findSigFunctionName(fakeBaseJS); n != "sigfn" {
		t.Errorf("sig name %q", n)
	}
	if got := extractSignatureTimestamp(fakeBaseJS); got != "19999" {
		t.Errorf("sts %q", got)
	}
}

// Helper object method body contains a regex literal with braces/quotes; the
// brace/string scanners must skip it or extraction of Zq (and the whole sig)
// breaks. Guards the regex-literal fix in scanBalanced/matchBrace.
const regexBaseJS = `
junk=1/2;
var Zq={
  ff:function(a){return a.replace(/["{}]/g,"")},
  gg:function(a){a.reverse()}
};
sig2=function(a){a=a.split("");Zq.gg(a);return Zq.ff(a.join(""))};
`

func TestRunSignatureFunctionWithRegexLiteral(t *testing.T) {
	got, err := runPlayerFunction(regexBaseJS, "sig2", `a{b"c`)
	if err != nil {
		t.Fatalf("sig2 err: %v", err)
	}
	// split -> reverse -> ff strips " { } -> "cba"
	if got != "cba" {
		t.Errorf("sig2 got %q want %q", got, "cba")
	}
}

func TestExtractAssignmentPrefersDefinition(t *testing.T) {
	js := `Yh=x+1;var Yh={aa:function(a){return a}};`
	def := extractAssignment(js, "Yh")
	if !strings.Contains(def, "aa:function") {
		t.Errorf("extractAssignment picked non-definition: %q", def)
	}
}

func TestYtDecodeJSString(t *testing.T) {
	cases := map[string]string{
		`\/s\/player\/abc\/base.js`: "/s/player/abc/base.js",
		`/path`:                     "/path",
		`plain`:                     "plain",
		"":                          "",
	}
	for in, want := range cases {
		if got := ytDecodeJSString(in); got != want {
			t.Errorf("ytDecodeJSString(%q)=%q want %q", in, got, want)
		}
	}
}

func TestYtSanitizeTitle(t *testing.T) {
	if got := ytSanitizeTitle(`AC/DC: Back?  In *Black*`); got != "AC DC Back In Black" {
		t.Errorf("sanitize got %q", got)
	}
	if got := ytSanitizeTitle("   "); got != "" {
		t.Errorf("sanitize blank got %q", got)
	}
}

// Minifiers emit a regex directly after `return` with no space; the `/` must be
// read as a regex literal, not division, or scanning corrupts on its `"{}`.
const regexAfterReturnJS = `
var Wq={
  ff:function(a){return/["{}]/.test(a)?a.replace(/["{}]/g,""):a},
  gg:function(a){a.reverse()}
};
sig3=function(a){a=a.split("");Wq.gg(a);return Wq.ff(a.join(""))};
`

func TestRunSignatureFunctionRegexAfterKeyword(t *testing.T) {
	got, err := runPlayerFunction(regexAfterReturnJS, "sig3", `a{b"c`)
	if err != nil {
		t.Fatalf("sig3 err: %v", err)
	}
	if got != "cba" {
		t.Errorf("sig3 got %q want %q", got, "cba")
	}
}

func TestPrecededByRegexKeyword(t *testing.T) {
	// return/x/ -> regex; a/x -> division; obj.return/x -> division (property).
	if !precededByRegexKeyword("return/x/", 6) {
		t.Error("return should introduce a regex")
	}
	if precededByRegexKeyword("ab/x/", 2) {
		t.Error("identifier before / is division")
	}
	if precededByRegexKeyword("a.return/2", 8) {
		t.Error(".return is a property access -> division")
	}
}

func TestAppendYouTubeFragments(t *testing.T) {
	m := &VideoManifest{}
	f := ytFormat{Itag: 137, ContentLength: "26214400"} // 25 MiB -> 3 chunks (10+10+5)
	if err := appendYouTubeFragments(m, "https://r1.googlevideo.com/v?id=1", f, "video"); err != nil {
		t.Fatal(err)
	}
	if len(m.Segments) != 3 {
		t.Fatalf("want 3 segments got %d", len(m.Segments))
	}
	if !strings.Contains(m.Segments[0].URL, "range=0-10485759") {
		t.Errorf("bad first range: %s", m.Segments[0].URL)
	}
	if !strings.Contains(m.Segments[2].URL, "range=20971520-26214399") {
		t.Errorf("bad last range: %s", m.Segments[2].URL)
	}
	for _, s := range m.Segments {
		if s.Track != "video" || s.End != -1 {
			t.Errorf("bad segment %+v", s)
		}
	}
}
