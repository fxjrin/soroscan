// Package icons resolves and caches token icons the SEP-1 way: the
// issuer account names a home domain on chain, the domain's stellar.toml
// names the image, and this service fetches it so viewers never talk to
// issuer infrastructure themselves.
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

const (
	maxTomlBytes  = 100 * 1024 // the size SEP-1 itself allows
	maxImageBytes = 512 * 1024
	positiveTTL   = 24 * time.Hour
	negativeTTL   = time.Hour
	cacheBudget   = 128 * 1024 * 1024
)

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
	fetchedAt   time.Time
	found       bool
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
}

func New(client *http.Client, horizonURL string) *Service {
	return &Service{
		client:     client,
		horizonURL: strings.TrimSuffix(horizonURL, "/"),
		tomlURL:    "https://%s/.well-known/stellar.toml",
		cache:      make(map[string]*entry),
	}
}

// Icon returns the image bytes and content type for an asset, or ErrNoIcon.
// Outcomes are cached either way, so a busy page cannot hammer an issuer.
func (s *Service) Icon(ctx context.Context, code, issuer string) ([]byte, string, error) {
	key := code + ":" + issuer
	if cached, ok := s.lookup(key); ok {
		if !cached.found {
			return nil, "", ErrNoIcon
		}
		return cached.body, cached.contentType, nil
	}
	body, contentType, err := s.resolve(ctx, code, issuer)
	if errors.Is(err, ErrNoIcon) {
		s.store(key, &entry{fetchedAt: time.Now()})
		return nil, "", err
	}
	if err != nil {
		return nil, "", err // transient upstream trouble is not worth caching
	}
	s.store(key, &entry{body: body, contentType: contentType, fetchedAt: time.Now(), found: true})
	return body, contentType, nil
}

func (s *Service) resolve(ctx context.Context, code, issuer string) ([]byte, string, error) {
	domain, err := s.homeDomain(ctx, issuer)
	if err != nil {
		return nil, "", err
	}
	if !domainShape.MatchString(strings.ToLower(domain)) || len(domain) > 253 {
		return nil, "", ErrNoIcon
	}
	imageURL, err := s.imageURL(ctx, domain, code, issuer)
	if err != nil {
		return nil, "", err
	}
	return s.fetchImage(ctx, imageURL)
}

func (s *Service) homeDomain(ctx context.Context, issuer string) (string, error) {
	var payload struct {
		HomeDomain string `json:"home_domain"`
	}
	status, err := s.getJSON(ctx, s.horizonURL+"/accounts/"+issuer, &payload)
	if err != nil {
		return "", fmt.Errorf("horizon account: %w", err)
	}
	if status == http.StatusNotFound {
		return "", ErrNoIcon
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("horizon account: status %d", status)
	}
	if payload.HomeDomain == "" {
		return "", ErrNoIcon
	}
	return payload.HomeDomain, nil
}

func (s *Service) imageURL(ctx context.Context, domain, code, issuer string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf(s.tomlURL, domain), nil)
	if err != nil {
		return "", fmt.Errorf("toml request: %w", err)
	}
	response, err := s.client.Do(request)
	if err != nil {
		return "", ErrNoIcon // an unreachable domain is a fact about the issuer
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", ErrNoIcon
	}
	text, err := io.ReadAll(io.LimitReader(response.Body, maxTomlBytes+1))
	if err != nil {
		return "", fmt.Errorf("toml read: %w", err)
	}
	if len(text) > maxTomlBytes {
		return "", ErrNoIcon
	}
	image := currencyImage(string(text), code, issuer)
	if image == "" || !strings.HasPrefix(image, "https://") {
		return "", ErrNoIcon
	}
	return image, nil
}

func (s *Service) fetchImage(ctx context.Context, url string) ([]byte, string, error) {
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
		return nil, "", fmt.Errorf("image read: %w", err)
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
		s.cacheBytes -= len(old.body)
	} else {
		s.order = append(s.order, key)
	}
	s.cache[key] = value
	s.cacheBytes += len(value.body)
	for s.cacheBytes > cacheBudget && len(s.order) > 0 {
		oldest := s.order[0]
		s.order = s.order[1:]
		if evicted, ok := s.cache[oldest]; ok {
			s.cacheBytes -= len(evicted.body)
			delete(s.cache, oldest)
		}
	}
}

// currencyImage walks the [[CURRENCIES]] sections with a tolerant line
// parser: real files disagree on spacing and quoting, and one malformed
// section must not cost the entries after it.
func currencyImage(text, code, issuer string) string {
	var image string
	var codeMatch, issuerMatch, inCurrency bool
	flush := func() string {
		if codeMatch && issuerMatch {
			return image
		}
		return ""
	}
	for _, rawLine := range strings.Split(text, "\n") {
		line := strings.TrimSpace(rawLine)
		if strings.HasPrefix(line, "[") {
			if found := flush(); found != "" {
				return found
			}
			inCurrency = strings.ReplaceAll(line, " ", "") == "[[CURRENCIES]]"
			image, codeMatch, issuerMatch = "", false, false
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
		case "image":
			image = unquote(value)
		}
	}
	return flush()
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
