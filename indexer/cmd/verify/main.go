package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/soroscan-io/soroscan/indexer/internal/extract"
	"github.com/soroscan-io/soroscan/indexer/internal/lake"
)

const (
	lakeBaseURL  = "https://aws-public-blockchain.s3.amazonaws.com/v1.1/stellar/ledgers/pubnet"
	protocol20   = 50457424
	fetchWorkers = 16
)

type check struct {
	ledger   uint32
	closedAt time.Time
	want     int
	got      int64
	err      error
}

func main() {
	sample := flag.Int("sample", 2000, "random ledgers to verify")
	seed := flag.Int64("seed", 1, "rng seed so a run is repeatable")
	flag.Parse()

	if err := run(*sample, *seed); err != nil {
		fmt.Fprintln(os.Stderr, "verify:", err)
		os.Exit(1)
	}
}

func run(sample int, seed int64) error {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer pool.Close()

	var tip int64
	if err := pool.QueryRow(ctx,
		`select last_ledger from checkpoints where name = 'worker'`).Scan(&tip); err != nil {
		return fmt.Errorf("read tip: %w", err)
	}

	ledgers := pick(ctx, pool, sample, seed, uint32(tip))
	log.Printf("verifying %d ledgers between %d and %d", len(ledgers), protocol20, tip)

	transport := &http.Transport{MaxIdleConns: fetchWorkers, MaxIdleConnsPerHost: fetchWorkers}
	client := lake.NewClient(lakeBaseURL, &http.Client{Timeout: 60 * time.Second, Transport: transport})

	checks := make([]check, len(ledgers))
	jobs := make(chan int)
	var wg sync.WaitGroup
	for w := 0; w < fetchWorkers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				checks[i] = fetchOne(ctx, client, ledgers[i])
			}
		}()
	}
	for i := range ledgers {
		jobs <- i
	}
	close(jobs)
	wg.Wait()

	mismatches := 0
	for i := range checks {
		c := &checks[i]
		if c.err != nil {
			mismatches++
			fmt.Printf("MISMATCH ledger %d: %v\n", c.ledger, c.err)
			continue
		}
		// the closed_at window prunes to one chunk; the ledger equality does the rest
		err := pool.QueryRow(ctx,
			`select count(*) from contract_transactions
			 where ledger = $1 and ledger_closed_at between $2::timestamptz - interval '5 minutes' and $2::timestamptz + interval '5 minutes'`,
			int64(c.ledger), c.closedAt).Scan(&c.got)
		if err != nil {
			return fmt.Errorf("count ledger %d: %w", c.ledger, err)
		}
		if c.got != int64(c.want) {
			mismatches++
			fmt.Printf("MISMATCH ledger %d: archive has %d invocations, db has %d\n", c.ledger, c.want, c.got)
		}
	}

	if mismatches > 0 {
		return fmt.Errorf("%d of %d ledgers mismatched", mismatches, len(checks))
	}
	fmt.Printf("OK: %d ledgers verified, archive and db agree on every one\n", len(checks))
	return nil
}

// random ledgers across the whole indexed span, plus every range boundary
// from the checkpoints table: seams are where gaps would hide
func pick(ctx context.Context, pool *pgxpool.Pool, sample int, seed int64, tip uint32) []uint32 {
	seen := map[uint32]bool{}
	rows, err := pool.Query(ctx, `select name from checkpoints where name like 'backfill:%'`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var name string
			if rows.Scan(&name) != nil {
				continue
			}
			var start, end uint32
			if _, err := fmt.Sscanf(name, "backfill:%d-%d", &start, &end); err == nil {
				for _, b := range []uint32{start, end} {
					if b >= protocol20 && b <= tip {
						seen[b] = true
					}
				}
			}
		}
	}
	rng := rand.New(rand.NewSource(seed))
	span := int64(tip) - protocol20 + 1
	for len(seen) < sample {
		seen[uint32(protocol20+rng.Int63n(span))] = true
	}
	out := make([]uint32, 0, len(seen))
	for seq := range seen {
		out = append(out, seq)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func fetchOne(ctx context.Context, client *lake.Client, seq uint32) check {
	meta, err := client.FetchLedger(ctx, seq)
	if err != nil {
		return check{ledger: seq, err: fmt.Errorf("fetch: %w", err)}
	}
	result, err := extract.Extract(meta)
	if err != nil {
		return check{ledger: seq, err: fmt.Errorf("extract: %w", err)}
	}
	return check{ledger: seq, closedAt: result.ClosedAt, want: len(result.Invocations)}
}
