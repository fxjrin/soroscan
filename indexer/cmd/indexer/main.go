package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/soroscan-io/soroscan/indexer/internal/extract"
	"github.com/soroscan-io/soroscan/indexer/internal/lake"
	"github.com/soroscan-io/soroscan/indexer/internal/store"
)

const (
	lakeBaseURL = "https://aws-public-blockchain.s3.amazonaws.com/v1.1/stellar/ledgers/pubnet"
	// the network closes a ledger about every 5s and the archive publishes
	// it a few seconds later, so a short poll keeps the index near the tip
	tipPollInterval  = 2 * time.Second
	errorBackoff     = 5 * time.Second
	progressInterval = 500
	backfillBatch    = 8
)

func main() {
	if err := run(os.Args[1:], os.Getenv("DATABASE_URL")); err != nil {
		fmt.Fprintln(os.Stderr, "indexer:", err)
		os.Exit(1)
	}
}

func run(args []string, databaseURL string) error {
	if len(args) == 0 {
		return errors.New("usage: indexer <follow [--start N] | backfill --start N --end N>")
	}
	if databaseURL == "" {
		return errors.New("DATABASE_URL must be set")
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer pool.Close()

	st := store.New(pool)
	if err := st.Migrate(ctx); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	client := lake.NewClient(lakeBaseURL, &http.Client{Timeout: 60 * time.Second})

	switch args[0] {
	case "follow":
		flags := flag.NewFlagSet("follow", flag.ContinueOnError)
		start := flags.Uint64("start", 0, "first ledger when no checkpoint exists yet")
		if err := flags.Parse(args[1:]); err != nil {
			return fmt.Errorf("parse follow flags: %w", err)
		}
		return follow(ctx, client, st, uint32(*start))
	case "backfill":
		flags := flag.NewFlagSet("backfill", flag.ContinueOnError)
		start := flags.Uint64("start", 0, "first ledger sequence")
		end := flags.Uint64("end", 0, "last ledger sequence")
		if err := flags.Parse(args[1:]); err != nil {
			return fmt.Errorf("parse backfill flags: %w", err)
		}
		if *start == 0 || *end == 0 || *start > *end || *end > math.MaxUint32 {
			return errors.New("backfill needs --start and --end with 0 < start <= end <= 4294967295")
		}
		return backfill(ctx, client, st, uint32(*start), uint32(*end))
	default:
		return fmt.Errorf("unknown subcommand %q", args[0])
	}
}

func follow(ctx context.Context, client *lake.Client, st *store.Store, startFlag uint32) error {
	last, err := st.CheckpointLedger(ctx, "worker")
	if err != nil {
		return fmt.Errorf("read checkpoint: %w", err)
	}
	next := uint32(last) + 1
	if last == 0 {
		if startFlag == 0 {
			return errors.New("no checkpoint yet: pass --start for the first run")
		}
		next = startFlag
	}
	log.Printf("follow: starting at ledger %d", next)

	processed := 0
	for {
		if err := ctx.Err(); err != nil {
			log.Printf("follow: stopping at ledger %d", next-1)
			return nil
		}
		saved, err := indexOne(ctx, client, st, next)
		if errors.Is(err, lake.ErrNotYetPublished) {
			sleep(ctx, tipPollInterval)
			continue
		}
		if err != nil {
			log.Printf("follow: ledger %d: %v", next, err)
			sleep(ctx, errorBackoff)
			continue
		}
		processed++
		if processed%progressInterval == 0 {
			log.Printf("follow: at ledger %d (%d invocations in the last one)", next, saved)
		}
		next++
	}
}

func backfill(ctx context.Context, client *lake.Client, st *store.Store, start, end uint32) error {
	name := fmt.Sprintf("backfill:%d-%d", start, end)
	done, err := st.CheckpointLedger(ctx, name)
	if err != nil {
		return fmt.Errorf("read checkpoint: %w", err)
	}
	next := start
	if done >= int64(start) {
		next = uint32(done) + 1
	}
	if next > end {
		log.Printf("backfill: %s already complete", name)
		return nil
	}
	log.Printf("backfill: %d..%d, resuming at %d", start, end, next)

	for next <= end {
		if err := ctx.Err(); err != nil {
			log.Printf("backfill: stopping at ledger %d, rerun to resume", next-1)
			return nil
		}
		batchEnd := next + backfillBatch - 1
		if batchEnd > end {
			batchEnd = end
		}
		if err := indexBatch(ctx, client, st, next, batchEnd); err != nil {
			log.Printf("backfill: batch %d..%d: %v", next, batchEnd, err)
			sleep(ctx, errorBackoff)
			continue
		}
		if err := st.SetCheckpoint(ctx, name, int64(batchEnd)); err != nil {
			return fmt.Errorf("checkpoint: %w", err)
		}
		if (batchEnd-start)%progressInterval < backfillBatch {
			log.Printf("backfill: at ledger %d of %d", batchEnd, end)
		}
		next = batchEnd + 1
	}
	log.Printf("backfill: %s complete", name)
	return nil
}

// fetches a small batch concurrently but saves in sequence order, so the
// range checkpoint never runs ahead of a ledger that failed to persist
func indexBatch(ctx context.Context, client *lake.Client, st *store.Store, from, to uint32) error {
	count := int(to - from + 1)
	results := make([]extract.LedgerResult, count)
	errs := make([]error, count)
	var wg sync.WaitGroup
	for i := 0; i < count; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			seq := from + uint32(i)
			meta, err := client.FetchLedger(ctx, seq)
			if err != nil {
				errs[i] = fmt.Errorf("fetch %d: %w", seq, err)
				return
			}
			results[i], errs[i] = extract.Extract(meta)
		}(i)
	}
	wg.Wait()
	for i := 0; i < count; i++ {
		if errs[i] != nil {
			return errs[i]
		}
		if err := saveResult(ctx, st, results[i]); err != nil {
			return err
		}
	}
	return nil
}

func indexOne(ctx context.Context, client *lake.Client, st *store.Store, seq uint32) (int, error) {
	meta, err := client.FetchLedger(ctx, seq)
	if err != nil {
		return 0, err
	}
	result, err := extract.Extract(meta)
	if err != nil {
		return 0, fmt.Errorf("extract %d: %w", seq, err)
	}
	return len(result.Invocations), saveResult(ctx, st, result)
}

func saveResult(ctx context.Context, st *store.Store, result extract.LedgerResult) error {
	rows := make([]store.InvocationRow, len(result.Invocations))
	for i, inv := range result.Invocations {
		rows[i] = store.InvocationRow{
			ContractID: inv.ContractID,
			TxHash:     inv.TxHash,
			Ledger:     inv.Ledger,
			ClosedAt:   inv.ClosedAt,
			Function:   inv.Function,
			ArgsJSON:   inv.ArgsJSON,
			FeeCharged: inv.FeeCharged,
		}
	}
	if err := st.SaveLedger(ctx, result.Sequence, rows); err != nil {
		return fmt.Errorf("save %d: %w", result.Sequence, err)
	}
	return nil
}

func sleep(ctx context.Context, d time.Duration) {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}
