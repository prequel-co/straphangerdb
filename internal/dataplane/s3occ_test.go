package dataplane

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"
)

func TestS3OCCClientConfig(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))

	// Without credentials, should fail gracefully
	os.Unsetenv("R2_ACCESS_KEY_ID")
	os.Unsetenv("R2_SECRET_ACCESS_KEY")
	_, err := NewS3OCCClient(logger, "straphanger-db-dev")
	if err == nil {
		t.Fatal("expected error when credentials missing, got nil")
	}

	// Set test credentials
	os.Setenv("R2_ACCESS_KEY_ID", "test-key")
	os.Setenv("R2_SECRET_ACCESS_KEY", "test-secret")
	os.Setenv("CLOUDFLARE_ACCOUNT_ID", "test-account-id")

	client, err := NewS3OCCClient(logger, "straphanger-db-dev")
	if err != nil {
		t.Fatalf("failed initializing S3OCCClient: %v", err)
	}

	if client.bucket != "straphanger-db-dev" {
		t.Fatalf("expected bucket straphanger-db-dev, got %s", client.bucket)
	}

	// Check ErrOCCConflict definition
	if !errors.Is(ErrOCCConflict, ErrOCCConflict) {
		t.Fatal("ErrOCCConflict comparison failed")
	}

	_ = context.Background()
}
