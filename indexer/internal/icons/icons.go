// Package icons resolves and caches token identity the SEP-1 way: the
// issuer account names a home domain on chain, the domain's stellar.toml
// names the image and the official name, and this service fetches both
// so viewers never talk to issuer infrastructure themselves.
package icons

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ErrNoIcon covers every way an asset can lack an icon: no home domain,
// no toml, no matching entry, or an image the service refuses to serve.
var ErrNoIcon = errors.New("no icon for this asset")

// ErrNoMeta means the issuer publishes nothing at all, not even a home
// domain, so there is no identity to report.
var ErrNoMeta = errors.New("no meta for this asset")

var errNoDomain = errors.New("issuer names no home domain")

// errTransient marks a failure that says nothing about the asset: a rate
// limit, a timeout, a connection dropped mid-body. Such an outcome is
// surfaced to the caller and never cached, so a blip cannot pin a real
// asset to a miss for the negative ttl.
var errTransient = errors.New("transient upstream failure")

const (
	maxTomlBytes  = 100 * 1024 // the size SEP-1 itself allows
	maxImageBytes = 512 * 1024
	// issuer-written text flows into api responses; keep it label-sized
	maxNameRunes = 64
	maxDescRunes = 400
	positiveTTL  = 24 * time.Hour
	negativeTTL  = time.Hour
	cacheBudget  = 128 * 1024 * 1024
	// a dead issuer domain should cost the first viewer seconds, not the
	// full client timeout three times over
	stepTimeout = 4 * time.Second
)

// domainOverrides patches assets whose on-chain home_domain points at a
// host that serves no stellar.toml while the issuer still maintains one
// elsewhere. Every entry names an issuer-operated domain, verified by
// hand: this is a repair list, not a directory. Circle moved its
// home_domain to circle.com without moving the toml off centre.io.
var domainOverrides = map[string]string{
	"USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN": "centre.io",
}

var (
	domainShape = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)
	imageTypes  = map[string]bool{
		"image/png":  true,
		"image/jpeg": true,
		"image/webp": true,
		"image/gif":  true,
	}
)

type entry struct {
	body        []byte
	contentType string
	domain      string
	name        string
	desc        string
	fetchedAt   time.Time
	found       bool // an icon was fetched; meta can exist without one
}

// a floor per entry so the byte budget also bounds the number of cached
// misses, which carry issuer text but no image body
const entryOverhead = 256

func (e *entry) size() int {
	return entryOverhead + len(e.body) + len(e.contentType) +
		len(e.domain) + len(e.name) + len(e.desc)
}

type Service struct {
	client     *http.Client
	horizonURL string
	// the toml url is templated so tests can point the chain at a local
	// server; production always formats https://{domain}/.well-known/...
	tomlURL string

	mu         sync.Mutex
	cache      map[string]*entry
	order      []string // oldest first, for byte-budget eviction
	cacheBytes int
	inFlight   map[string]chan struct{}
}

func New(client *http.Client, horizonURL string) *Service {
	return &Service{
		client:     client,
		horizonURL: strings.TrimSuffix(horizonURL, "/"),
		tomlURL:    "https://%s/.well-known/stellar.toml",
		cache:      make(map[string]*entry),
		inFlight:   make(map[string]chan struct{}),
	}
}

// Meta is what an issuer publishes about one of its assets. Domain is
// always set; the rest depends on what the stellar.toml offers.
type Meta struct {
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
	Domain      string `json:"domain"`
	Icon        bool   `json:"icon"`
}

// Icon returns the image bytes and content type for an asset, or ErrNoIcon.
// Outcomes are cached either way, so a busy page cannot hammer an issuer.
func (s *Service) Icon(ctx context.Context, code, issuer string) ([]byte, string, error) {
	cached, err := s.resolved(ctx, code, issuer)
	if err != nil {
		return nil, "", err
	}
	if !cached.found {
		return nil, "", ErrNoIcon
	}
	return cached.body, cached.contentType, nil
}

// Meta reports the issuer-published identity of an asset, or ErrNoMeta
// when the issuer names no home domain at all. It shares the icon
// resolution, so asking for both costs one trip to the issuer.
func (s *Service) Meta(ctx context.Context, code, issuer string) (Meta, error) {
	cached, err := s.resolved(ctx, code, issuer)
	if err != nil {
		return Meta{}, err
	}
	if cached.domain == "" {
		return Meta{}, ErrNoMeta
	}
	return Meta{
		Name:        cached.name,
		Description: cached.desc,
		Domain:      cached.domain,
		Icon:        cached.found,
	}, nil
}

func (s *Service) resolved(ctx context.Context, code, issuer string) (*entry, error) {
	key := code + ":" + issuer
	for {
		if cached, ok := s.lookup(key); ok {
			return cached, nil
		}
		done, leader := s.claim(key)
		if leader {
			break
		}
		// somebody else is already resolving this asset; share their work
		select {
		case <-done:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	defer s.release(key)
	resolved, err := s.resolve(ctx, code, issuer)
	if err != nil {
		return nil, err // transient upstream trouble is not worth caching
	}
	s.store(key, resolved)
	return resolved, nil
}

func (s *Service) claim(key string) (chan struct{}, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if done, ok := s.inFlight[key]; ok {
		return done, false
	}
	done := make(chan struct{})
	s.inFlight[key] = done
	return done, true
}

func (s *Service) release(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if done, ok := s.inFlight[key]; ok {
		close(done)
		delete(s.inFlight, key)
	}
}

func (s *Service) resolve(ctx context.Context, code, issuer string) (*entry, error) {
	now := time.Now()
	domain, overridden := domainOverrides[code+":"+issuer]
	if !overridden {
		var err error
		domain, err = s.homeDomain(ctx, issuer)
		if errors.Is(err, errNoDomain) {
			return &entry{fetchedAt: now}, nil
		}
		if err != nil {
			return nil, err
		}
	}
	if !domainShape.MatchString(strings.ToLower(domain)) || len(domain) > 253 {
		return &entry{fetchedAt: now}, nil
	}
	resolved := &entry{domain: domain, fetchedAt: now}
	currency, err := s.tomlCurrency(ctx, domain, code, issuer)
	if errors.Is(err, errTransient) {
		return nil, err
	}
	if err != nil {
		return resolved, nil // a dead or useless toml still leaves the domain known
	}
	resolved.name = currency.name
	resolved.desc = currency.desc
	if currency.image != "" {
		body, contentType, err := s.fetchImage(ctx, currency.image)
		if errors.Is(err, errTransient) {
			return nil, err
		}
		if err == nil {
			resolved.body, resolved.contentType, resolved.found = body, contentType, true
		}
	}
	return resolved, nil
}

func (s *Service) homeDomain(ctx context.Context, issuer string) (string, error) {
	var payload struct {
		HomeDomain string `json:"home_domain"`
	}
	status, err := s.getJSON(ctx, s.horizonURL+"/accounts/"+issuer, &payload)
	if err != nil {
		return "", fmt.Errorf("horizon account: %w", err)
	}
	// a rate limit or timeout is about our traffic, not the issuer; caching
	// it as "no domain" would blank real assets for the negative ttl
	if status == http.StatusTooManyRequests || status == http.StatusRequestTimeout {
		return "", fmt.Errorf("horizon account: %w: status %d", errTransient, status)
	}
	// any other 4xx means the issuer cannot be looked up, which for identity
	// purposes is the same fact as an issuer publishing nothing
	if status >= 400 && status < 500 {
		return "", errNoDomain
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("horizon account: status %d", status)
	}
	if payload.HomeDomain == "" {
		return "", errNoDomain
	}
	return payload.HomeDomain, nil
}

// tomlCurrency fetches a domain's stellar.toml and returns the matching
// currency entry. Every failure reads the same to the caller: the domain
// offered nothing usable for this asset.
func (s *Service) tomlCurrency(ctx context.Context, domain, code, issuer string) (tomlEntry, error) {
	ctx, cancel := context.WithTimeout(ctx, stepTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf(s.tomlURL, domain), nil)
	if err != nil {
		return tomlEntry{}, fmt.Errorf("toml request: %w", err)
	}
	response, err := s.client.Do(request)
	if err != nil {
		return tomlEntry{}, fmt.Errorf("toml fetch: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return tomlEntry{}, fmt.Errorf("toml fetch: status %d", response.StatusCode)
	}
	text, err := io.ReadAll(io.LimitReader(response.Body, maxTomlBytes+1))
	if err != nil {
		return tomlEntry{}, fmt.Errorf("toml read: %w: %v", errTransient, err)
	}
	if len(text) > maxTomlBytes {
		return tomlEntry{}, fmt.Errorf("toml larger than %d bytes", maxTomlBytes)
	}
	currency := currencyMeta(string(text), code, issuer)
	currency.name = clean(currency.name, maxNameRunes)
	currency.desc = clean(currency.desc, maxDescRunes)
	if !strings.HasPrefix(currency.image, "https://") {
		currency.image = ""
	}
	return currency, nil
}

func (s *Service) fetchImage(ctx context.Context, url string) ([]byte, string, error) {
	ctx, cancel := context.WithTimeout(ctx, stepTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "", fmt.Errorf("image request: %w", err)
	}
	response, err := s.client.Do(request)
	if err != nil {
		return nil, "", ErrNoIcon
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, "", ErrNoIcon
	}
	contentType, _, _ := strings.Cut(response.Header.Get("Content-Type"), ";")
	contentType = strings.TrimSpace(contentType)
	if !imageTypes[contentType] {
		return nil, "", ErrNoIcon
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxImageBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("image read: %w: %v", errTransient, err)
	}
	if len(body) > maxImageBytes {
		return nil, "", ErrNoIcon
	}
	return body, contentType, nil
}

func (s *Service) getJSON(ctx context.Context, url string, out any) (int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	request.Header.Set("Accept", "application/json")
	response, err := s.client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return response.StatusCode, nil
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, maxTomlBytes)).Decode(out); err != nil {
		return 0, err
	}
	return response.StatusCode, nil
}

// CachedIcon describes one cache entry for operational visibility.
type CachedIcon struct {
	Code      string    `json:"code"`
	Issuer    string    `json:"issuer"`
	Domain    string    `json:"domain,omitempty"`
	Name      string    `json:"name,omitempty"`
	Found     bool      `json:"found"`
	Bytes     int       `json:"bytes"`
	FetchedAt time.Time `json:"fetched_at"`
}

// Cached lists the cache newest first, so operators can see what the
// service resolved without reaching into the process.
func (s *Service) Cached() []CachedIcon {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]CachedIcon, 0, len(s.order))
	for i := len(s.order) - 1; i >= 0; i-- {
		key := s.order[i]
		cached, ok := s.cache[key]
		if !ok {
			continue
		}
		code, issuer, _ := strings.Cut(key, ":")
		out = append(out, CachedIcon{
			Code:      code,
			Issuer:    issuer,
			Domain:    cached.domain,
			Name:      cached.name,
			Found:     cached.found,
			Bytes:     len(cached.body),
			FetchedAt: cached.fetchedAt,
		})
	}
	return out
}

func (s *Service) lookup(key string) (*entry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cached, ok := s.cache[key]
	if !ok {
		return nil, false
	}
	ttl := negativeTTL
	if cached.found {
		ttl = positiveTTL
	}
	if time.Since(cached.fetchedAt) > ttl {
		return nil, false
	}
	return cached, true
}

func (s *Service) store(key string, value *entry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.cache[key]; ok {
		s.cacheBytes -= old.size()
	} else {
		s.order = append(s.order, key)
	}
	s.cache[key] = value
	s.cacheBytes += value.size()
	for s.cacheBytes > cacheBudget && len(s.order) > 0 {
		oldest := s.order[0]
		s.order = s.order[1:]
		if evicted, ok := s.cache[oldest]; ok {
			s.cacheBytes -= evicted.size()
			delete(s.cache, oldest)
		}
	}
}

type tomlEntry struct {
	name  string
	desc  string
	image string
}

// currencyMeta walks the [[CURRENCIES]] sections with a tolerant line
// parser: real files disagree on spacing and quoting, and one malformed
// section must not cost the entries after it.
func currencyMeta(text, code, issuer string) tomlEntry {
	var current, best tomlEntry
	var codeMatch, issuerMatch, inCurrency, haveBest bool
	matched := func() bool { return codeMatch && issuerMatch }
	// an image is the most a section can offer, so the first matched
	// section that carries one wins; otherwise the first matched section
	// stands, so a duplicate entry cannot erase a real one after it
	consider := func() bool {
		if !matched() {
			return false
		}
		if current.image != "" {
			best = current
			return true
		}
		if !haveBest {
			best, haveBest = current, true
		}
		return false
	}
	for _, rawLine := range strings.Split(text, "\n") {
		line := strings.TrimSpace(rawLine)
		if strings.HasPrefix(line, "[") {
			if consider() {
				return best
			}
			inCurrency = strings.ReplaceAll(line, " ", "") == "[[CURRENCIES]]"
			current, codeMatch, issuerMatch = tomlEntry{}, false, false
			continue
		}
		if !inCurrency || line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(key)) {
		case "code":
			codeMatch = unquote(value) == code
		case "issuer":
			issuerMatch = unquote(value) == issuer
		case "name":
			current.name = unquote(value)
		case "desc":
			current.desc = unquote(value)
		case "image":
			current.image = unquote(value)
		}
	}
	consider()
	return best
}

// clean strips control and direction-spoofing characters and caps length:
// this text is written by the issuer and served to browsers verbatim
// otherwise, so C0 and C1 controls, bidi overrides, and zero-width joiners
// all have to go before it leaves the service.
func clean(value string, maxRunes int) string {
	var builder strings.Builder
	for _, r := range value {
		if isUnsafeRune(r) {
			continue
		}
		builder.WriteRune(r)
		maxRunes--
		if maxRunes == 0 {
			break
		}
	}
	return strings.TrimSpace(builder.String())
}

// isUnsafeRune reports characters that must not survive into an api
// response: C0 and C1 control ranges, plus the bidi and zero-width
// formatting characters that can make one string render as another.
func isUnsafeRune(r rune) bool {
	switch {
	case r < 0x20, r == 0x7f, r >= 0x80 && r <= 0x9f:
		return true
	case r >= 0x202a && r <= 0x202e: // LRE, RLE, PDF, LRO, RLO
		return true
	case r >= 0x2066 && r <= 0x2069: // LRI, RLI, FSI, PDI
		return true
	case r == 0x200b, r == 0x200c, r == 0x200d, r == 0x200e, r == 0x200f:
		return true // zero-width space, ZWNJ, ZWJ, LRM, RLM
	case r == 0xfeff: // zero-width no-break space / BOM
		return true
	}
	return false
}

func unquote(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 {
		first := value[0]
		if (first == '"' || first == '\'') && value[len(value)-1] == first {
			return value[1 : len(value)-1]
		}
	}
	return value
}
