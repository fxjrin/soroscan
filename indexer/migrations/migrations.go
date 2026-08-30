// Package migrations embeds the SQL schema files applied by store.Migrate.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
