package main

import (
	"fmt"
	"regexp"
	"strings"
	"sync"

	"github.com/dop251/goja"
)

// youtube_player_js.go ports youtube-dl's base.js signature / n-parameter
// deciphering. Instead of re-implementing a JS interpreter (youtube-dl's
// jsinterp.py) we run the *real* functions from YouTube's base.js in an
// embedded engine (goja). We only need to (1) find the function names with the
// same regexes youtube-dl uses and (2) run them, auto-resolving any global
// helper vars/objects the function references. This mirrors youtube-dl exactly
// while being far less code.

// ytPlayer holds a parsed base.js and caches the resolved signature / n
// function names plus per-input decipher results.
type ytPlayer struct {
	url         string
	baseJS      string
	sts         string
	sigFuncName string
	nFuncName   string

	mu       sync.Mutex
	sigCache map[string]string
	nCache   map[string]string
}

var (
	playerCacheMu sync.Mutex
	playerCache   = map[string]*ytPlayer{}
)

// cachedYouTubePlayer returns an already-parsed ytPlayer for playerURL, or nil.
// Lets callers skip re-downloading base.js when the player is already cached.
func cachedYouTubePlayer(playerURL string) *ytPlayer {
	playerCacheMu.Lock()
	defer playerCacheMu.Unlock()
	return playerCache[playerURL]
}

// getYouTubePlayer returns a cached ytPlayer for the base.js at playerURL,
// fetching and parsing it on first use.
func getYouTubePlayer(baseJS string, playerURL string) *ytPlayer {
	playerCacheMu.Lock()
	defer playerCacheMu.Unlock()
	if p, ok := playerCache[playerURL]; ok {
		return p
	}
	p := &ytPlayer{
		url:      playerURL,
		baseJS:   baseJS,
		sts:      extractSignatureTimestamp(baseJS),
		sigCache: map[string]string{},
		nCache:   map[string]string{},
	}
	p.sigFuncName = findSigFunctionName(baseJS)
	p.nFuncName = findNFunctionName(baseJS)
	playerCache[playerURL] = p
	return p
}

// DecipherSignature turns an encrypted `s` value into a working signature.
func (p *ytPlayer) DecipherSignature(s string) (string, error) {
	if p.sigFuncName == "" {
		return "", fmt.Errorf("youtube: signature function not found in base.js")
	}
	p.mu.Lock()
	if v, ok := p.sigCache[s]; ok {
		p.mu.Unlock()
		return v, nil
	}
	p.mu.Unlock()

	out, err := runPlayerFunction(p.baseJS, p.sigFuncName, s)
	if err != nil {
		return "", fmt.Errorf("youtube: signature decipher failed: %w", err)
	}
	p.mu.Lock()
	p.sigCache[s] = out
	p.mu.Unlock()
	return out, nil
}

// DecipherN transforms the throttling `n` parameter. A failure here is not
// fatal (playback still works, just throttled) so callers may fall back to the
// original value.
func (p *ytPlayer) DecipherN(n string) (string, error) {
	if p.nFuncName == "" {
		return "", fmt.Errorf("youtube: n function not found in base.js")
	}
	p.mu.Lock()
	if v, ok := p.nCache[n]; ok {
		p.mu.Unlock()
		return v, nil
	}
	p.mu.Unlock()

	out, err := runPlayerFunction(p.baseJS, p.nFuncName, n)
	if err != nil {
		return "", fmt.Errorf("youtube: n decipher failed: %w", err)
	}
	// A returned value that equals the input, or an "enhanced_except_" marker,
	// means the extraction was wrong (youtube-dl treats this as failure).
	if out == n || strings.HasPrefix(out, "enhanced_except_") {
		return "", fmt.Errorf("youtube: n function returned an exception marker")
	}
	p.mu.Lock()
	p.nCache[n] = out
	p.mu.Unlock()
	return out, nil
}

var refNotDefinedRe = regexp.MustCompile(`ReferenceError:\s*([A-Za-z0-9_$]+)\s+is not defined`)

// runPlayerFunction extracts `funcName` from base.js, runs it against `arg` in
// goja, and auto-prepends any top-level helper definitions the function
// references (helper objects for the signature transform, lookup arrays for the
// n transform). This replaces youtube-dl's manual dependency extraction with a
// resolve-on-ReferenceError loop.
func runPlayerFunction(baseJS string, funcName string, arg string) (string, error) {
	funcDef := extractCallable(baseJS, funcName)
	if funcDef == "" {
		return "", fmt.Errorf("could not extract function %q from base.js", funcName)
	}

	deps := ""
	added := map[string]bool{funcName: true}

	for attempt := 0; attempt < 25; attempt++ {
		program := deps + "\n" + funcDef + "\n;var __ytout = " + funcName + "(" + jsStringLiteral(arg) + ");"
		vm := goja.New()
		_, err := vm.RunString(program)
		if err == nil {
			return vm.Get("__ytout").String(), nil
		}

		match := refNotDefinedRe.FindStringSubmatch(err.Error())
		if match == nil {
			return "", err
		}
		missing := match[1]
		if added[missing] {
			return "", fmt.Errorf("unresolved reference %q while running %q", missing, funcName)
		}
		def := extractCallable(baseJS, missing)
		if def == "" {
			return "", fmt.Errorf("missing helper %q referenced by %q", missing, funcName)
		}
		added[missing] = true
		deps = def + ";\n" + deps
	}
	return "", fmt.Errorf("too many helper dependencies resolving %q", funcName)
}

// extractCallable returns a self-contained JS statement that defines `name`,
// handling assignment form (`name=function(){}` / `var name=[...]` /
// `name={...}`) and function-declaration form (`function name(){}`). The
// returned snippet always defines a top-level `var name` (or a function decl)
// so it can be prepended to a program.
func extractCallable(js string, name string) string {
	if def := extractAssignment(js, name); def != "" {
		return "var " + def
	}
	if def := extractFunctionDeclaration(js, name); def != "" {
		return def
	}
	return ""
}

// extractAssignment finds `name = <expr>` (optionally preceded by `var`) at an
// identifier boundary and returns `name=<expr>` with a balanced RHS. When the
// same name is assigned more than once (minified base.js reuses short names), a
// definition-shaped RHS (object/array/function literal) is preferred over a bare
// `name=expr`, which is far more likely to be a later reassignment or use.
func extractAssignment(js string, name string) string {
	fallback := ""
	for _, start := range identifierOccurrences(js, name) {
		i := start + len(name)
		j := skipSpaces(js, i)
		if j >= len(js) || js[j] != '=' {
			continue
		}
		// Reject == / => / === etc.
		if j+1 < len(js) && (js[j+1] == '=' || js[j+1] == '>') {
			continue
		}
		rhsStart := skipSpaces(js, j+1)
		end := scanBalanced(js, rhsStart)
		if end <= rhsStart {
			continue
		}
		rhs := strings.TrimSpace(js[rhsStart:end])
		if rhs == "" {
			continue
		}
		if rhs[0] == '{' || rhs[0] == '[' || strings.HasPrefix(rhs, "function") {
			return name + "=" + rhs
		}
		if fallback == "" {
			fallback = name + "=" + rhs
		}
	}
	return fallback
}

// extractFunctionDeclaration finds `function name(...) { ... }`.
func extractFunctionDeclaration(js string, name string) string {
	re := regexp.MustCompile(`function\s+` + regexp.QuoteMeta(name) + `\s*\(`)
	loc := re.FindStringIndex(js)
	if loc == nil {
		return ""
	}
	brace := strings.IndexByte(js[loc[0]:], '{')
	if brace < 0 {
		return ""
	}
	bodyStart := loc[0] + brace
	bodyEnd := matchBrace(js, bodyStart)
	if bodyEnd <= bodyStart {
		return ""
	}
	return js[loc[0] : bodyEnd+1]
}

// identifierOccurrences returns indices where `name` appears as a standalone
// identifier (not a property access, not part of a longer identifier).
func identifierOccurrences(js string, name string) []int {
	out := []int{}
	from := 0
	for {
		idx := strings.Index(js[from:], name)
		if idx < 0 {
			break
		}
		abs := from + idx
		from = abs + 1
		if abs > 0 {
			prev := js[abs-1]
			if isIdentByte(prev) || prev == '.' {
				continue
			}
		}
		after := abs + len(name)
		if after < len(js) && isIdentByte(js[after]) {
			continue
		}
		out = append(out, abs)
	}
	return out
}

// scanBalanced returns the index just past a balanced JS expression starting at
// `start`, stopping at a top-level `;` , `,` (depth 0) or end of input. String,
// comment and regex-literal tokens are skipped so their contents cannot throw
// off bracket/quote tracking.
func scanBalanced(js string, start int) int {
	depth := 0
	i := start
	prevValue := false
	for i < len(js) {
		c := js[i]
		switch c {
		case '\'', '"', '`':
			i = skipString(js, i)
			prevValue = true
			continue
		case '/':
			if next, handled, isValue := skipCommentOrRegex(js, i, prevValue); handled {
				i = next
				prevValue = isValue
				continue
			}
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			if depth == 0 {
				return i
			}
			depth--
		case ';', ',':
			if depth == 0 {
				return i
			}
		}
		if c != ' ' && c != '\t' && c != '\n' && c != '\r' {
			prevValue = isValueByte(c)
		}
		i++
	}
	return i
}

// matchBrace returns the index of the `}` matching the `{` at `open`, skipping
// string, comment and regex-literal tokens.
func matchBrace(js string, open int) int {
	depth := 0
	i := open
	prevValue := false
	for i < len(js) {
		c := js[i]
		switch c {
		case '\'', '"', '`':
			i = skipString(js, i)
			prevValue = true
			continue
		case '/':
			if next, handled, isValue := skipCommentOrRegex(js, i, prevValue); handled {
				i = next
				prevValue = isValue
				continue
			}
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return i
			}
		}
		if c != ' ' && c != '\t' && c != '\n' && c != '\r' {
			prevValue = isValueByte(c)
		}
		i++
	}
	return -1
}

// isValueByte reports whether a byte ends a value-producing token, which decides
// whether a following `/` is a division operator (after a value) or the start of
// a regex literal (otherwise).
func isValueByte(b byte) bool {
	return isIdentByte(b) || b == ')' || b == ']'
}

// regexPrecedingKeywords are the identifiers after which a `/` begins a regex
// literal, not a division — even though the keyword ends in an identifier byte.
// Minifiers emit these with no space (e.g. `return/x/.test(a)`).
var regexPrecedingKeywords = map[string]bool{
	"return": true, "typeof": true, "instanceof": true, "in": true, "of": true,
	"new": true, "delete": true, "void": true, "do": true, "else": true,
	"yield": true, "throw": true, "case": true, "debugger": true,
}

// precededByRegexKeyword reports whether the `/` at js[i] is immediately
// preceded (ignoring whitespace) by one of the regex-introducing keywords, and
// that keyword is not a property access (`.return` etc. is a value → division).
func precededByRegexKeyword(js string, i int) bool {
	j := i - 1
	for j >= 0 && isSpaceByte(js[j]) {
		j--
	}
	end := j + 1
	for j >= 0 && isIdentByte(js[j]) {
		j--
	}
	start := j + 1
	if start >= end || !regexPrecedingKeywords[js[start:end]] {
		return false
	}
	k := start - 1
	for k >= 0 && isSpaceByte(js[k]) {
		k--
	}
	return !(k >= 0 && js[k] == '.')
}

func isSpaceByte(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r'
}

// skipCommentOrRegex handles a `/` at js[i]. Using whether the previous
// significant token produced a value (prevValue), it distinguishes a division
// operator (handled=false) from a // or /* */ comment or a /regex/ literal
// (handled=true). isValue reports whether the skipped run counts as a value for
// the token that follows.
func skipCommentOrRegex(js string, i int, prevValue bool) (next int, handled bool, isValue bool) {
	if i+1 < len(js) && js[i+1] == '/' {
		j := i + 2
		for j < len(js) && js[j] != '\n' {
			j++
		}
		return j, true, prevValue // line comment: value-ness unchanged
	}
	if i+1 < len(js) && js[i+1] == '*' {
		j := i + 2
		for j+1 < len(js) {
			if js[j] == '*' && js[j+1] == '/' {
				return j + 2, true, prevValue
			}
			j++
		}
		return len(js), true, prevValue
	}
	if prevValue && !precededByRegexKeyword(js, i) {
		return i, false, true // division operator
	}
	// Regex literal /.../flags, honoring [...] classes and backslash escapes.
	j := i + 1
	inClass := false
	for j < len(js) {
		c := js[j]
		if c == '\\' {
			j += 2
			continue
		}
		switch c {
		case '[':
			inClass = true
		case ']':
			inClass = false
		case '/':
			if !inClass {
				j++
				for j < len(js) && isIdentByte(js[j]) {
					j++
				}
				return j, true, true
			}
		case '\n':
			// Regex literals cannot span lines; bail rather than over-consume.
			return i, false, false
		}
		j++
	}
	return j, true, true
}

// skipString returns the index just past a string literal starting at `i`
// (js[i] is the opening quote), honoring backslash escapes.
func skipString(js string, i int) int {
	quote := js[i]
	i++
	for i < len(js) {
		if js[i] == '\\' {
			i += 2
			continue
		}
		if js[i] == quote {
			return i + 1
		}
		i++
	}
	return i
}

func skipSpaces(js string, i int) int {
	for i < len(js) && (js[i] == ' ' || js[i] == '\t' || js[i] == '\n' || js[i] == '\r') {
		i++
	}
	return i
}

func isIdentByte(b byte) bool {
	return b == '_' || b == '$' ||
		(b >= 'a' && b <= 'z') ||
		(b >= 'A' && b <= 'Z') ||
		(b >= '0' && b <= '9')
}

// jsStringLiteral produces a safely quoted JS string literal for `s`.
func jsStringLiteral(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

// --- function-name discovery (ported from youtube-dl regexes, RE2-safe) ---

var sigFuncNameRes = []*regexp.Regexp{
	// sig=function(a){a=a.split(""); ...
	regexp.MustCompile(`(?:\b|[^\w$])([\w$]{2,})\s*=\s*function\(\s*[\w$]+\s*\)\s*\{\s*[\w$]+\s*=\s*[\w$]+\.split\(\s*""\s*\)`),
	// var=X(decodeURIComponent(var))
	regexp.MustCompile(`[\w$]+&&\([\w$]+=([\w$]{2,})\(decodeURIComponent\(`),
	regexp.MustCompile(`\bm=([\w$]{2,})\(decodeURIComponent\(h\.s\)\)`),
	regexp.MustCompile(`["']signature["']\s*,\s*([\w$]+)\(`),
	regexp.MustCompile(`\.sig\|\|([\w$]+)\(`),
	regexp.MustCompile(`\b[cs]\s*&&\s*[adf]\.set\([^,]+\s*,\s*encodeURIComponent\s*\(\s*([\w$]+)\(`),
}

func findSigFunctionName(js string) string {
	for _, re := range sigFuncNameRes {
		if m := re.FindStringSubmatch(js); m != nil {
			return m[1]
		}
	}
	return ""
}

var (
	// The n function bails out early returning an "enhanced_except_" string or a
	// "<id>_w8_" prefixed string on error; that marker uniquely identifies it.
	nFuncMarkerRe = regexp.MustCompile(`(?s)([A-Za-z0-9_$]{2,})\s*=\s*function\(\s*[A-Za-z0-9_$]+\s*\)\s*\{.{0,1000}?(?:enhanced_except_|"[A-Za-z0-9-]+_w8_")`)
	// Fallback: nfunc referenced via array, e.g. `b=nobj[0](b)`; capture nobj[idx].
	nFuncArrayRe = regexp.MustCompile(`[\w$]+\s*=\s*([\w$]+)\s*\[\s*(\d+)\s*\]\s*\(\s*[\w$]+\s*\)`)
)

func findNFunctionName(js string) string {
	if m := nFuncMarkerRe.FindStringSubmatch(js); m != nil {
		return m[1]
	}
	// Array-indirection fallback: resolve the array element to a function name.
	if m := nFuncArrayRe.FindStringSubmatch(js); m != nil {
		if name := resolveArrayFunctionName(js, m[1], m[2]); name != "" {
			return name
		}
	}
	return ""
}

// resolveArrayFunctionName resolves `arrName[idx]` to the identifier stored at
// that array index (e.g. `var Wma=[abc]` => index 0 => "abc").
func resolveArrayFunctionName(js string, arrName string, idx string) string {
	def := extractAssignment(js, arrName)
	if def == "" {
		return ""
	}
	open := strings.IndexByte(def, '[')
	close := strings.LastIndexByte(def, ']')
	if open < 0 || close <= open {
		return ""
	}
	items := strings.Split(def[open+1:close], ",")
	var i int
	if _, err := fmt.Sscanf(idx, "%d", &i); err != nil || i < 0 || i >= len(items) {
		return ""
	}
	return strings.TrimSpace(items[i])
}

var stsRe = regexp.MustCompile(`(?:signatureTimestamp|sts)\s*[:=]\s*(\d{5,})`)

func extractSignatureTimestamp(js string) string {
	if m := stsRe.FindStringSubmatch(js); m != nil {
		return m[1]
	}
	return ""
}
