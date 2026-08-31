package icons

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"syscall"
	"time"
)

// errBlockedAddress is returned by the dialer guard when a lookup resolves
// to an address the service must never connect to.
var errBlockedAddress = errors.New("address is not a public host")

// GuardedClient is the http client the service uses in production. Issuer
// content decides which hosts it fetches, so the dialer refuses any
// address that resolves into a private, loopback, or link-local range:
// the proxy must never become a way to probe hosts behind this server.
func GuardedClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
		// Control runs once the address is resolved to ip:port, so every
		// connection attempt, including each ip a name fans out to, is checked
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return fmt.Errorf("guard: %w", err)
			}
			ip := net.ParseIP(host)
			if ip == nil || !isPublicIP(ip) {
				return errBlockedAddress
			}
			return nil
		},
	}
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DialContext:           dialer.DialContext,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          100,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ExpectContinueTimeout: time.Second,
		},
	}
}

func isPublicIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || ip.IsMulticast() {
		return false
	}
	return true
}
